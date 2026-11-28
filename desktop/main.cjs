'use strict';
/**
 * Parametric 桌面版主进程。
 *
 * 关键设计：用 127.0.0.1 上的本地 HTTP 服务托管 dist/，而不是 loadFile()。
 * 原因是本项目依赖 OPFS（navigator.storage.getDirectory）做本地存储、
 * 依赖 fetch 加载 OpenCascade 的 .wasm，二者在 file:// 下都会受限。
 * localhost 属于 secure context，Worker / WASM / OPFS 全部原生可用。
 *
 * 另外通过 preload 注入一个实现 PuterSDK 接口的「本地 SDK 垫片」，
 * 把原本的云存储 / 账号 / 文件对话框映射到本机磁盘与 Electron 对话框，
 * 因此不需要改动任何界面层代码。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const USER = app.getPath('userData');
const PARTS = path.join(USER, 'parts');
const KV_FILE = path.join(USER, 'kv.json');
const WORKSPACE_FILE = path.join(USER, 'workspace.json');
const projectRoots = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

let win = null;
let server = null;
let port = 0;
let launchedItems = [];
const closeHandlers = [];
let autoUpdater = null;
let updateCheckWasManual = false;
let updateState = {
  status: 'idle',
  version: app.getVersion(),
  availableVersion: null,
  percent: 0,
  message: '',
};

// ---- 自动更新 ----
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update:status', updateState);
}

function updaterErrorMessage(error) {
  const text = String(error && error.message || error || '未知错误');
  if (/net::|ENOTFOUND|ECONN|timed? ?out|404|403/i.test(text)) return '无法连接更新服务器，请检查网络或稍后重试。';
  return text;
}

function setupAutoUpdater() {
  if (!app.isPackaged || SMOKE) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    setUpdateState({ status: 'disabled', message: '自动更新组件未安装：' + updaterErrorMessage(e) });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  const feed = String(process.env.PARAMETRIC_UPDATE_URL || '').trim();
  if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', percent: 0, message: '正在检查更新…' });
  });
  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      availableVersion: info && info.version || null,
      percent: 0,
      message: `发现新版本 ${info && info.version || ''}，正在后台下载…`,
    });
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateState({ status: 'current', availableVersion: null, percent: 100, message: '当前已是最新版本。' });
    if (updateCheckWasManual) {
      dialog.showMessageBox(win, {
        title: '检查更新',
        message: '当前已是最新版本。',
        detail: `版本 ${app.getVersion()}`,
        type: 'info',
        buttons: ['确定'],
      });
    }
  });
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress && progress.percent) || 0));
    setUpdateState({
      status: 'downloading',
      percent,
      message: `正在下载更新：${percent.toFixed(1)}%`,
    });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    setUpdateState({
      status: 'downloaded',
      availableVersion: info && info.version || updateState.availableVersion,
      percent: 100,
      message: '更新已下载完成，重启后安装。',
    });
    if (!win || win.isDestroyed()) return;
    const r = await dialog.showMessageBox(win, {
      title: '更新已就绪',
      message: `新版本 ${info && info.version || ''} 已下载完成。`,
      detail: '现在重启并安装，还是下次退出时自动安装？',
      type: 'info',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  });
  autoUpdater.on('error', (error) => {
    const message = updaterErrorMessage(error);
    setUpdateState({ status: 'error', message });
    if (updateCheckWasManual) {
      dialog.showMessageBox(win, { title: '检查更新失败', message, type: 'error', buttons: ['确定'] });
    }
    console.error('[updater]', error);
  });

  setTimeout(() => { void checkForUpdates(false); }, 8_000);
}

async function checkForUpdates(manual = true) {
  updateCheckWasManual = manual;
  if (!app.isPackaged) {
    if (manual) {
      await dialog.showMessageBox(win, {
        title: '检查更新',
        message: '开发模式不检查更新。',
        detail: '请安装打包后的版本，或运行 npm run desktop:publish 生成更新文件。',
        type: 'info',
        buttons: ['确定'],
      });
    }
    return false;
  }
  if (!autoUpdater) {
    if (manual) {
      await dialog.showMessageBox(win, {
        title: '检查更新',
        message: '自动更新组件不可用。',
        detail: updateState.message || updaterErrorMessage('electron-updater 未加载'),
        type: 'error',
        buttons: ['确定'],
      });
    }
    return false;
  }
  try {
    setUpdateState({ status: 'checking', percent: 0, message: '正在检查更新…' });
    await autoUpdater.checkForUpdates();
    return true;
  } catch (e) {
    const message = updaterErrorMessage(e);
    setUpdateState({ status: 'error', message });
    if (manual) await dialog.showMessageBox(win, { title: '检查更新失败', message, type: 'error', buttons: ['确定'] });
    return false;
  }
}

// ---- 静态服务 ----
function resolveDist(urlPath) {
  let rel;
  try { rel = decodeURIComponent((urlPath || '/').split('?')[0].split('#')[0]); }
  catch { return null; }
  rel = rel.replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(DIST, rel);
  if (full !== DIST && !full.startsWith(DIST + path.sep)) return null;
  return full;
}

async function startServer() {
  server = http.createServer(async (req, res) => {
    const file = resolveDist(req.url);
    if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
    try {
      const buf = await fsp.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buf);
    } catch {
      // 单页应用回退
      try {
        const html = await fsp.readFile(path.join(DIST, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      } catch {
        res.writeHead(404); res.end('Not found');
      }
    }
  });
  await new Promise((resolve, reject) => {
    // A stable port keeps the renderer origin stable, so localStorage and OPFS
    // (projects, recent parts) survive every relaunch. Fall back to nearby
    // ports and finally to an ephemeral one when they are all taken.
    const FIRST = 17651;
    let candidate = FIRST;
    const attempt = () => {
      const onError = (err) => {
        server.off('listening', onListening);
        if (err && err.code === 'EADDRINUSE' && candidate < FIRST + 20) {
          candidate += 1;
          setImmediate(attempt);
          return;
        }
        if (candidate >= FIRST + 20) {
          // Last resort: let the OS pick a port (project metadata then relies
          // on the workspace file hydration below).
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        port = server.address().port;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(candidate, '127.0.0.1');
    };
    attempt();
  });
}

// ---- 本地文件（兼容 Puter FS 接口）----
function userPath(p) {
  let s = String(p || '').replace(/\\/g, '/');
  if (path.isAbsolute(s)) return path.resolve(s);
  s = s.replace(/^%appdata%\/?/i, '').replace(/^~\/?/, '').replace(/^\/+/, '');
  const full = path.resolve(PARTS, s);
  if (full !== PARTS && !full.startsWith(PARTS + path.sep)) throw new Error('非法路径：' + p);
  return full;
}

function asBytes(data) {
  if (data == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

async function kvRead() {
  try { return JSON.parse(await fsp.readFile(KV_FILE, 'utf8')); }
  catch { return {}; }
}
async function kvWrite(obj) {
  await fsp.mkdir(USER, { recursive: true });
  await fsp.writeFile(KV_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// Workspace metadata (local projects, assignments, active project, resource
// centre) is mirrored here so a changed port can never lose the project list.
function workspaceReadSync() {
  try { return JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf8')); }
  catch { return null; }
}
async function workspaceWrite(obj) {
  await fsp.mkdir(USER, { recursive: true });
  await fsp.writeFile(WORKSPACE_FILE, JSON.stringify(obj ?? {}, null, 2), 'utf8');
}

function registerIpc() {
  const projectRoot = async (root) => {
    const resolved = await fsp.realpath(String(root || ''));
    const st = await fsp.stat(resolved);
    if (!st.isDirectory()) throw new Error('项目路径不是文件夹');
    projectRoots.add(resolved);
    return resolved;
  };
  const projectPath = async (root, target) => {
    const base = await projectRoot(root);
    const resolved = await fsp.realpath(String(target || ''));
    const rel = path.relative(base, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件不在当前项目文件夹中');
    return resolved;
  };

  ipcMain.handle('project:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择项目文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const root = await projectRoot(r.filePaths[0]);
    return { path: root, name: path.basename(root) };
  });
  ipcMain.handle('project:list', async (_e, root) => {
    const base = await projectRoot(root);
    const items = await fsp.readdir(base, { withFileTypes: true });
    const out = [];
    for (const item of items) {
      if (!item.isFile() || !item.name.toLowerCase().endsWith('.parametric')) continue;
      const full = path.join(base, item.name);
      const st = await fsp.stat(full);
      out.push({
        name: item.name.slice(0, -'.parametric'.length),
        path: full,
        size: st.size,
        modified: st.mtimeMs,
      });
    }
    return out.sort((a, b) => b.modified - a.modified);
  });
  ipcMain.handle('project:read', async (_e, root, target) => fsp.readFile(await projectPath(root, target)));
  ipcMain.handle('project:write', async (_e, root, target, bytes) => {
    const base = await projectRoot(root);
    let full;
    try { full = await projectPath(root, target); }
    catch {
      const next = path.resolve(base, path.basename(String(target || '')));
      const rel = path.relative(base, next);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件不在当前项目文件夹中');
      full = next;
    }
    await fsp.writeFile(full, asBytes(bytes));
    const st = await fsp.stat(full);
    return { name: path.basename(full), path: full, size: st.size, modified: st.mtimeMs };
  });
  ipcMain.handle('project:delete', async (_e, root, target) => {
    await fsp.unlink(await projectPath(root, target));
  });

  ipcMain.handle('fs:write', async (_e, p, bytes, opts = {}) => {
    const full = userPath(p);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    if (!opts.overwrite && fs.existsSync(full) && !opts.createMissingParents) {
      // 与 Puter FS 的默认行为保持一致：允许覆盖，避免旧零件无法保存
    }
    await fsp.writeFile(full, asBytes(bytes));
    const st = await fsp.stat(full);
    return { name: path.basename(full), path: p, size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
  });

  ipcMain.handle('fs:read', async (_e, p) => {
    const buf = await fsp.readFile(userPath(p));
    return new Uint8Array(buf);
  });

  ipcMain.handle('fs:readdir', async (_e, p = '') => {
    const dir = userPath(p);
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const out = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.posix.join(String(p || '').replace(/\\/g, '/'), e.name);
      let st = null;
      try { st = await fsp.stat(full); } catch { continue; }
      out.push({
        name: e.name, path: rel, is_dir: e.isDirectory(), isDir: e.isDirectory(),
        size: st.size, modified: Math.floor(st.mtimeMs / 1000),
      });
    }
    return out;
  });

  ipcMain.handle('fs:delete', async (_e, p) => { await fsp.rm(userPath(p), { force: true, recursive: false }); });
  ipcMain.handle('fs:rename', async (_e, p, name) => {
    const from = userPath(p);
    const to = path.join(path.dirname(from), path.basename(String(name)));
    await fsp.rename(from, to);
    return { name: path.basename(to), path: path.posix.join(path.posix.dirname(String(p).replace(/\\/g, '/')), path.basename(to)) };
  });
  ipcMain.handle('fs:stat', async (_e, p) => {
    const st = await fsp.stat(userPath(p));
    return { name: path.basename(userPath(p)), path: p, is_dir: st.isDirectory(), isDir: st.isDirectory(), size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
  });
  ipcMain.handle('fs:mkdir', async (_e, p) => {
    await fsp.mkdir(userPath(p), { recursive: true });
    return { name: path.basename(userPath(p)), path: p, is_dir: true, isDir: true };
  });

  ipcMain.handle('kv:get', async (_e, key) => (await kvRead())[key]);
  ipcMain.handle('kv:set', async (_e, key, value) => {
    const obj = await kvRead(); obj[key] = value; await kvWrite(obj); return true;
  });
  ipcMain.handle('kv:del', async (_e, key) => {
    const obj = await kvRead(); delete obj[key]; await kvWrite(obj); return true;
  });

  ipcMain.handle('dialog:open', async (_e, opts = {}) => {
    const r = await dialog.showOpenDialog(win, {
      title: opts.title || '打开零件',
      properties: ['openFile'],
      filters: opts.filters || [
        { name: '零件与 CAD 文件', extensions: ['parametric', 'json', 'step', 'stp', 'sldprt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const full = r.filePaths[0];
    const st = await fsp.stat(full);
    return { name: path.basename(full), path: full, size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
  });

  ipcMain.handle('dialog:save', async (_e, bytes, name) => {
    const r = await dialog.showSaveDialog(win, {
      title: '另存为', defaultPath: name || 'Part1.parametric',
      filters: [{ name: '零件文件', extensions: ['parametric'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, asBytes(bytes));
    return { name: path.basename(r.filePath), path: r.filePath };
  });

  ipcMain.handle('win:setTitle', (_e, title) => { if (win) win.setTitle(String(title)); });
  ipcMain.handle('win:onClose', () => true);
  ipcMain.handle('app:info', () => ({ userData: USER, partsDir: PARTS, version: app.getVersion(), port }));
  ipcMain.on('workspace:read-sync', (e) => { e.returnValue = workspaceReadSync(); });
  ipcMain.handle('workspace:write', async (_e, state) => { await workspaceWrite(state); return true; });
  ipcMain.handle('app:exit', () => app.quit());
  ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('app:launchedItems', () => launchedItems);
  ipcMain.on('app:launchedItemsSync', (e) => { e.returnValue = launchedItems; });
  ipcMain.handle('update:check', () => checkForUpdates(true));
  ipcMain.handle('update:state', () => updateState);
  ipcMain.handle('update:install', () => {
    if (!autoUpdater || updateState.status !== 'downloaded') return false;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新载入', role: 'reload' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
        { label: '实际大小', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        { label: '开发者工具', role: 'toggleDevTools' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '零件目录', click: () => shell.openPath(PARTS) },
        { label: '检查更新…', click: () => void checkForUpdates(true) },
        { label: `版本 ${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: '关于', click: () => dialog.showMessageBox(win, {
          title: '关于', message: '参数化三维设计（桌面版）',
          detail: `版本：${app.getVersion()}\n基于 Parametric 开源项目（AGPL-3.0）构建。\n零件目录：${PARTS}\n内核：OpenCascade WebAssembly`,
          type: 'info',
        }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const SMOKE = process.argv.includes('--smoke');

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: '参数化三维设计',
    show: !SMOKE,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });
  win.on('closed', () => { win = null; });
  // 只通知、不拦截关闭：OPFS 与本地文件在写入时已落盘，拦截反而可能卡住退出。
  win.on('close', () => { if (!win.isDestroyed()) win.webContents.send('win:before-close'); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);

  // --smoke：无人值守冒烟测试，校验页面、中文界面、本地 SDK 垫片与静态服务。
  // 注意：必须在 loadURL 已完成的前提下直接检查，不能再等 did-finish-load（事件已过）。
  if (SMOKE) {
    {
      await new Promise((r) => setTimeout(r, 3500));
      try {
        const r = await win.webContents.executeJavaScript(`(() => {
          var app = document.getElementById('app');
          return {
            title: document.title,
            lang: document.documentElement.lang,
            appMounted: !!(app && app.childElementCount > 0),
            ariaBusy: app ? app.getAttribute('aria-busy') : null,
            puterInjected: !!window.puter,
            desktopAPI: !!window.desktopAPI,
            localSDK: !!(window.puter && window.puter.env === 'app'),
            cjk: /[\\u4e00-\\u9fff]/.test(document.body.innerText || ''),
            sampleText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 220)
          };
        })()`);
        const ok = r.appMounted && r.puterInjected && r.desktopAPI && r.localSDK;
        console.log('[SMOKE] ' + JSON.stringify({ ok, ...r }));
        app.exit(ok ? 0 : 1);
      } catch (e) {
        console.error('[SMOKE] 执行失败：', e);
        app.exit(1);
      }
    }
  }
}

// 单实例 + 命令行传文件
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.slice(1).filter((a) => /\.(parametric|json|step|stp|sldprt)$/i.test(a) && fs.existsSync(a));
    launchedItems = files.map((f) => ({ name: path.basename(f), path: f }));
    if (win) { win.focus(); win.webContents.reload(); }
  });
}

app.whenReady().then(async () => {
  await fsp.mkdir(PARTS, { recursive: true });
  launchedItems = process.argv.slice(1)
    .filter((a) => /\.(parametric|json|step|stp|sldprt)$/i.test(a) && fs.existsSync(a))
    .map((f) => ({ name: path.basename(f), path: f }));
  registerIpc();
  buildMenu();
  await startServer();
  await createWindow();
  setupAutoUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e) => {
  console.error('[desktop] 启动失败：', e);
  dialog.showErrorBox('启动失败', String(e && e.stack || e));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server) server.close(); });

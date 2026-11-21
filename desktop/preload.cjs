'use strict';
/**
 * 桌面版 preload：把本地能力注入为 window.puter（PuterSDK 兼容层）。
 *
 * 项目原本就把所有云调用收敛在 src/platform/puter.ts 的 PuterSDK 接口里，
 * 且明确支持「没有 Puter 也能跑」。这里只要提供同一个接口的本地实现，
 * 云存储就变成 userData/parts 下的普通文件，账号/共享降级为本地行为，
 * 界面层代码无需任何改动。
 */
const { contextBridge, ipcRenderer } = require('electron');

const toBytes = async (data) => {
  if (data == null) return [];
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
};

const asBlob = (bytes, type = 'application/json') =>
  new Blob([new Uint8Array(bytes || [])], { type });

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/** PuterFSItem 需要 read() 返回 Blob；函数无法跨 IPC，故在渲染侧补齐。 */
const withRead = (item) => ({
  ...item,
  read: async () => asBlob(await call('fs:read', item.path)),
});

const fsApi = {
  write: async (p, data) => withRead(await call('fs:write', p, await toBytes(data))),
  read: async (p) => asBlob(await call('fs:read', p)),
  readdir: async (p, opts) => (await call('fs:readdir', p || '', opts || {})).map(withRead),
  delete: (p, opts) => call('fs:delete', p, opts || {}),
  rename: (p, name) => call('fs:rename', p, name),
  stat: async (p) => withRead(await call('fs:stat', p)),
  mkdir: (p, opts) => call('fs:mkdir', p, opts || {}),
  // 桌面版没有在线协作：共享列表为空，写操作给出明确提示而不是崩溃。
  listShared: async () => [],
  share: async () => { throw new Error('桌面版不支持在线共享，请用「导出」或「另存为」交付文件。'); },
  unshare: async () => { throw new Error('桌面版不支持在线共享。'); },
};

const launched = (() => {
  try { return ipcRenderer.sendSync('app:launchedItemsSync') || []; }
  catch { return []; }
})().map(withRead);

const puter = {
  env: 'app',
  appID: 'parametric-desktop',
  exit: () => call('app:exit'),
  auth: {
    isSignedIn: () => true,
    signIn: async () => ({ username: '本地用户' }),
    signOut: async () => {},
    getUser: async () => ({ username: '本地用户', uuid: 'local-desktop' }),
    getProfilePicture: async () => null,
  },
  fs: fsApi,
  kv: {
    get: (key) => call('kv:get', key),
    set: (key, value) => call('kv:set', key, value),
    del: (key) => call('kv:del', key),
  },
  ui: {
    showOpenFilePicker: async (opts) => {
      const item = await call('dialog:open', opts || {});
      return item ? withRead(item) : undefined;
    },
    showSaveFilePicker: async (data, name) => {
      const item = await call('dialog:save', await toBytes(data), name);
      return item || undefined;
    },
    onLaunchedWithItems: (fn) => { if (typeof fn === 'function') queueMicrotask(() => fn(launched)); },
    wasLaunchedWithItems: () => launched.length > 0,
    setWindowTitle: (title) => call('win:setTitle', title),
    onWindowClose: (fn) => {
      if (typeof fn !== 'function') return;
      ipcRenderer.on('win:before-close', () => { try { fn(); } catch (e) { console.error(e); } });
    },
  },
  // 桌面版默认离线：给出明确的中文提示，而不是让 SDK 抛英文异常。
  // 需要 AI 助手时，在这里把 chat 换成自有模型接口即可（ChatFn 形状见 src/platform/ai.ts）。
  ai: {
    chat: async () => {
      throw new Error('桌面离线版未启用 AI 助手。如需使用，请在 desktop/preload.cjs 中接入自有模型接口。');
    },
  },
};

contextBridge.exposeInMainWorld('puter', puter);
contextBridge.exposeInMainWorld('desktopAPI', {
  info: () => call('app:info'),
  openExternal: (url) => call('app:openExternal', url),
  updates: {
    check: () => call('update:check'),
    state: () => call('update:state'),
    install: () => call('update:install'),
    onStatus: (fn) => {
      if (typeof fn !== 'function') return () => {};
      const listener = (_event, state) => { try { fn(state); } catch (e) { console.error(e); } };
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
  isDesktop: true,
});

/**
 * 抽取清单与源码对齐。
 *
 * codemod 是增量的（会合并旧 key），人工改动源码后清单可能残留废弃 key
 * 或缺失新 key。本脚本以源码里实际出现的 tr('...') 第一参数为准，
 * 增删对齐，保证 build-dict / check 的输入始终可靠。
 *
 *   node tools/i18n/sync-keys.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const EN_PATH = path.join(ROOT, 'tools/i18n/en-US.generated.json');

const used = new Set();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) {
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/\btr\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) used.add(m[2]);
    }
  }
};
walk(SRC);

const old = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
const added = [...used].filter((k) => !(k in old)).sort();
const removed = Object.keys(old).filter((k) => !used.has(k)).sort();
const next = Object.fromEntries([...used].sort().map((k) => [k, k]));
fs.writeFileSync(EN_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');

console.log(`=== 清单对齐：${Object.keys(next).length} 条 key ===`);
console.log(`新增 ${added.length} 条${added.length ? '：' + added.slice(0, 12).join(' | ') : ''}`);
console.log(`移除 ${removed.length} 条${removed.length ? '：' + removed.slice(0, 12).join(' | ') : ''}`);

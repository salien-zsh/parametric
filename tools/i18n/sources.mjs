/**
 * 导出「文案 key -> 出现的源码文件」映射，供字典策略按来源细分使用。
 *   node tools/i18n/sources.mjs
 * 输出：tools/i18n/key-sources.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const map = {};

const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) {
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/\btr\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        (map[m[2]] ??= []).push(rel);
      }
    }
  }
};
walk(SRC);
for (const k of Object.keys(map)) map[k] = [...new Set(map[k])].sort();
fs.writeFileSync(path.join(ROOT, 'tools/i18n/key-sources.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');

const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/i18n/en-US.generated.json'), 'utf8'));
const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/zh-CN.json'), 'utf8'));
const skipped = Object.keys(en).filter((k) => !(k in zh));
const groups = new Map();
for (const k of skipped) {
  const g = (map[k] || ['<未找到>']).map((f) => f.split('/')[2] || f).join('+');
  groups.set(g, (groups.get(g) || 0) + 1);
}
console.log(`保留英文 ${skipped.length} 条，来源组合：`);
for (const [g, n] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${g}`);
console.log('已写 tools/i18n/key-sources.json');

/**
 * 最后一批显示名中文化：基准面名、视图方向名、材料未指定标记。
 * 这些都是「显示名」映射，键（front/top/right、isometric 等）是数据 id，
 * 值只用于界面渲染，翻译不会写进 .parametric 文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const Q = "'";
const targets = [
  ['src/model/planes.ts', 'BASE_PLANE_NAMES', '../i18n'],
  ['src/render/camera.ts', 'VIEW_LABELS', '../i18n'],
];

const report = [];
for (const [rel, marker, imp] of targets) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  const start = s.indexOf(marker);
  const end = s.indexOf('};', start);
  if (start < 0 || end < 0) { report.push(`${rel}: 未找到 ${marker}`); continue; }
  let block = s.slice(start, end);
  const n = (block.match(/'([A-Za-z][A-Za-z ]*)'/g) || []).length;
  block = block.replace(/'([A-Za-z][A-Za-z ]*)'/g, (_, v) => `tr(${Q}${v}${Q})`);
  s = s.slice(0, start) + block + s.slice(end);
  if (!/import\s*\{\s*tr\s*\}/.test(s)) s = `import { tr } from '${imp}';\n` + s;
  fs.writeFileSync(p, s, 'utf8');
  report.push(`${rel}: ${marker} ${n} 个显示名走 tr()`);
}

// 材料未指定标记
const tp = path.join(ROOT, 'src/app/tree.ts');
let t = fs.readFileSync(tp, 'utf8');
const from = "muted: doc.material ? '' : ' <not specified>'";
if (t.includes(from)) {
  t = t.replace(from, "muted: doc.material ? '' : tr(' <not specified>')");
  fs.writeFileSync(tp, t, 'utf8');
  report.push('src/app/tree.ts: 材料未指定标记走 tr()');
}
console.log('=== 显示名补漏 ===');
for (const r of report) console.log('  ' + r);

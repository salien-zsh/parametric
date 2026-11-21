/**
 * 短文案补漏（一次性、可重复运行）。
 *
 * 低阈值扫描发现的 UI 短文案：设计树特征类型名 / 默认特征名、
 * 菜单项、快捷键标签、kernel 错误提示。这些因「只有 1~3 个英文单词」
 * 未达 --messages 的长句阈值，且属性名不在白名单，故手工收口。
 * 绝不动 CSS 类名、rel 属性、STL 文件头、错误文本匹配关键词。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const Q = "'";
const tr = (k, args) => args ? `tr(${Q}${k}${Q}, [${args}])` : `tr(${Q}${k}${Q})`;

/** 精确字符串替换：文件内所有出现处。 */
const REPLACEMENTS = [
  ['src/app/sketch/editor.ts', [["'Move dimension'", tr('Move dimension')]]],
  ['src/app/sketch/panel.ts', [["'Unlink projected geometry'", tr('Unlink projected geometry')]]],
  ['src/app/dialogs.ts', [["'Shift + Arrow keys'", tr('Shift + Arrow keys')]]],
  ['src/app/tree.ts', [["'Design tree (flyout)'", tr('Design tree (flyout)')]]],
  ['src/kernel/build.ts', [
    ["'Face not found'", tr('Face not found')],
    ["'Edge not found'", tr('Edge not found')],
    ["'STEP export failed'", tr('STEP export failed')],
  ]],
  ['src/kernel/client.ts', [
    ["'it stopped unexpectedly'", tr('it stopped unexpectedly')],
    ['`of an error (${ev.message})`', tr('of an error ({0})', 'ev.message')],
    ['`The geometry engine stopped because ${reason}`', tr('The geometry engine stopped because {0}', 'reason')],
    ["'it stopped responding'", tr('it stopped responding')],
  ]],
];

const report = [];
for (const [rel, pairs] of REPLACEMENTS) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  let n = 0;
  for (const [from, to] of pairs) {
    const c = s.split(from).length - 1;
    if (c) { s = s.split(from).join(to); n += c; }
  }
  if (!/import\s*\{\s*tr\s*\}/.test(s)) {
    s = `import { tr } from '${rel.includes('/sketch/') ? '../../i18n' : '../i18n'}';\n` + s;
    report.push(`${rel}: +import`);
  }
  if (n) fs.writeFileSync(p, s, 'utf8');
  report.push(`${rel}: ${n} 处替换`);
}

// 特征名映射：只改 BASE_NAMES 与 FEATURE_LABELS 两个块内的值
const fp = path.join(ROOT, 'src/model/features.ts');
let fs_ = fs.readFileSync(fp, 'utf8');
let count = 0;
for (const marker of ['const BASE_NAMES: Record<FeatureType, string> = {', 'export const FEATURE_LABELS: Record<FeatureType, string> = {']) {
  const start = fs_.indexOf(marker);
  if (start < 0) continue;
  const end = fs_.indexOf('};', start);
  let block = fs_.slice(start, end);
  block = block.replace(/:\s*'([A-Za-z][A-Za-z ]*)'/g, (_, v) => `: tr(${Q}${v}${Q})`);
  count += (block.match(/tr\(/g) || []).length;
  fs_ = fs_.slice(0, start) + block + fs_.slice(end);
}
if (!/import\s*\{\s*tr\s*\}/.test(fs_)) fs_ = `import { tr } from '../i18n';\n` + fs_;
fs.writeFileSync(fp, fs_, 'utf8');
report.push(`src/model/features.ts: ${count} 个特征名走 tr()`);

console.log('=== 短文案补漏 ===');
for (const r of report) console.log('  ' + r);

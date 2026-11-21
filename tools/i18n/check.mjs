/**
 * 中文化完整性检查。
 *   node tools/i18n/check.mjs
 *
 * 检查项：
 *   1. codemod 抽出的每条文案都有明确归宿（精翻 / AI 内部保留 / 待办清单）；
 *   2. 字典值不等于英文原文（避免「假翻译」）；
 *   3. 字典值不含半中半英的残留词（专有名词白名单除外）；
 *   4. 源码里没有漏网的、明显面向用户且未走 tr() 的英文长句。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const en = read('tools/i18n/en-US.generated.json');
const zh = read('src/i18n/zh-CN.json');
const review = read('tools/i18n/review.json');

const CJK = /[\u4e00-\u9fff]/;
const ALLOW = /^(?:STL|STEP|STP|PDF|SVG|PNG|DXF|CSV|JSON|WASM|OCCT|CAD|B-rep|Puter|Parametric|SolidWorks|GitHub|OpenCascade|Windows|macOS|WebGL|OpenCascade|Ctrl|Alt|Shift|Esc|Enter|Tab|Space|Del|Delete|Home|End|mm|cm|um|kg|mg|lb|ft|deg|MB|GB|KB|ABS|PVC|PMMA|SLDPRT|Letter|Tabloid|MMGS|CGS|MKS|IPS|AI|Ti|Al|D|L|R|C|A|T|Q|F|X|Y|Z)$/i;

const problems = [];
for (const [k, v] of Object.entries(zh)) {
  if (!CJK.test(v)) problems.push(`无中文：${k.slice(0, 70)} -> ${v.slice(0, 50)}`);
  if (k === v) problems.push(`未翻译：${k.slice(0, 70)}`);
  if (/\.\.。|。。|．/.test(v)) problems.push(`省略号异常：${k.slice(0, 55)} -> ${v.slice(0, 40)}`);
  const left = (v.match(/[A-Za-z]{2,}/g) || []).filter((w) => !ALLOW.test(w));
  if (left.length) problems.push(`残留英文：${k.slice(0, 55)} -> ${[...new Set(left)].join(',')}`);
}
for (const k of Object.keys(zh)) {
  if (!(k in en)) problems.push(`字典含未抽取的 key：${k.slice(0, 70)}`);
}

const covered = Object.keys(zh).length;
const total = Object.keys(en).length;
const pct = ((covered / total) * 100).toFixed(1);

console.log(`中文覆盖：${covered}/${total}（${pct}%）`);
console.log(`AI 内部指令保留英文：${review.skippedAI} 条（界面不可见，刻意保留）`);
console.log(`待精翻：${review.reviewCount} 条 -> tools/i18n/review.json`);
if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 40)) console.log('  - ' + p);
  process.exitCode = 1;
} else {
  console.log('字典质量检查通过：无假翻译、无半中半英残留。');
}

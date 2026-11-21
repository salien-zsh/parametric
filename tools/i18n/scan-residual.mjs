/**
 * 漏网英文 UI 文案扫描器。
 *
 * codemod 只处理「安全上下文」里的字符串，模板串、拼接句、复杂表达式里的
 * 英文整句可能残留。本脚本用 AST 找出源码里仍以裸字符串存在的英文长句，
 * 排除注释、import/export、类型位置、CSS/URL、以及 AI 工具定义文件。
 *
 *   node tools/i18n/scan-residual.mjs            打印分组报告
 *   node tools/i18n/scan-residual.mjs --json    同时写 tools/i18n/residual.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-codemod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const AI_DEF_FILE = /[\\/]src[\\/]assistant[\\/](?:tools|sketch|inspect|agent|features|prompt|refs)\.ts$/;
const SKIP_FILE = /[\\/]src[\\/](?:i18n|ui[\\/]icons|model[\\/]expr|formats[\\/]sldprt|kernel[\\/]protocol|math)[\\/]/;

const isHuman = (s) => {
  if (typeof s !== 'string' || s.length < 14 || s.length > 400) return false;
  if (!/^[\x20-\x7E]+$/.test(s)) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (/[{}<>\[\]\\|`^~]/.test(s)) return false;      // CSS / 模板 / 代码
  if (/(https?:\/\/|www\.|\/|\.\/|#|--|var\(|data:|@media|calc\()/.test(s)) return false;
  if (/\.(ts|js|mjs|json|css|html|wasm|svg|png|step|stp|sldprt|parametric)\b/i.test(s)) return false;
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w));
  const arg = process.argv.find((a) => a.startsWith('--min='));
  const min = arg ? Number(arg.slice(6)) : 4;
  return words.length >= min;                       // 默认至少 4 个英文单词
};

const files = [];
const collect = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith('.ts') && !SKIP_FILE.test(p)) files.push(p);
  }
};
collect(SRC);

const found = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (AI_DEF_FILE.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const chain = [];
  const visit = (node) => {
    const parents = chain.slice();
    const parent = parents[parents.length - 1];
    const inTr = parent && ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) && parent.expression.text === 'tr';
    const inType = parents.some((p) => ts.isLiteralTypeNode?.(p) || ts.isUnionTypeNode?.(p) || ts.isTypeReferenceNode?.(p));
    const inImport = parents.some((p) => ts.isImportDeclaration(p) || ts.isExportDeclaration(p));
    let str = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) str = node.text;
    else if (ts.isTemplateExpression(node)) {
      str = node.head.text + node.templateSpans.map((sp, i) => `{${i}}` + sp.literal.text).join('');
    }
    if (str && !inTr && !inType && !inImport && isHuman(str)) {
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      found.push({ file: rel, line: pos, text: str.slice(0, 220) });
    }
    chain.push(node); ts.forEachChild(node, visit); chain.pop();
  };
  visit(sf);
}

const byFile = new Map();
for (const r of found) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}
console.log(`=== 未走 tr() 的英文整句：${found.length} 处 / ${byFile.size} 个文件 ===`);
for (const [f, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n[${f}] ${list.length} 处`);
  for (const r of list.slice(0, 12)) console.log(`  L${r.line}: ${r.text.slice(0, 160)}`);
  if (list.length > 12) console.log(`  ... 另有 ${list.length - 12} 处`);
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(ROOT, 'tools/i18n/residual.json'), JSON.stringify(found, null, 2) + '\n', 'utf8');
  console.log('\n已写 tools/i18n/residual.json');
}

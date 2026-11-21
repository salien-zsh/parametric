/**
 * 不安全 tr() 还原器。
 *
 * 背景：模板字符串里拼接 CSS 类名的片段（class: `btn${primary ? ' primary' : ''}`）
 * 会被 codemod 当成文案抽成 tr(" primary")，翻译后 CSS 选择器失配、样式失效。
 * 本脚本用 AST 精确识别这类上下文，把 tr('...') 还原成原字符串，并同步
 * 从抽取清单与中文词典里剔除对应 key。
 *
 *   node tools/i18n/strip-unsafe.mjs          执行还原
 *   node tools/i18n/strip-unsafe.mjs --dry    只报告
 *
 * 可重复运行：已还原的文件不会被再次修改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-codemod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const DRY = process.argv.includes('--dry');

const CSS_PROPS = new Set(['class', 'className', 'cls']);
const CSS_VARS = /^(cls|className|classes|classNames)$/;
const TYPE_NODES = [
  'isLiteralTypeNode', 'isUnionTypeNode', 'isIntersectionTypeNode', 'isTypeLiteralNode',
  'isTypeReferenceNode', 'isTypeOperatorNode', 'isArrayTypeNode', 'isTupleTypeNode',
  'isParenthesizedTypeNode', 'isIndexedAccessTypeNode', 'isMappedTypeNode',
  'isConditionalTypeNode', 'isTemplateLiteralTypeNode', 'isFunctionTypeNode',
  'isTypeQueryNode', 'isTypeAliasDeclaration', 'isTypeParameterDeclaration',
];

const nameOf = (n) => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null);

/** 判断 tr() 调用是否处在不该翻译的上下文。 */
function unsafe(parents) {
  for (const p of parents) {
    if (ts.isPropertyAssignment(p) && CSS_PROPS.has(nameOf(p.name))) return 'CSS 属性 class/className';
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && CSS_VARS.test(p.name.text)) return 'CSS 类变量';
    if (TYPE_NODES.some((k) => ts[k]?.(p))) return '类型位置';
  }
  return null;
}

const files = [];
const collect = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
};
collect(SRC);

const removedKeys = new Set();
const report = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const edits = [];
  const chain = [];
  const visit = (node) => {
    const parents = chain.slice();
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'tr') {
      const arg = node.arguments[0];
      const why = unsafe(parents);
      if (why && arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        const raw = JSON.stringify(arg.text).replace(/^"/, "'").replace(/"$/, "'");
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: raw, key: arg.text });
        removedKeys.add(arg.text);
        report.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), key: arg.text, why });
        chain.push(node); ts.forEachChild(node, visit); chain.pop();
        return;
      }
    }
    chain.push(node); ts.forEachChild(node, visit); chain.pop();
  };
  visit(sf);
  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // 若文件已不再使用 tr，清掉自动插入的 import，避免 TS6133
  if (!/\btr\(/.test(out)) {
    out = out.replace(/^\s*import\s*\{\s*tr\s*\}\s*from\s*['"][^'"]*i18n['"];?\s*\n?/m, '').replace(/^\n+/, '');
  }
  if (!DRY) fs.writeFileSync(file, out, 'utf8');
}

console.log(`=== 不安全 tr() 还原 ${DRY ? '(dry run)' : ''} ===`);
console.log(`命中 ${report.length} 处，涉及 ${removedKeys.size} 条 key`);
for (const r of report) console.log(`  [${r.why}] ${r.file}: ${JSON.stringify(r.key)}`);

if (!DRY) {
  for (const fp of ['tools/i18n/en-US.generated.json', 'src/i18n/zh-CN.json']) {
    const p = path.join(ROOT, fp);
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const before = Object.keys(d).length;
    for (const k of removedKeys) delete d[k];
    fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8');
    console.log(`${fp}: ${before} -> ${Object.keys(d).length}`);
  }
}

/**
 * UI 文案抽取 / 替换 codemod。
 *
 * 把源码里面向用户的英文字符串字面量替换为 tr('英文原文')，并生成
 * src/i18n/en-US.json（全部 key）。key 用英文原文，未翻译的自动回退英文。
 *
 * 安全原则：只翻「人话」，绝不翻模型数据标识符。
 *   - 排除 type / kind / id / icon / class / path 等属性；
 *   - 排除 switch case、相等比较、对象 key、import 路径；
 *   - 排除 CSS 类名、SVG path、URL、文件路径、单个标识符；
 *   - h(tag, attrs, ...children) 的 attrs 里只有白名单属性可翻。
 *
 * 可重复运行：已有 t(...) 的节点不会再被处理；上游合并后重跑即可。
 *
 *   node tools/i18n/codemod.mjs          执行替换
 *   node tools/i18n/codemod.mjs --dry    只出报告，不改文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 项目构建用 TypeScript 7（native 编译器，不再导出 createSourceFile 等旧
// compiler API）；codemod 单独挂 TS 5 别名，互不影响。
import ts from 'typescript-codemod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const DRY = process.argv.includes('--dry');
/** 第二轮：在明确是 UI 的文件里放宽未知上下文，但危险上下文仍然一律排除。 */
const LOOSE = process.argv.includes('--loose');
/** --ui-args：只补「函数调用参数」中的文案，且排除下列危险函数，比 --loose 精准。 */
const UIARGS = process.argv.includes('--ui-args');
/**
 * --messages：补「非 UI 目录里的用户可见消息」。
 * kernel / model / sketch / platform / render 等目录下的 throw new Error、
 * return '...'、消息常量里存着大量建模错误提示，严格模式因目录不在 UI 范围
 * 而漏掉。这里用精确文件白名单 + 长句判定（≥4 个英文单词）收口，
 * 绝不放开 protocol.ts / expr.ts 这类协议与表达式标识符文件。
 */
const MESSAGES = process.argv.includes('--messages');
const MESSAGE_FILES = [
  /[\\/]src[\\/]kernel[\\/](?:build|client|occ|worker)\.ts$/,
  /[\\/]src[\\/]model[\\/]document\.ts$/,
  /[\\/]src[\\/]sketch[\\/]ops\.ts$/,
  /[\\/]src[\\/]platform[\\/](?:files|puter|ai)\.ts$/,
  /[\\/]src[\\/]render[\\/]renderer\.ts$/,
  /[\\/]src[\\/]app[\\/].*\.ts$/,
  /[\\/]src[\\/]ui[\\/].*\.ts$/,
];
const isMessageFile = (f) => MESSAGE_FILES.some((r) => r.test(f));
/** 消息模式只收「像一句话」的英文，挡住单个标识符、枚举值、路径。 */
const isLongMessage = (s) => isAsciiHuman(s) && (s.match(/[A-Za-z]{2,}/g) || []).length >= 4;

/**
 * 内部状态值 / 协议标记 / 格式缩写：形似大写单词但不是界面文案。
 * 翻了会直接破坏 PDF 语法（BT/ET）、HTML 标签（UL/OL）、单位系统（MMGS）等。
 * 注意：TITLE/SCALE/MATERIAL/UNITS/DATE/SHEET/NOTES 是图纸标题栏的真实标签，
 * 故意不在此列，它们应该中文化。
 */
const INTERNAL_TOKENS = new Set([
  'MMGS', 'CGS', 'MKS', 'IPS', 'BT', 'ET', 'FEFF', 'UL', 'OL', 'BOM',
  'ABS', 'PLA', 'PETG', 'PDF', 'SVG', 'PNG', 'DXF', 'STL', 'STEP', 'STP',
  'JSON', 'CSV', 'WASM', 'BREP', 'ASCII', 'UTF', 'RGB', 'HEX',
]);

/** 这些函数的字符串参数是选择器、事件名、CSS 类或日志，不是界面文案。 */
const DANGER_FUNCS = new Set([
  'querySelector', 'querySelectorAll', 'getElementById', 'setAttribute', 'getAttribute',
  'addEventListener', 'removeEventListener', 'getItem', 'setItem', 'removeItem',
  'matchMedia', 'RegExp', 'fetch', 'require', 'Worker', 'URL', 'open', 'close',
  'getExtension', 'getParameter', 'matches', 'closest', 'createElement', 'permissions',
  'log', 'warn', 'error', 'assert', 'describe', 'test', 'expect', 'toBe',
  'getByRole', 'getByText', 'includes', 'startsWith', 'endsWith', 'replace', 'split',
]);

/** 明确不进入的文件：协议、表达式、图标路径、SolidWorks 格式常量。 */
const EXCLUDE_FILES = [
  /[\\/]src[\\/]i18n[\\/]/,
  /[\\/]src[\\/]ui[\\/]icons\.ts$/,
  /[\\/]src[\\/]model[\\/](expr|types|units|validate-[a-z]+)\.ts$/,
  /[\\/]src[\\/]formats[\\/]sldprt[\\/]/,
  /[\\/]src[\\/]kernel[\\/]protocol\.ts$/,
  /[\\/]src[\\/]math[\\/]/,
];

/** 属性名白名单：这些值几乎必然是界面文案。 */
const TEXT_PROPS = new Set([
  'label', 'labels', 'description', 'desc', 'title', 'message', 'placeholder',
  'hint', 'tooltip', 'text', 'content', 'caption', 'help', 'summary', 'subtitle',
  'heading', 'empty', 'note', 'detail', 'prompt', 'keywords', 'alt',
  'aria-label', 'aria-description', 'aria-placeholder', 'error', 'success',
  'warning', 'info', 'okLabel', 'cancelLabel', 'primaryLabel', 'secondaryLabel',
  'name', 'unitLabel', 'sheetSize', 'viewName', 'statusText', 'footer', 'header',
]);

/** 属性名黑名单：这些值是数据/协议标识符，翻了会破坏 .parametric 文件。 */
const ID_PROPS = new Set([
  'type', 'kind', 'id', 'ids', 'icon', 'shortcut', 'class', 'className', 'path',
  'key', 'code', 'tag', 'role', 'accept', 'href', 'src', 'model', 'provider',
  'unit', 'suffix', 'enum', 'status', 'action', 'event', 'mode', 'value',
  'modelName', 'providerName', 'mime', 'media_type', 'extension', 'ext',
  'shortcutKey', 'command', 'cmd', 'op', 'fn', 'method', 'url', 'selector',
]);

/** 这些函数的字符串参数属于界面文案。 */
const TEXT_FUNCS = new Set([
  'announce', 'toast', 'confirmDialog', 'alertDialog', 'aboutDialog',
  'setWindowTitle', 'section', 'field', 'row', 'menuItem', 'tabLabel',
  'setStatus', 'statusText', 'showError', 'showWarning',
]);

/** 变量名含这些词的字符串常量按文案处理（如 RELATION_LABELS）。 */
const TEXT_VAR = /(LABEL|TITLE|TEXT|DESC|MESSAGE|HINT|ERROR|CAPTION|NAMES|TOOLTIP|PLACEHOLDER)/i;

const isAsciiHuman = (s) => {
  if (typeof s !== 'string' || s.length < 2 || s.length > 400) return false;
  if (!/^[\x20-\x7E]+$/.test(s)) return false;            // 只处理纯 ASCII
  // 至少含一个两字母单词（OK / No 这类短按钮也要抽出）。
  if (!/[A-Za-z]{2}/.test(s)) return false;
  // 以这些符号开头的一律是选择器 / 实体 / 格式串 / 状态值，不是人话。
  if (/^[%&<>=;"'#.,([{]/.test(s)) return false;
  if (/[{}<>[\]\\|`^~"=]/.test(s)) return false;          // 代码/模板/PDF 语法
  // 只排除小写标识符/路径（extrude、parametric-parts 等）；
  // File / OK / Cancel 这类首字母大写的单词是真实 UI 标签，必须保留。
  if (/^[a-z0-9_.\-/:]+$/.test(s)) return false;
  if (/^[A-Za-z][A-Za-z0-9_]*_[A-Za-z0-9_]+$/.test(s)) return false; // 常量名/扩展名：EXT_color_buffer_float
  if (/;\s*\S/.test(s)) return false;                            // 权限/策略列表：clipboard-read; clipboard-write
  if (/:(?:last|first|nth|only)-child|:hover|:focus|:active|:checked/.test(s)) return false; // CSS 伪类选择器
  if (INTERNAL_TOKENS.has(s.trim().toUpperCase())) return false; // 内部状态值/协议标记
  if (!/\s/.test(s) && !/^[A-Z]/.test(s)) return false;   // 单个词必须首字母大写
  if (/^(https?:\/\/|www\.|\/|\.\/|#|--|var\(|data:|@media|calc\()/.test(s)) return false;
  if (/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+\-]+$/.test(s)) return false; // SVG path
  if (/\.(ts|js|json|css|html|wasm|step|stp|sldprt|png|svg)\b/i.test(s)) return false;
  if (/^(Ctrl|Alt|Shift|Control|Meta)\b/.test(s)) return false;
  if (/^\(\s*(max|min)-width|^\(\s*pointer:/.test(s)) return false; // media query
  return true;
};

function propName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return null;
}

/** 收集每个节点到根的祖先链，用于危险上下文判定。 */
function analyze(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const edits = [];
  const skipped = [];
  const keys = new Set();

  const chain = [];
  // 携带祖先链遍历：调用 visit(child) 时 chain 顶部即 child 的父节点
  const visit = (node) => {
    const parents = chain.slice();
    const parent = parents[parents.length - 1];
    let replaced = false;

    // Existing tr("...") calls are already translated, but their keys still
    // belong in the generated inventory. Without this, adding new tr() strings
    // by hand bypasses extraction and the dictionary silently stays incomplete.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'tr') {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        keys.add(arg.text);
      } else if (arg && ts.isTemplateExpression(arg)) {
        const built = buildTemplate(arg, sf);
        if (built) keys.add(built.key);
      }
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const s = node.text;
      if (isAsciiHuman(s) && safeContext(node, parent, parents, s)) {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tr(${JSON.stringify(s)})` });
        keys.add(s);
        replaced = true;
      } else if (isAsciiHuman(s)) {
        skipped.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: s.slice(0, 70) });
      }
    } else if (ts.isTemplateExpression(node)) {
      const built = buildTemplate(node, sf);
      if (built && isAsciiHuman(built.key) && safeContext(node, parent, parents, built.key)) {
        const args = built.exprs.length ? `, [${built.exprs.join(', ')}]` : '';
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tr(${JSON.stringify(built.key)}${args})` });
        keys.add(built.key);
        replaced = true;
      }
    }

    if (!replaced) {
      chain.push(node);
      ts.forEachChild(node, visit);
      chain.pop();
    }
    // 已整体替换的节点不再进入子树（模板串的插值表达式保留在参数中）
  };
  visit(sf);
  return { sf, edits, skipped, keys };
}

/** 模板串 -> key + 表达式列表：`Hello ${v}.` -> "Hello {0}." + [v] */
function buildTemplate(node, sf) {
  let key = node.head.text;
  const exprs = [];
  for (let i = 0; i < node.templateSpans.length; i++) {
    const span = node.templateSpans[i];
    key += `{${i}}` + span.literal.text;
    const e = span.expression.getText(sf).trim();
    exprs.push(e);
  }
  return { key, exprs };
}

/** 判断字符串节点是否处在可以安全翻译的上下文。 */
function safeContext(node, parent, parents, s) {
  // CSS 类名拼接片段绝不翻：`class: \`btn${primary ? ' primary' : ''}\`` 里的
  // ' primary' 被替换成 tr(" primary") 后，中文类名会让选择器失配、样式失效。
  // 同类还有 const cls = `dim-label${...}` 这种 CSS 类变量。
  for (const p of parents) {
    if (ts.isPropertyAssignment(p) && ['class', 'className', 'cls'].includes(propName(p.name))) return false;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) &&
        /^(cls|className|classes|classNames)$/.test(p.name.text)) return false;
  }
  // 类型位置绝不翻：'MMGS' | 'CGS' 这类字面量联合类型若被替换成
  // tr("MMGS") | tr("CGS")，会直接造成 TS1005 语法错误并污染持久化数据。
  if (parents.some((p) =>
    ts.isLiteralTypeNode?.(p) || ts.isUnionTypeNode?.(p) || ts.isIntersectionTypeNode?.(p) ||
    ts.isTypeLiteralNode?.(p) || ts.isTypeReferenceNode?.(p) || ts.isTypeOperatorNode?.(p) ||
    ts.isArrayTypeNode?.(p) || ts.isTupleTypeNode?.(p) || ts.isParenthesizedTypeNode?.(p) ||
    ts.isIndexedAccessTypeNode?.(p) || ts.isMappedTypeNode?.(p) || ts.isConditionalTypeNode?.(p) ||
    ts.isTemplateLiteralTypeNode?.(p) || ts.isFunctionTypeNode?.(p) || ts.isTypeQueryNode?.(p) ||
    ts.isTypeAliasDeclaration?.(p) || ts.isTypeParameterDeclaration?.(p))) return false;
  // 放宽模式：祖先链里出现危险函数调用时一律不动（防 CSS 类、选择器、事件名被翻）。
  if ((LOOSE || UIARGS || MESSAGES) && parents.some((p) => ts.isCallExpression(p) && DANGER_FUNCS.has(callName(p)))) return false;
  // 已经是 tr(...) 的参数（可重复运行）
  if (parent && ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'tr') return false;
  // import / export 说明符、模块名
  for (const p of parents) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return false;
    if (ts.isImportEqualsDeclaration?.(p)) return false;
  }
  // 对象 key（{ 'Some text': v }）
  if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return false;
  // switch case / 相等比较 / typeof / instanceof
  if (parent && (ts.isCaseClause(parent) ||
    (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)))) return false;
  // new URL / fetch / import()
  if (parent && ts.isCallExpression(parent) && ['URL', 'fetch', 'require', 'import'].includes(
    ts.isIdentifier(parent.expression) ? parent.expression.text : '')) return false;

  // --messages：白名单文件里的英文长句统一放行。危险上下文（类型位置、
  // CSS 类、选择器、事件名、对象 key、相等比较、import）均已在上面拦截。
  if (MESSAGES && isMessageFile(node.getSourceFile()?.fileName || '') && isLongMessage(s)) {
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node &&
        ID_PROPS.has(propName(parent.name))) return false;
    // h(tag, attrs, ...) 的 attrs 里除白名单属性外都是 class / allow / policy 值
    if (insideHAttrs(node, parents)) return false;
    return true;
  }

  // 属性赋值：白名单优先，黑名单直接否
  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const n = propName(parent.name);
    if (n && ID_PROPS.has(n)) return false;
    if (n && TEXT_PROPS.has(n)) return !insideHAttrs(node, parents);
    // h(tag, attrs, ...) 里的未知属性多是 class / style 值，绝不能翻
    if (insideHAttrs(node, parents)) return false;
    return (LOOSE || UIARGS) && isUiFile(node.getSourceFile()?.fileName || '');
  }

  // 变量声明 / 赋值
  if (parent && (ts.isVariableDeclaration(parent) || ts.isBinaryExpression(parent)) && isAsciiHuman(node.text)) {
    const owner = findOwner(parents);
    if (owner && TEXT_VAR.test(owner)) return true;
  }
  if (parent && ts.isPropertyAccessExpression(parent)) return false;

  // 函数调用参数
  if (parent && ts.isCallExpression(parent)) {
    const fname = callName(parent);
    const idx = parent.arguments.indexOf(node);
    if (fname === 'h') {
      if (idx <= 1) return false;              // tag 与 attrs 不翻
      return !insideHAttrs(node, parents);     // 文本子节点
    }
    if (fname === 'append' || fname === 'tr' || fname === 'icon' || fname === 'fetch' || fname === 'import') return false;
    if (TEXT_FUNCS.has(fname)) return true;
    // 其余函数：h 的 children 数组里的元素
    if (ts.isArrayLiteralExpression(parent.parent) || ts.isArrayLiteralExpression(node.parent)) {
      const arr = ts.isArrayLiteralExpression(parent) ? parent : node.parent;
      const up = parents.findLast ? parents.findLast((p) => ts.isCallExpression(p)) : parents.filter((p) => ts.isCallExpression(p)).pop();
      if (up && callName(up) === 'h' && up.arguments.indexOf(arr) >= 2) return true;
    }
    return (LOOSE || UIARGS) && isUiFile(node.getSourceFile()?.fileName || '');
  }

  // 数组元素：若数组是白名单属性的值（如 keywords 的分词）或 h 的 children
  if (parent && ts.isArrayLiteralExpression(parent)) {
    const grand = parents[parents.length - 2];
    if (grand && ts.isPropertyAssignment(grand)) {
      const n = propName(grand.name);
      if (n && TEXT_PROPS.has(n)) return true;
      if (n && ID_PROPS.has(n)) return false;
    }
    return (LOOSE || UIARGS) && isUiFile(node.getSourceFile()?.fileName || '');
  }

  // return / throw new Error 中的纯文案：仅在明确 UI 目录下放行
  if (parent && (ts.isReturnStatement(parent) || ts.isNewExpression(parent))) {
    return isUiFile(node.getSourceFile()?.fileName || '');
  }
  return (LOOSE || UIARGS) && isUiFile(node.getSourceFile()?.fileName || '');
}

function callName(call) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return '';
}

/** h() 的第二个参数（attrs）里的字符串，除白名单属性外一律不翻。 */
function insideHAttrs(node, parents) {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (ts.isObjectLiteralExpression(p)) {
      // 找这个对象是不是某个 h 调用的第二个参数
      const c = parents[i - 1];
      if (c && ts.isCallExpression(c) && callName(c) === 'h' && c.arguments[1] === p) {
        // 若节点挂在白名单属性下，交给属性规则处理
        const holder = parents.slice(i + 1).find((x) => ts.isPropertyAssignment(x));
        const n = holder ? propName(holder.name) : null;
        return !(n && TEXT_PROPS.has(n));
      }
    }
  }
  return false;
}

function findOwner(parents) {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isPropertyAssignment(p)) return propName(p.name) || '';
  }
  return null;
}

function isUiFile(f) {
  return /[\\/]src[\\/](app|ui|assistant|drawing)[\\/]/.test(f);
}

// ---- 主流程 ----
const files = [];
const collect = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith('.ts') && !EXCLUDE_FILES.some((r) => r.test(p))) files.push(p);
  }
};
collect(SRC);

const allKeys = new Set();
let totalEdits = 0;
const perFile = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const { sf, edits, skipped, keys } = analyze(file, text);
  for (const k of keys) allKeys.add(k);
  if (!edits.length) { perFile.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), edits: 0, skipped: skipped.length }); continue; }

  // 排序去重（模板串与子表达式理论上不重叠，做一层保护）
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  let last = Infinity;
  for (const e of edits) {
    if (e.end > last) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }

  // 插入 import（若文件尚未引入 tr）
  if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from\s*['"][^'"]*i18n['"]/.test(out)) {
    const imports = [...sf.statements].filter((s) => ts.isImportDeclaration(s));
    const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
    let rel = path.relative(path.dirname(file), path.join(SRC, 'i18n')).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    const stmt = `import { tr } from '${rel}';`;
    // at === 0（文件原本没有 import）时避免把 import 与首个声明挤在同一行。
    out = at === 0
      ? `${stmt}\n` + out.replace(/^[ \t]*\r?\n/, '')
      : out.slice(0, at) + `\n${stmt}` + out.slice(at);
  }

  totalEdits += edits.length;
  perFile.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), edits: edits.length, skipped: skipped.length });
  if (!DRY) fs.writeFileSync(file, out, 'utf8');
}

// 多轮运行合并：保留前几轮抽出的 key，字典不会因重跑而丢条目。
const enPath = path.join(ROOT, 'tools/i18n/en-US.generated.json');
if (fs.existsSync(enPath)) {
  for (const k of Object.keys(JSON.parse(fs.readFileSync(enPath, 'utf8')))) allKeys.add(k);
}
const sorted = [...allKeys].sort();
if (!DRY) {
  const dict = Object.fromEntries(sorted.map((k) => [k, k]));
  fs.writeFileSync(enPath, JSON.stringify(dict, null, 2) + '\n', 'utf8');
  const zhPath = path.join(SRC, 'i18n/zh-CN.json');
  if (!fs.existsSync(zhPath)) fs.writeFileSync(zhPath, '{}\n', 'utf8');
}
fs.writeFileSync(path.join(ROOT, 'tools/i18n/report.json'), JSON.stringify({
  files: files.length, edits: totalEdits, uniqueKeys: sorted.length, perFile,
}, null, 2) + '\n', 'utf8');

console.log(`${DRY ? '[dry] ' : ''}扫描 ${files.length} 个文件，替换 ${totalEdits} 处，唯一文案 ${sorted.length} 条`);
console.log('改动最多的文件：');
for (const r of perFile.sort((a, b) => b.edits - a.edits).slice(0, 12)) console.log(`  ${String(r.edits).padStart(4)}  ${r.file}`);

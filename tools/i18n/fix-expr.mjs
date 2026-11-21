/**
 * 表达式求值器错误消息中文化（一次性、可重复运行）。
 *
 * src/model/expr.ts 被 codemod 的 EXCLUDE_FILES 排除——里面全是函数名、
 * 常量名、单位后缀，自动抽取极易误伤。这里按精确字符串逐条替换为 tr()，
 * 只动 throw new ExprError(...) 里的用户可见消息，不碰任何标识符。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'src/model/expr.ts');

/** [原文, 替换后]，按长度降序避免子串误替换。 */
const PAIRS = [
  ['`A unit ("${u.v}") cannot be used here; give a plain number`', 'tr(\'A unit ("{0}") cannot be used here; give a plain number\', [u.v])'],
  ['`${t.v}() takes ${variadic ? \'one or more values\' : \'one value\'}`', 'tr(\'{0}() takes {1}\', [t.v, variadic ? tr(\'one or more values\') : tr(\'one value\')])'],
  ['`Unknown function "${t.v}"`', 'tr(\'Unknown function "{0}"\', [t.v])'],
  ['`Unknown name "${t.v}"`', 'tr(\'Unknown name "{0}"\', [t.v])'],
  ['`Expected "${v}"`', 'tr(\'Expected "{0}"\', [v])'],
  ['`Unexpected "${ch}"`', 'tr(\'Unexpected "{0}"\', [ch])'],
  ['`"${n}" has an error`', 'tr(\'"{0}" has an error\', [n])'],
  ['`Unknown name "${n}"`', 'tr(\'Unknown name "{0}"\', [n])'],
  ["'Unexpected end of expression'", "tr('Unexpected end of expression')"],
  ["'Unexpected text after expression'", "tr('Unexpected text after expression')"],
  ["'Result is not a finite number'", "tr('Result is not a finite number')"],
  ["'Unclosed quote'", "tr('Unclosed quote')"],
  ["'Division by zero'", "tr('Division by zero')"],
  ["'Enter a value'", "tr('Enter a value')"],
];

let s = fs.readFileSync(FILE, 'utf8');
const done = [];
for (const [from, to] of PAIRS) {
  const n = s.split(from).length - 1;
  if (!n) { console.log('  未找到（可能已处理）:', from); continue; }
  s = s.split(from).join(to);
  done.push(`${n} 处  ${from.slice(0, 70)}`);
}
if (!/\bfrom ['"][^'"]*i18n['"]/.test(s)) {
  s = `import { tr } from '../i18n';\n` + s;
  done.push('插入 import { tr }');
}
fs.writeFileSync(FILE, s, 'utf8');
console.log(`=== expr.ts 已替换 ${done.length} 项 ===`);
for (const d of done) console.log('  ' + d);

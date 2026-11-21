/**
 * 抽取清单质量审计。
 *
 * 用途：codemod 抽出 en-US.generated.json 后，逐条识别「不是人话」的 key
 * （CSS 选择器、PDF 操作符、事件名、内部状态值、文件扩展名等），
 * 并核对源码里 tr() 的实际参数与清单是否一致。
 *
 *   node tools/i18n/audit.mjs            打印报告
 *   node tools/i18n/audit.mjs --json    同时写 tools/i18n/audit.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/i18n/en-US.generated.json'), 'utf8'));
const ZH = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/zh-CN.json'), 'utf8'));

/** 绝非界面文案的模式。命中即视为「误抽」，应从清单中剔除并还原源码里的 tr()。 */
const BAD = [
  ['CSS/选择器/属性', /(^|[\s(])(class=|style=|data-|aria-|onclick=|max-width|min-width|font-|line-height|px\b|em\b|:hover|::before|#[a-f0-9]{3,8}\b|\.[a-z][a-z-]+\s*\{)/i],
  ['HTML/代码片段', /[{}<>\[\]\\|`^~]|=>|&(amp|lt|gt|nbsp|quot);|\b(undefined|null|NaN)\b/i],
  ['全小写单词串', /^[a-z0-9 _.,:;!?()/\-]+$/],
  ['URL/路径/扩展名', /https?:\/\/|www\.|\.(ts|js|mjs|json|css|html|wasm|svg|png|jpg|step|stp|sldprt|pdf|stl|dxf|csv)\b|\/[a-z-]+\//i],
  ['PDF/协议操作符', /^(%PDF|BT|ET|FEFF|Tj|Td|Tf|Tm|cm|re|W|n|Q|q|BI|ID|EI|xref|trailer|startxref|obj|endobj)\b/i],
  ['单位/格式/材料缩写', /^(MMGS|CGS|MKS|IPS|BT|ET|FEFF|UL|OL|BOM|ABS|PLA|PETG|PDF|SVG|PNG|DXF|STL|STEP|STP|JSON|CSV|WASM|BREP|ASCII|UTF|RGB|HEX)$/i],
  ['快捷键/按键名', /^(Ctrl|Alt|Shift|Control|Meta|Esc|Enter|Tab|Space|Del|Delete|Home|End|PageUp|PageDown|F\d{1,2})\b/i],
  ['事件/API 标识符', /^(on|get|set|add|remove|create|update|delete|is|has|to)[A-Z]|(Event|Handler|Callback|Listener)$/],
  ['单个短标识符', /^[A-Za-z0-9]{1,3}$/],
  ['SVG path 指令', /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+\-]+$/],
  ['媒体查询', /^\(\s*(max|min)-width|^\(\s*pointer:/],
  ['数字/尺寸串', /^\s*[\d.,+\-×x\s°%]+\s*$/],
];

const keys = Object.keys(EN);
const flagged = new Map();
for (const k of keys) {
  for (const [name, re] of BAD) {
    if (re.test(k)) {
      if (!flagged.has(k)) flagged.set(k, []);
      flagged.get(k).push(name);
      break;
    }
  }
}

// 源码里实际存在的 tr() 参数
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
walk(path.join(ROOT, 'src'));

const unusedKeys = keys.filter((k) => !used.has(k));
const missingKeys = [...used].filter((k) => !(k in EN));
const untranslated = keys.filter((k) => !(k in ZH));

console.log('=== 抽取清单质量审计 ===');
console.log(`清单 key 总数        : ${keys.length}`);
console.log(`源码实际 tr() 参数   : ${used.size}`);
console.log(`中文词典条目         : ${Object.keys(ZH).length}`);
console.log(`可疑误抽             : ${flagged.size}`);
console.log(`清单中源码已不用     : ${unusedKeys.length}`);
console.log(`源码有但清单缺失     : ${missingKeys.length}`);
console.log(`未翻译（回退英文）   : ${untranslated.length}`);

if (flagged.size) {
  console.log('\n--- 可疑误抽明细（按类别归并，最多 120 条）---');
  const byCat = new Map();
  for (const [k, cats] of flagged) {
    const c = cats[0];
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(k);
  }
  for (const [c, list] of byCat) {
    console.log(`\n[${c}] ${list.length} 条`);
    for (const k of list.slice(0, 40)) console.log('  ' + k.slice(0, 110));
  }
}
if (unusedKeys.length) {
  console.log('\n--- 清单中源码已不用的 key（最多 40 条）---');
  for (const k of unusedKeys.slice(0, 40)) console.log('  ' + k.slice(0, 110));
}
if (missingKeys.length) {
  console.log('\n--- 源码有但清单缺失（最多 40 条）---');
  for (const k of missingKeys.slice(0, 40)) console.log('  ' + k.slice(0, 110));
}

if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(ROOT, 'tools/i18n/audit.json'), JSON.stringify({
    totalKeys: keys.length, usedInSource: used.size, dictEntries: Object.keys(ZH).length,
    flagged: [...flagged].map(([en, cats]) => ({ en, cats })),
    unusedKeys, missingKeys, untranslated,
  }, null, 2) + '\n', 'utf8');
  console.log('\n已写 tools/i18n/audit.json');
}

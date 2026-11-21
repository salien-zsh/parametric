// 中文界面文案层。
//
// 设计约定：字典的 key 就是英文原文。这样有三个好处：
//   1. 未收录的条目自动回退英文，可以渐进补全，不会出现空白或 "missing key"；
//   2. codemod 把字面量替换成 t('原文') 时不需要生成/维护语义 key；
//   3. 上游合并新代码后重跑 codemod，旧字典仍然有效。
//
// 插值统一用 {0} {1} ...（模板串）或 {name}（具名对象），两者可混用。
// 注意：模型数据里的 type / kind / 面边名称 / 表达式函数名绝不走这里，
// 它们要原样写入 .parametric 文件，翻译会破坏旧文件的兼容性。

import zhCN from './zh-CN.json';

export type Lang = 'zh-CN' | 'en-US';

const DICTS: Record<Lang, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  'en-US': {},
};

const STORAGE_KEY = 'parametric:lang';
const listeners = new Set<() => void>();

let lang: Lang = readLang();

function readLang(): Lang {
  // 单元测试固定英文：既有的 555 个断言基于英文界面文案，
  // 界面语言属于表现层，不应影响业务逻辑测试。E2E 用 addInitScript 同理处理。
  if (import.meta.env?.MODE === 'test') return 'en-US';
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 存储不可用 */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

/** 语言切换后由界面层重新渲染；返回取消订阅函数。 */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 开发期收集未翻译的 key，便于生成补全报告。 */
const missing = new Set<string>();
export function missingKeys(): string[] {
  return [...missing];
}

export type TVars = Record<string, string | number> | (string | number)[] | undefined;

function interpolate(text: string, vars: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = Array.isArray(vars) ? vars[Number(name)] : vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/**
 * 翻译一条界面文案。未命中字典时原样返回英文原文（en-US 模式同样返回原文）。
 */
export function t(en: string, vars?: TVars): string {
  if (lang === 'en-US') return interpolate(en, vars);
  const hit = DICTS['zh-CN'][en];
  if (hit === undefined) {
    if (import.meta.env?.DEV) missing.add(en);
    return interpolate(en, vars);
  }
  return interpolate(hit, vars);
}

// 源码里草图参数、计时器等大量使用局部变量 t，故 codemod 统一用 tr 别名，
// 避免 import 名与局部变量冲突（TDZ / shadowing）。
export const tr = t;

/** 字典覆盖率（0~1），用于设置里的「界面语言」状态显示。 */
export function coverage(dictEn: Record<string, string>): number {
  const all = Object.keys(dictEn);
  if (!all.length) return 1;
  const done = all.filter((k) => DICTS['zh-CN'][k] !== undefined).length;
  return done / all.length;
}

/** 启动时把 <html lang> 与当前语言对齐。 */
export function initI18n() {
  document.documentElement.lang = lang;
}

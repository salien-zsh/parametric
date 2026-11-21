// 界面中文化专项回归：验证字典层行为与词典完整性。
// 业务逻辑测试固定英文（见 src/i18n/index.ts 的 readLang），这里显式切到中文验证。
import { describe, it, expect, afterEach } from 'vitest';
import { t, tr, setLang, getLang } from '../src/i18n';
import zh from '../src/i18n/zh-CN.json';
import en from '../tools/i18n/en-US.generated.json';

describe('界面中文化', () => {
  afterEach(() => setLang('en-US'));

  it('测试环境固定英文，保证既有断言不受界面语言影响', () => {
    expect(getLang()).toBe('en-US');
    expect(t('Add Constraint')).toBe('Add Constraint');
  });

  it('中文模式返回中文文案，且 tr 与 t 等价', () => {
    setLang('zh-CN');
    expect(getLang()).toBe('zh-CN');
    expect(tr('Add Constraint')).toBe('添加约束');
    expect(t('OK')).toBe('确定');
    expect(t('Extruded Boss')).toBe('拉伸凸台');
    expect(t('Assembly Mate')).toBe('装配配合');
    expect(t('Revolute')).toBe('旋转关节');
    expect(t('Slider')).toBe('滑块关节');
    expect(t('Interference Check')).toBe('干涉检查');
  });

  it('未收录的文案原样回退英文，不会出现空白或 missing key', () => {
    setLang('zh-CN');
    expect(t('Some brand new string')).toBe('Some brand new string');
  });

  it('插值支持具名参数与序号参数', () => {
    setLang('zh-CN');
    expect(t('Hello {0} and {1}', ['甲', '乙'])).toBe('Hello 甲 and 乙');
    expect(t('Hello {name}', { name: '张工' })).toBe('Hello 张工');
  });

  it('字典条目均为有效中文，且 key 全部来自 codemod 抽取清单', () => {
    const keys = Object.keys(zh as Record<string, string>);
    expect(keys.length).toBeGreaterThan(300);
    for (const k of keys) {
      const v = (zh as Record<string, string>)[k];
      expect(v).not.toBe(k);
      expect(/[\u4e00-\u9fff]/.test(v)).toBe(true);
      expect(k in (en as Record<string, string>)).toBe(true);
    }
  });
});

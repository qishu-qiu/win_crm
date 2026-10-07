import { isFieldFilled } from './field-filled';

describe('B 域纯规则 · 字段「是否已填」（E8 签约校验）', () => {
  it('非空字符串 ＝ 已填', () => {
    expect(isFieldFilled('91310000MA1FL0XXXX')).toBe(true);
  });

  it('null / undefined / 空串 ＝ 未填（E8「非空即过」）', () => {
    expect(isFieldFilled(null)).toBe(false);
    expect(isFieldFilled(undefined)).toBe(false);
    expect(isFieldFilled('')).toBe(false);
  });

  it('★ 纯空格算未填（否则敲一串空格就能绕过签约必填）', () => {
    expect(isFieldFilled('   ')).toBe(false);
    expect(isFieldFilled('\t\n ')).toBe(false);
  });

  it('有内容的带空格串仍算已填（不误杀正常录入，如「上海市 浦东新区」）', () => {
    expect(isFieldFilled(' 上海市浦东新区 ')).toBe(true);
  });

  it('非字符串（防御：口径只对文本列生效）一律未填', () => {
    expect(isFieldFilled(123 as unknown as string)).toBe(false);
  });
});
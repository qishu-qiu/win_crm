// =============================================================================
// 手机号归一用例（M2-07）
// 判据逐字（《开发计划-V1》）：「手机号规范化（去空格 / `+86` / `-`）纯函数；
//   单测：**≥5 种写法归一到同一号码**」—— 本文件的核心断言就是「下面 8 种写法全等」。
// ★ 这条守的是**撞单**：归一漏一种写法，同一个号就会建出两行，且 `uk_phone_active` 拦不住。
// =============================================================================
import { isEmptyPhone, isMainlandMobile, normalizeContactPhone } from './contact-phone';

const CANONICAL = '13800000000';

describe('联系人手机号归一（domain/contact-phone · M2-07）', () => {
  describe('≥5 种写法 → 同一个号码（判据本体）', () => {
    it.each([
      ['原样', '13800000000'],
      ['中间夹空格', '138 0000 0000'],
      ['连字符分段（销售最常见）', '138-0000-0000'],
      ['带国际码 ＋ 加号', '+86 138 0000 0000'],
      ['带国际码（无加号）', '8613800000000'],
      ['带 00 前缀的国际码', '0086-138-0000-0000'],
      ['全角数字（从微信 / Excel 粘来的）', '１３８００００００００'],
      ['括号 ＋ 空格混写', '(86) 138 0000 0000'],
    ])('%s：%s', (_name, raw) => {
      expect(normalizeContactPhone(raw)).toBe(CANONICAL);
    });

    it('**所有写法归一到同一个值**（逐个比对，避免「各自等于期望」却彼此不等）', () => {
      const raws = [
        '13800000000',
        '138 0000 0000',
        '138-0000-0000',
        '+8613800000000',
        '+86-138-0000-0000',
        '１３８ ００００ ００００',
      ];

      const normalized = new Set(raws.map((raw) => normalizeContactPhone(raw)));

      expect(normalized.size).toBe(1);
      expect([...normalized][0]).toBe(CANONICAL);
    });
  });

  describe('不许把真号改坏（去国家码的前置条件）', () => {
    it('11 位号以 1 开头 → 原样保留（不因为「像 86」就砍）', () => {
      expect(normalizeContactPhone('13300000000')).toBe('13300000000');
    });

    it('**短号 / 座机含 86 但不带国家码** → 原样保留（若先砍 `86` 就会改坏真号）', () => {
      expect(normalizeContactPhone('86123456')).toBe('86123456');
      expect(normalizeContactPhone('0551-86123456')).toBe('055186123456');
    });

    it('座机 / 分机（规格未限定必须是手机号）→ 只归一、不拒绝、不截断', () => {
      expect(normalizeContactPhone('(0551) 6666 8888')).toBe('055166668888');
      expect(normalizeContactPhone('010-8888-6666-123')).toBe('01088886666123');
    });
  });

  describe('辅助判定（**仅供提示，不用于拦截**）', () => {
    it('11 位国内号 → isMainlandMobile 为真', () => {
      expect(isMainlandMobile('+86 138 0000 0000')).toBe(true);
    });

    it('座机 → 假（但**不代表号码非法**：规格没把 `contact.phone` 限定成手机号）', () => {
      expect(isMainlandMobile('0551-66668888')).toBe(false);
    });

    it('只有空白 / 分隔符 → 视为「等于没填」', () => {
      expect(isEmptyPhone('   ')).toBe(true);
      expect(isEmptyPhone('--')).toBe(true);
      expect(isEmptyPhone('+86')).toBe(false); // 归一后是 '86'：不空，交给人判
    });

    it('空串 → 归一为空串，不抛错（脏数据不该把建联系人打成 500）', () => {
      expect(normalizeContactPhone('')).toBe('');
    });
  });
});

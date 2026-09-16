// =============================================================================
// C 域纯规则用例（M3-10 改属性）
// 判据来源：《数据架构文档》C1「★ 校验（2026-09-10 定）：`urgency != gray` 的关系
//   **必须已标 `value_tier`** —— 紧迫档离开灰度时服务端 **422** 拦截」；
//   废止口径 #25：「愿标才标」**只适用于灰度**，非灰度**必标**。
// =============================================================================
import {
  COMPETITION_VALUES,
  URGENCY_VALUES,
  VALUE_TIER_VALUES,
  checkValueTierForUrgency,
  isKnownCompetition,
  isKnownUrgency,
  isKnownValueTier,
} from './relation-attributes';

describe('relation-attributes（M3-10）', () => {
  describe('枚举白名单（→ C1；新增值必须先在规格里出现）', () => {
    it('紧迫档 5 值、开发价值 4 值、竞品态 3 值', () => {
      expect(URGENCY_VALUES).toEqual(['weekly', 'monthly', 'quarterly', 'long_term', 'gray']);
      expect(VALUE_TIER_VALUES).toEqual(['high', 'medium', 'low', 'pending']);
      expect(COMPETITION_VALUES).toEqual(['none', 'in_use', 'comparing']);
    });

    it.each([
      ['weekly', true],
      ['gray', true],
      ['daily', false],
      ['', false],
      ['WEEKLY', false],
    ])('isKnownUrgency(%s) → %s（大小写敏感：码值是枚举，不是人输入的自由文本）', (value, expected) => {
      expect(isKnownUrgency(value as string)).toBe(expected);
    });

    it('isKnownValueTier / isKnownCompetition 同规则', () => {
      expect(isKnownValueTier('high')).toBe(true);
      expect(isKnownValueTier('urgent')).toBe(false);
      expect(isKnownCompetition('in_use')).toBe(true);
      expect(isKnownCompetition('comparing_2')).toBe(false);
    });
  });

  describe('checkValueTierForUrgency：非灰度必标开发价值', () => {
    it('灰度（gray）＋ 未标 → 放行（灰度方可留待定，→ 废止口径 #25）', () => {
      expect(checkValueTierForUrgency('gray', null)).toEqual({ ok: true });
    });

    it('灰度 ＋ 已标 → 放行', () => {
      expect(checkValueTierForUrgency('gray', 'high')).toEqual({ ok: true });
    });

    it.each(['weekly', 'monthly', 'quarterly', 'long_term'])(
      '%s ＋ 已定档（high）→ 放行',
      (urgency) => {
        expect(checkValueTierForUrgency(urgency, 'high')).toEqual({ ok: true });
      },
    );

    it.each(['weekly', 'long_term'])('%s ＋ **未标（null）** → 拒（正是判据本体）', (urgency) => {
      expect(checkValueTierForUrgency(urgency, null)).toEqual({ ok: false, kind: 'value_tier_required' });
    });

    it('非灰度 ＋ `pending`（＝待定）→ **放行**（2026-09-15 七叔拍板：「只要标了就行，高/中/低还是其他都可」）', () => {
      expect(checkValueTierForUrgency('weekly', 'pending')).toEqual({ ok: true });
    });

    it('非灰度 ＋ 非法值 → 拒（枚举合法性另有 DTO 白名单，这里是第二道）', () => {
      expect(checkValueTierForUrgency('weekly', 'very_high')).toEqual({
        ok: false,
        kind: 'value_tier_required',
      });
    });
  });
});

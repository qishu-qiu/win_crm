// =============================================================================
// D 域纯规则用例（M4-04）—— 「有效沟通」判定
//
// 判据逐字（《过程产出/开发计划-V1.md》M4-04）：
//   「`domain/event-effective.ts`：**有效沟通**判定纯函数（快速标记**不算**）」
//   → 单测：有效 / 快速标记 → **不同结果**。
// 口径：《销售CRM数据架构文档》D2 ＋《销售CRM业务需求文档》§10.2。
// =============================================================================
import {
  ACTION_TYPES,
  EFFECTIVE_OUTCOMES,
  OUTCOME_VALUES,
  QUICK_MARK_OUTCOMES,
  SUMMARY_MAX_LENGTH,
  isEffectiveCommunication,
  isKnownActionType,
  isKnownOutcome,
  isQuickMarkOutcome,
  isSummaryRequired,
} from './event-effective';

describe('event-effective（M4-04）', () => {
  describe('枚举白名单（→ D2；新增值必须先在规格里出现）', () => {
    it('动作类型 11 值（含客情 meal / gift / greeting 与 @求助 ask_help）', () => {
      expect(ACTION_TYPES).toEqual([
        'phone',
        'wechat',
        'visit',
        'onsite',
        'email',
        'meal',
        'gift',
        'greeting',
        'ask_help',
        'note',
        'system',
      ]);
    });

    it('快速标记三型（→ 需求 §10.2「未联系 / 未接电话 / 说两句挂了」）', () => {
      expect(QUICK_MARK_OUTCOMES).toEqual(['not_contacted', 'no_answer', 'brief_hangup']);
    });

    it('有效沟通三型 ＋ 快速标记三型 ＝ outcome 全量 6 值', () => {
      expect(EFFECTIVE_OUTCOMES).toEqual(['advanced', 'stalled', 'await_reply']);
      expect(OUTCOME_VALUES).toHaveLength(6);
    });

    it('一句话结果上限 200 字（→ D2 `summary` ≤ 200 字）', () => {
      expect(SUMMARY_MAX_LENGTH).toBe(200);
    });

    it.each([
      ['phone', true],
      ['meal', true],
      ['system', true],
      ['sms', false],
      ['', false],
      ['PHONE', false],
    ])('isKnownActionType(%s) → %s（码值是枚举，大小写敏感）', (value, expected) => {
      expect(isKnownActionType(value as string)).toBe(expected);
    });

    it.each([
      ['advanced', true],
      ['brief_hangup', true],
      ['connected', false],
      ['', false],
    ])('isKnownOutcome(%s) → %s', (value, expected) => {
      expect(isKnownOutcome(value as string)).toBe(expected);
    });
  });

  describe('isQuickMarkOutcome：三型才算快速标记（**空值不算**）', () => {
    it.each(['not_contacted', 'no_answer', 'brief_hangup'])('%s → true', (outcome) => {
      expect(isQuickMarkOutcome(outcome)).toBe(true);
    });

    it.each([['advanced'], ['stalled'], ['await_reply']])('%s → false', (outcome) => {
      expect(isQuickMarkOutcome(outcome)).toBe(false);
    });

    it('空串 / null / undefined → **false**（点选框没动过 ≠ 勾了「未联系」）', () => {
      expect(isQuickMarkOutcome('')).toBe(false);
      expect(isQuickMarkOutcome(null)).toBe(false);
      expect(isQuickMarkOutcome(undefined)).toBe(false);
    });
  });

  describe('isEffectiveCommunication：判据本体（有效 / 快速标记 → 不同结果）', () => {
    it('有效沟通三型 → true', () => {
      expect(isEffectiveCommunication('advanced')).toBe(true);
      expect(isEffectiveCommunication('stalled')).toBe(true);
      expect(isEffectiveCommunication('await_reply')).toBe(true);
    });

    it('**快速标记三型 → false**（→ D2「快速标记不更新 last_event_at」）', () => {
      expect(isEffectiveCommunication('not_contacted')).toBe(false);
      expect(isEffectiveCommunication('no_answer')).toBe(false);
      expect(isEffectiveCommunication('brief_hangup')).toBe(false);
    });

    it('**空 outcome（中性）→ true**（→ D2「排除三型 quick_mark」，空值不在排除名单里）', () => {
      expect(isEffectiveCommunication(null)).toBe(true);
      expect(isEffectiveCommunication(undefined)).toBe(true);
      expect(isEffectiveCommunication('')).toBe(true);
    });
  });

  describe('isSummaryRequired：有效沟通写字，没接通点一下（→ 需求 §10.2）', () => {
    it('有效沟通 / 空 → 必填一句话结果', () => {
      expect(isSummaryRequired('advanced')).toBe(true);
      expect(isSummaryRequired(null)).toBe(true);
    });

    it('**快速标记 → 不强制写一个字**', () => {
      expect(isSummaryRequired('no_answer')).toBe(false);
      expect(isSummaryRequired('brief_hangup')).toBe(false);
    });
  });
});

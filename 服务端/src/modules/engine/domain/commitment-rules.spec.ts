// =============================================================================
// 承诺纯规则用例（M4-09）—— 假数据、无 IO
//
// 判据（《过程产出/开发计划-V1.md》M4-09）：承诺**建 / 列 / 改（三型 me / them / verdict 基础）**。
// 本文件钉「白名单」与「已结束不许再改」两条 —— 它们是不依赖库就能证的部分。
// =============================================================================
import {
  CLOSABLE_STATUSES,
  COMMITMENT_CTYPES,
  COMMITMENT_PARTIES,
  COMMITMENT_STATUSES,
  checkCommitmentMutable,
  checkWaiveReason,
  isKnownCtype,
  isKnownParty,
  isTerminalStatus,
  requiresWaiveReason,
} from './commitment-rules';

describe('承诺纯规则（M4-09）', () => {
  it('三型 party 与 9 种 ctype 与规格逐字一致（→ 数据架构 D1）', () => {
    expect(COMMITMENT_PARTIES).toEqual(['me', 'them', 'verdict']);
    expect(COMMITMENT_CTYPES).toEqual([
      'reply',
      'quote',
      'meet',
      'deliver',
      'decision',
      'followup',
      'social_meal',
      'social_gift',
      'social_greeting',
    ]);
    expect(COMMITMENT_STATUSES).toEqual(['open', 'done', 'expired', 'waived', 'cancelled']);
  });

  it('白名单只认规格里的码（`social_gift` 成立、`social` 前缀乱写不成立）', () => {
    expect(isKnownParty('verdict')).toBe(true);
    expect(isKnownParty('mine')).toBe(false);
    expect(isKnownCtype('social_gift')).toBe(true);
    expect(isKnownCtype('social')).toBe(false);
    expect(isKnownCtype('call')).toBe(false);
  });

  it('可人工流转的目标态＝收尾三态（兑现 / 取消 / 豁免，→ 需求 §10.1）', () => {
    expect(CLOSABLE_STATUSES).toEqual(['done', 'cancelled', 'waived']);
  });

  it('`waived` 属已结束（豁免后一律不许再改）', () => {
    expect(isTerminalStatus('waived')).toBe(true);
    expect(isTerminalStatus('expired')).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });

  it('open 可改；done / cancelled / waived 一律不可再改（防「兑现记录被改回去」）', () => {
    expect(checkCommitmentMutable('open')).toEqual({ ok: true });
    expect(checkCommitmentMutable('expired')).toEqual({ ok: true });
    expect(checkCommitmentMutable('done')).toEqual({
      ok: false,
      reason: '该承诺已结束（已兑现 / 已取消 / 已豁免），不能再改',
    });
    expect(checkCommitmentMutable('cancelled').ok).toBe(false);
    expect(checkCommitmentMutable('waived').ok).toBe(false);
  });

  it('只有 `waived` 要求填原因（取消＝录错了，不必填 —— 分界见需求 §10.1）', () => {
    expect(requiresWaiveReason('waived')).toBe(true);
    expect(requiresWaiveReason('cancelled')).toBe(false);
    expect(requiresWaiveReason('done')).toBe(false);
  });

  it('豁免原因：不填 / 空白 / 超 255 字 → 不通过；填了就通过', () => {
    expect(checkWaiveReason(undefined).ok).toBe(false);
    expect(checkWaiveReason('').ok).toBe(false);
    expect(checkWaiveReason('   ').ok).toBe(false);
    expect(checkWaiveReason('客户变卦，转投竞品').ok).toBe(true);
    expect(checkWaiveReason('a'.repeat(255)).ok).toBe(true);
    expect(checkWaiveReason('a'.repeat(256))).toEqual({
      ok: false,
      reason: '豁免原因最多 255 字',
    });
  });
});

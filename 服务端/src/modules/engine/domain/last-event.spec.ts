// =============================================================================
// D 域纯规则用例（M4-05）—— 「**仅有效沟通**才回写 `last_event_at`」
//
// 判据逐字（《过程产出/开发计划-V1.md》M4-05）：
//   「`domain/last-event.ts`：仅有效沟通才回写 `last_event_at`」→ 单测：**快速标记不改时间**。
// 口径：《销售CRM数据架构文档》C1（`last_event_at` 定义）＋ D2（★ 快速标记口径）。
// =============================================================================
import { decideLastEventUpdate } from './last-event';

const AT = new Date('2026-09-15T10:00:00.000Z');

describe('last-event（M4-05）', () => {
  it('有效沟通（advanced）→ 回写，且写入的就是事件发生时间', () => {
    expect(decideLastEventUpdate({ outcome: 'advanced', eventAt: AT })).toEqual({
      shouldUpdate: true,
      eventAt: AT,
    });
  });

  it('空 outcome（中性）→ 回写（→ D2 只排除三型 quick_mark）', () => {
    expect(decideLastEventUpdate({ outcome: null, eventAt: AT })).toEqual({
      shouldUpdate: true,
      eventAt: AT,
    });
  });

  it.each(['not_contacted', 'no_answer', 'brief_hangup'])(
    '**快速标记 %s → 不回写**（判据本体：点一下不重置掉海倒计时）',
    (outcome) => {
      expect(decideLastEventUpdate({ outcome, eventAt: AT })).toEqual({
        shouldUpdate: false,
        eventAt: null,
      });
    },
  );

  it('事件发生时间缺失 → 不回写（宁可不写，也不写一个说不清来源的时间）', () => {
    expect(decideLastEventUpdate({ outcome: 'advanced', eventAt: null })).toEqual({
      shouldUpdate: false,
      eventAt: null,
    });
  });
});

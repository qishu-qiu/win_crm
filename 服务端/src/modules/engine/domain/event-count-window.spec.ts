// =============================================================================
// 「近 30 个自然日」计数窗用例（→ 接口 §5.4 `event_count_30d`）
//
// 钉住三件容易写歪的事（口径见 `event-count-window.ts` 文件头）：
//   ① **30 个自然日含今天** ⇒ 起点 ＝ 今天 00:00 − 29 天（写 `days` 就变成 31 天）；
//   ② **日界按 UTC**（→ D-54「UTC 存 / 分区边界按 UTC」）；
//   ③ **不看时分秒**：同一天的任意时刻算出的窗**必须一样**（否则同一天刷新两次数字会跳）。
// =============================================================================
import { EVENT_COUNT_WINDOW_DAYS, resolveEventCountSince } from './event-count-window';

const DAY = 24 * 60 * 60 * 1000;

describe('EVENT_COUNT_WINDOW_DAYS', () => {
  it('窗口天数＝30（「近 30 天」的那个 30，→ §5.4）', () => {
    expect(EVENT_COUNT_WINDOW_DAYS).toBe(30);
  });
});

describe('resolveEventCountSince：近 30 个自然日（含今天）的起点', () => {
  it('★ 含今天共 30 个自然日 ⇒ 起点 ＝ 今天(UTC) 00:00 − 29 天', () => {
    expect(resolveEventCountSince(new Date('2026-09-21T10:30:00Z')).toISOString()).toBe(
      '2026-08-23T00:00:00.000Z',
    );
  });

  it('★ 同一天的任意时刻 → 同一个起点（不看时分秒；否则一天内刷新两次数字会跳）', () => {
    const start = resolveEventCountSince(new Date('2026-09-21T00:00:00Z')).toISOString();
    expect(resolveEventCountSince(new Date('2026-09-21T00:00:00Z')).toISOString()).toBe(start);
    expect(resolveEventCountSince(new Date('2026-09-21T13:59:59Z')).toISOString()).toBe(start);
    expect(resolveEventCountSince(new Date('2026-09-21T23:59:59Z')).toISOString()).toBe(start);
  });

  it('★ 日界按 **UTC**（不是 +08:00）：UTC 当天 00:00 即起点 —— 时间落点按 UTC 归日', () => {
    // 北京时间 09-21 00:30 ＝ UTC 09-20 16:30 ⇒ 按 UTC 算「今天」仍是 09-20
    expect(resolveEventCountSince(new Date('2026-09-20T16:30:00Z')).toISOString()).toBe(
      '2026-08-22T00:00:00.000Z',
    );
  });

  it('跨月 / 跨年也算得对（不靠月天数硬编码）', () => {
    expect(resolveEventCountSince(new Date('2026-01-05T23:59:59Z')).toISOString()).toBe(
      '2025-12-07T00:00:00.000Z',
    );
  });

  it('天数可传参：`days = 1` ⇒ 只含今天（起点＝今天 00:00）', () => {
    expect(resolveEventCountSince(new Date('2026-09-21T10:30:00Z'), 1).toISOString()).toBe(
      '2026-09-21T00:00:00.000Z',
    );
  });

  it('起点恒早于 `now`（同一天任意时刻都在窗内 —— 窗是**闭区间左端**，不会把自己排除掉）', () => {
    const now = new Date('2026-09-21T00:00:00Z');
    expect(resolveEventCountSince(now).getTime()).toBe(now.getTime() - 29 * DAY);
  });
});

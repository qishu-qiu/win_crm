// =============================================================================
// 掉海预警纯函数用例（M7-04）—— **假数据，不连库**（铁律：`domain/` 层不许碰框架 / ORM）
//
// ★ 《开发计划-V1》M7-04 判据逐字：「单测：**三档边界各 ≥2 例**」—— 故每个档位既有
//   「刚好压线算命中」也有「差一毫秒就掉出去」，防的是"把 `<=` 写成 `<`"这类静默漏判。
// =============================================================================
import {
  SEA_WARNING_THRESHOLDS,
  classifySeaWarning,
  resolveDropDeadline,
  resolveSeaRuleFor,
  type SeaRuleLike,
} from './sea-warning';

/** 固定"现在"，让所有边界都可复算（`now` 由调用方传入，本层不读系统时钟） */
const NOW = new Date('2026-09-20T12:00:00.000Z');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** now 之后 `ms` 毫秒的时刻 */
function after(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

describe('classifySeaWarning：三档阈值判定（→ 需求 §6.3 预警节奏表）', () => {
  it('**已到期 / 已超期** → `overdue`（各 1 例：刚好到期、早了一毫秒）', () => {
    expect(classifySeaWarning({ dropAt: NOW, now: NOW })).toBe('overdue');
    expect(classifySeaWarning({ dropAt: new Date(NOW.getTime() - 1), now: NOW })).toBe('overdue');
    // 已经过了一大截同样只报"到期"，不另造档位
    expect(classifySeaWarning({ dropAt: after(-5 * DAY), now: NOW })).toBe('overdue');
  });

  it('**到期前 6 小时**（标红 + 推部门经理）→ `alert_manager`', () => {
    expect(classifySeaWarning({ dropAt: after(6 * HOUR), now: NOW })).toBe('alert_manager');
    expect(classifySeaWarning({ dropAt: after(6 * HOUR - 1), now: NOW })).toBe('alert_manager');
    expect(classifySeaWarning({ dropAt: after(1), now: NOW })).toBe('alert_manager');
  });

  it('**6 小时之后、24 小时以内**（推销售）→ `notify_owner`', () => {
    expect(classifySeaWarning({ dropAt: after(6 * HOUR + 1), now: NOW })).toBe('notify_owner');
    expect(classifySeaWarning({ dropAt: after(20 * HOUR), now: NOW })).toBe('notify_owner');
    expect(classifySeaWarning({ dropAt: after(24 * HOUR), now: NOW })).toBe('notify_owner');
  });

  it('**24 小时之后、3 天以内**（进今日动线）→ `agenda`', () => {
    expect(classifySeaWarning({ dropAt: after(24 * HOUR + 1), now: NOW })).toBe('agenda');
    expect(classifySeaWarning({ dropAt: after(2 * DAY), now: NOW })).toBe('agenda');
    expect(classifySeaWarning({ dropAt: after(3 * DAY), now: NOW })).toBe('agenda');
  });

  it('**3 天之外** → `none`（还没进任何一档，不报）', () => {
    expect(classifySeaWarning({ dropAt: after(3 * DAY + 1), now: NOW })).toBe('none');
    expect(classifySeaWarning({ dropAt: after(30 * DAY), now: NOW })).toBe('none');
  });

  it('阈值取自**唯一落点** `SEA_WARNING_THRESHOLDS`（与需求 §6.3 三个数逐条对应）', () => {
    expect(SEA_WARNING_THRESHOLDS).toEqual({ agendaDays: 3, notifyOwnerHours: 24, alertManagerHours: 6 });
  });
});

describe('resolveSeaRuleFor：L4→L1 命中解析（→ 数据架构 F1）', () => {
  const PAST = new Date('2026-09-01T00:00:00.000Z');
  const FUTURE = after(7 * DAY); // 7 天缓冲：新版本行还没生效

  function rule(overrides: Partial<SeaRuleLike>): SeaRuleLike {
    return {
      level: 1,
      deptId: null,
      productLineId: null,
      followFreqDays: 30,
      effectiveFrom: PAST,
      ...overrides,
    };
  }

  it('**L4 优先**：同时有哪几层就给最高层那条', () => {
    const global = rule({ level: 1, followFreqDays: 60 });
    const byDept = rule({ level: 3, deptId: 2n, followFreqDays: 20 });
    const byDeptLine = rule({ level: 4, deptId: 2n, productLineId: 1n, followFreqDays: 10 });

    const hit = resolveSeaRuleFor([global, byDeptLine, byDept], { deptId: 2n, productLineId: 1n }, NOW);
    expect(hit?.followFreqDays).toBe(10);
  });

  it('**逐级回退**：没有 L4 取 L3；没有 L3 取 L2；都没有取 L1；都没有给 `null`', () => {
    const global = rule({ level: 1, followFreqDays: 60 });
    const byLine = rule({ level: 2, productLineId: 1n, followFreqDays: 40 });
    const byDept = rule({ level: 3, deptId: 2n, followFreqDays: 20 });

    expect(resolveSeaRuleFor([global, byLine, byDept], { deptId: 2n, productLineId: 1n }, NOW)?.followFreqDays).toBe(20);
    expect(resolveSeaRuleFor([global, byLine], { deptId: 2n, productLineId: 1n }, NOW)?.followFreqDays).toBe(40);
    expect(resolveSeaRuleFor([global], { deptId: 9n, productLineId: 9n }, NOW)?.followFreqDays).toBe(60);
    expect(resolveSeaRuleFor([], { deptId: 2n, productLineId: 1n }, NOW)).toBeNull();
  });

  it('**只有 key 对得上才算命中**：别部门 / 别产品线的规则不许被套用', () => {
    const otherDept = rule({ level: 3, deptId: 9n, followFreqDays: 5 });
    expect(resolveSeaRuleFor([otherDept], { deptId: 2n, productLineId: 1n }, NOW)).toBeNull();
  });

  it('**7 天缓冲**：`effective_from` 还在未来的规则**不生效**（照旧用老规则）', () => {
    const pending = rule({ level: 1, followFreqDays: 15, effectiveFrom: FUTURE });
    const current = rule({ level: 1, followFreqDays: 30, effectiveFrom: PAST });

    expect(resolveSeaRuleFor([pending, current], { deptId: 2n, productLineId: 1n }, NOW)?.followFreqDays).toBe(30);
    // 生效瞬间（`effective_from === now`）就该用新规则
    expect(
      resolveSeaRuleFor([rule({ followFreqDays: 15, effectiveFrom: NOW })], { deptId: 2n, productLineId: 1n }, NOW)
        ?.followFreqDays,
    ).toBe(15);
  });

  it('**未知层级不蒙**：`level` 不在 1~4 之内的行一律不命中', () => {
    const weird = rule({ level: 9, followFreqDays: 1 });
    expect(resolveSeaRuleFor([weird], { deptId: 2n, productLineId: 1n }, NOW)).toBeNull();
  });

  it('L1 全局行**必须两个 key 都空**才算全局（挂着一个 key 的"伪全局"不命中）', () => {
    const fake = rule({ level: 1, deptId: 2n, followFreqDays: 1 });
    expect(resolveSeaRuleFor([fake], { deptId: 2n, productLineId: 1n }, NOW)).toBeNull();
  });
});

describe('resolveDropDeadline：到期时刻（触发①「最近 N 天无有效跟进」）', () => {
  const CREATED = new Date('2026-09-01T00:00:00.000Z');

  it('跟进过 ⇒ 从 `last_event_at` 起算 N 天', () => {
    const dropAt = resolveDropDeadline({
      lastEventAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: CREATED,
      followFreqDays: 10,
    });
    expect(dropAt?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('**从没跟进过**（`last_event_at` 为 `null`）⇒ 从建档时刻起算（否则新客户永不预警）', () => {
    const dropAt = resolveDropDeadline({ lastEventAt: null, createdAt: CREATED, followFreqDays: 10 });
    expect(dropAt?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('规则**没配这一项**（`null`）/ 配了非正数 ⇒ `null`（判不了，**不许拿默认天数顶替**）', () => {
    expect(resolveDropDeadline({ lastEventAt: null, createdAt: CREATED, followFreqDays: null })).toBeNull();
    expect(resolveDropDeadline({ lastEventAt: null, createdAt: CREATED, followFreqDays: 0 })).toBeNull();
    expect(resolveDropDeadline({ lastEventAt: null, createdAt: CREATED, followFreqDays: -3 })).toBeNull();
  });
});

// =============================================================================
// 掉海预警纯函数用例（M7-04）—— **假数据，不连库**（铁律：`domain/` 层不许碰框架 / ORM）
//
// ★ 《开发计划-V1》M7-04 判据逐字：「单测：**三档边界各 ≥2 例**」—— 故每个档位既有
//   「刚好压线算命中」也有「差一毫秒就掉出去」，防的是"把 `<=` 写成 `<`"这类静默漏判。
// =============================================================================
import {
  SEA_WARNING_THRESHOLDS,
  classifySeaWarning,
  countDaysUntilDrop,
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

/**
 * 上海某日某时的**对应 UTC 时刻**（−8h，无夏令时）—— 把"哪一天"写成能读的样子。
 * `shanghaiDay(0)` ＝ 上海 `2026-09-20 00:00`；档位判定按**自然日**（→ 需求 §6.3 / 废止口径 #41）。
 */
function shanghaiDay(dayOffset: number, hour = 0, minute = 0): Date {
  const base = Date.UTC(2026, 8, 20, 0, 0, 0) - 8 * HOUR;
  return new Date(base + dayOffset * DAY + hour * HOUR + minute * 60 * 1000);
}

describe('classifySeaWarning：三档阈值判定（→ 需求 §6.3 预警节奏表 · **按自然日**）', () => {
  it('**到期日已过** → `overdue`（各 2 例：昨天 23:59、足足一个月前）', () => {
    expect(
      classifySeaWarning({ dropAt: shanghaiDay(-1, 23, 59), now: shanghaiDay(0, 0, 0) }),
    ).toBe('overdue');
    expect(classifySeaWarning({ dropAt: shanghaiDay(-30), now: shanghaiDay(0, 12) })).toBe('overdue');
  });

  it('**到期当天**（标红 + 推部门经理）→ `alert_manager`（当天两端各 1 例）', () => {
    // 今天 00:01 看"今天 23:59 到期" —— 还是当天
    expect(
      classifySeaWarning({ dropAt: shanghaiDay(0, 23, 59), now: shanghaiDay(0, 0, 1) }),
    ).toBe('alert_manager');
    // 今天 23:59 看"今天 00:00 到期" —— 仍是当天（**没跨零点就不算过**）
    expect(classifySeaWarning({ dropAt: shanghaiDay(0, 0, 0), now: shanghaiDay(0, 23, 59) })).toBe(
      'alert_manager',
    );
  });

  it('**到期前 1 天**（推销售）→ `notify_owner`（当天的两个极端时刻各 1 例）', () => {
    expect(classifySeaWarning({ dropAt: shanghaiDay(1, 0, 1), now: shanghaiDay(0, 0, 1) })).toBe(
      'notify_owner',
    );
    expect(
      classifySeaWarning({ dropAt: shanghaiDay(1, 23, 59), now: shanghaiDay(0, 23, 59) }),
    ).toBe('notify_owner');
  });

  it('**2~3 天**（进今日动线）→ `agenda`（含"正好 3 天"这条闭区间边界）', () => {
    expect(classifySeaWarning({ dropAt: shanghaiDay(2), now: shanghaiDay(0, 12) })).toBe('agenda');
    expect(classifySeaWarning({ dropAt: shanghaiDay(3, 0, 0), now: shanghaiDay(0, 12) })).toBe(
      'agenda',
    );
  });

  it('**4 天及以后** → `none`（还没进任何一档，不报）', () => {
    expect(classifySeaWarning({ dropAt: shanghaiDay(4), now: shanghaiDay(0, 12) })).toBe('none');
    expect(classifySeaWarning({ dropAt: shanghaiDay(30), now: shanghaiDay(0, 12) })).toBe('none');
  });

  it('★ **判据是"哪一天"，不是"还剩几小时"**：同一天内的早晚两个时刻，档位完全相同', () => {
    const dropAtSameDay = shanghaiDay(0, 9, 0); // 今天 09:00 到期
    // 早上 8 点看（还剩 1 小时）与晚上 22 点看（早过了 9 点）—— **同一天 ⇒ 同一档**
    expect(classifySeaWarning({ dropAt: dropAtSameDay, now: shanghaiDay(0, 8, 0) })).toBe(
      'alert_manager',
    );
    expect(classifySeaWarning({ dropAt: dropAtSameDay, now: shanghaiDay(0, 22, 0) })).toBe(
      'alert_manager',
    );
  });

  it('★ **跨零点即新的一天**（同一分钟内的一秒之差，档位就变）', () => {
    // 上海 09-20 23:59 → 到期日 09-21 ⇒ 还有 1 天
    expect(
      classifySeaWarning({ dropAt: shanghaiDay(1, 0, 0), now: shanghaiDay(0, 23, 59) }),
    ).toBe('notify_owner');
    // 一分钟后（09-21 00:00）再看 ⇒ 到期日 09-20 已成"昨天" ⇒ 该掉了
    expect(
      classifySeaWarning({ dropAt: shanghaiDay(0, 23, 59), now: shanghaiDay(1, 0, 0) }),
    ).toBe('overdue');
  });

  it('阈值取自**唯一落点** `SEA_WARNING_THRESHOLDS`（**单位一律"天"**，与需求 §6.3 逐条对应）', () => {
    expect(SEA_WARNING_THRESHOLDS).toEqual({ agendaDays: 3, notifyOwnerDays: 1, alertManagerDays: 0 });
  });
});

describe('countDaysUntilDrop：距掉海天数（→ 接口 §4.4 / §5.6 `drop_in_x_days` 的同一个数）', () => {
  it('**到期当天** → `0`（当天的两个极端时刻都算 0：同一天内看多少次都是当天）', () => {
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(0, 0, 0), now: shanghaiDay(0, 23, 59) })).toBe(0);
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(0, 23, 59), now: shanghaiDay(0, 0, 1) })).toBe(0);
  });

  it('**到期日已过** → 负数（昨天到期 ⇒ `-1`；**不是 0** —— `0` 是"还没过"）', () => {
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(-1, 23, 59), now: shanghaiDay(0, 0, 0) })).toBe(-1);
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(-30), now: shanghaiDay(0, 12) })).toBe(-30);
  });

  it('**还有几天** → 正数照实给（`1` / `3` / `30`：列表要显示「N 天后」，**不是只给 ≤3 天**）', () => {
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(1, 0, 1), now: shanghaiDay(0, 0, 1) })).toBe(1);
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(3, 0, 0), now: shanghaiDay(0, 12) })).toBe(3);
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(30), now: shanghaiDay(0, 12) })).toBe(30);
  });

  it('★ **跨零点即新的一天**：同一分钟内的一秒之差，天数就变 1（判据是"哪一天"，不是时长）', () => {
    // 09-20 23:59 看「09-21 00:00 到期」⇒ 1 天后
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(1, 0, 0), now: shanghaiDay(0, 23, 59) })).toBe(1);
    // 一分钟后（09-21 00:00）再看同一个到期时刻 ⇒ **就是今天**（0）
    expect(countDaysUntilDrop({ dropAt: shanghaiDay(1, 0, 0), now: shanghaiDay(1, 0, 0) })).toBe(0);
  });

  it('★ **与分档同源**：分档的边界就是本函数这个数（改一处即两处生效，不会各自漂移）', () => {
    // 正好 3 天：闭区间算命中（`agenda`）——「数」与「档」取的是同一个 3
    const at3 = { dropAt: shanghaiDay(3, 0, 0), now: shanghaiDay(0, 12) };
    expect(countDaysUntilDrop(at3)).toBe(3);
    expect(classifySeaWarning(at3)).toBe('agenda');
    // 4 天：还没进任何一档（`none`）
    const at4 = { dropAt: shanghaiDay(4), now: shanghaiDay(0, 12) };
    expect(countDaysUntilDrop(at4)).toBe(4);
    expect(classifySeaWarning(at4)).toBe('none');
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
  /** 老规则（生效日远在过去）：锚点取不到它 ⇒ 与"没有 7 天缓冲"时的行为**逐字一致** */
  const OLD_RULE = new Date('2026-08-01T00:00:00.000Z');

  it('跟进过 ⇒ 从 `last_event_at` 起算 N 天', () => {
    const dropAt = resolveDropDeadline({
      lastEventAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: CREATED,
      followFreqDays: 10,
      ruleEffectiveFrom: OLD_RULE,
    });
    expect(dropAt?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('**从没跟进过**（`last_event_at` 为 `null`）⇒ 从建档时刻起算（否则新客户永不预警）', () => {
    const dropAt = resolveDropDeadline({
      lastEventAt: null,
      createdAt: CREATED,
      followFreqDays: 10,
      ruleEffectiveFrom: OLD_RULE,
    });
    expect(dropAt?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('规则**没配这一项**（`null`）/ 配了非正数 ⇒ `null`（判不了，**不许拿默认天数顶替**）', () => {
    const base = { lastEventAt: null, createdAt: CREATED, ruleEffectiveFrom: OLD_RULE };
    expect(resolveDropDeadline({ ...base, followFreqDays: null })).toBeNull();
    expect(resolveDropDeadline({ ...base, followFreqDays: 0 })).toBeNull();
    expect(resolveDropDeadline({ ...base, followFreqDays: -3 })).toBeNull();
  });

  // ===== M9-F 规则配置片：规则生效 ⇒ 在途倒计时**从生效日重新起算** =====
  // （需求 §6.3「变更后 7 天才生效；生效时所有在途关系的倒计时从生效日重新起算
  //   ＝ 每个客户至少再给一整轮」；实现口径见 `sea-rule.ts` 文件头 ★ 段）

  it('★ **规则刚生效** ⇒ 锚点抬到生效日（哪怕最近一次跟进比它晚很久之前也照样重算）', () => {
    const effectiveFrom = new Date('2026-09-18T00:00:00.000Z'); // 3 天前生效
    const dropAt = resolveDropDeadline({
      // 上次有效跟进是 8 月 1 日：按老口径早该掉了（＋30 天 ＝ 8/31），
      // 但规则 9/18 生效 ⇒ 从 9/18 重新起算 30 天
      lastEventAt: new Date('2026-08-01T00:00:00.000Z'),
      createdAt: CREATED,
      followFreqDays: 30,
      ruleEffectiveFrom: effectiveFrom,
    });

    expect(dropAt?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('★ 生效日**早于**锚点 ⇒ 取锚点（"较晚者"，不会把跟进过的人提前掉海）', () => {
    const dropAt = resolveDropDeadline({
      lastEventAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: CREATED,
      followFreqDays: 10,
      // 生效日（9/15）晚于锚点（9/10）时才算重算；这里生效日更早 ⇒ 仍按 9/10 起算
      ruleEffectiveFrom: new Date('2026-09-05T00:00:00.000Z'),
    });

    expect(dropAt?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('★ 与生效日**同一毫秒**时按锚点算（边界取"较晚"，两值相等不改变结果）', () => {
    const same = new Date('2026-09-10T00:00:00.000Z');
    const dropAt = resolveDropDeadline({
      lastEventAt: same,
      createdAt: CREATED,
      followFreqDays: 5,
      ruleEffectiveFrom: same,
    });

    expect(dropAt?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });
});

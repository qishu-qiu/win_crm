// =============================================================================
// 公海规则配置纯函数用例（M9-F 规则配置片）—— **假数据，不连库**
//
// 钉的是四件事（对应接口 §4.14.10 的四句口径）：
//   ① 层级与两个 key 的搭配（F1 层级语义）；
//   ② 7 天缓冲（`effective_from` ＝ 提交日 + 7 天）；
//   ③ 谁能看 / 谁能改哪一层（需求 §6.3 层级 ＋ 前端 §四.2；口径合成 → 欠账 D-69）；
//   ④ **变更预告**（「本次将影响 X 个客户」）—— 与扫描**共用**规则解析，
//      故关键用例是"别把不受这条规则管的人算进来"。
// =============================================================================
import {
  SEA_RULE_BUFFER_DAYS,
  SEA_RULE_LEVEL,
  SEA_RULE_STATUS,
  canManageSeaRule,
  canReadSeaRules,
  countAffectedCustomers,
  isSameRuleSlot,
  isScopeConsistent,
  resolveEffectiveFrom,
  resolveSeaRuleReadDeptIds,
  type SeaRuleViewer,
} from './sea-rule';
import type { SeaRuleLike } from './sea-warning';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-21T12:00:00.000Z');
const PAST = new Date('2026-09-01T00:00:00.000Z');

function after(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function viewer(roleCodes: string[], managedDeptIds: bigint[] = []): SeaRuleViewer {
  return { roleCodes, managedDeptIds };
}

function rule(overrides: Partial<SeaRuleLike>): SeaRuleLike {
  return {
    level: SEA_RULE_LEVEL.global,
    deptId: null,
    productLineId: null,
    followFreqDays: 30,
    effectiveFrom: PAST,
    ...overrides,
  };
}

describe('isScopeConsistent：层级与 dept_id / product_line_id 的搭配（→ 数据架构 F1）', () => {
  it('四种合法搭配各一例（L1 两空 / L2 只产品线 / L3 只部门 / L4 都有）', () => {
    expect(isScopeConsistent({ level: 1, deptId: null, productLineId: null })).toBe(true);
    expect(isScopeConsistent({ level: 2, deptId: null, productLineId: 1n })).toBe(true);
    expect(isScopeConsistent({ level: 3, deptId: 2n, productLineId: null })).toBe(true);
    expect(isScopeConsistent({ level: 4, deptId: 2n, productLineId: 1n })).toBe(true);
  });

  it('**搭配错一律拒**（搭配错了库不会拦 —— `idx_level` 是非唯一索引，只会静默失配）', () => {
    // L1 挂着 key ＝ "伪全局"（命中解析里 `matchesLevel` 会判不中）
    expect(isScopeConsistent({ level: 1, deptId: 2n, productLineId: null })).toBe(false);
    expect(isScopeConsistent({ level: 1, deptId: null, productLineId: 1n })).toBe(false);
    // L2 少了产品线 / 多了部门
    expect(isScopeConsistent({ level: 2, deptId: null, productLineId: null })).toBe(false);
    expect(isScopeConsistent({ level: 2, deptId: 2n, productLineId: 1n })).toBe(false);
    // L3 少了部门 / 多了产品线
    expect(isScopeConsistent({ level: 3, deptId: null, productLineId: null })).toBe(false);
    expect(isScopeConsistent({ level: 3, deptId: 2n, productLineId: 1n })).toBe(false);
    // L4 缺任一个 key
    expect(isScopeConsistent({ level: 4, deptId: 2n, productLineId: null })).toBe(false);
    expect(isScopeConsistent({ level: 4, deptId: null, productLineId: 1n })).toBe(false);
  });

  it('**未知层级不蒙**（`level` 只许 1~4）', () => {
    expect(isScopeConsistent({ level: 0, deptId: null, productLineId: null })).toBe(false);
    expect(isScopeConsistent({ level: 5, deptId: 2n, productLineId: 1n })).toBe(false);
  });
});

describe('7 天缓冲（→ 需求 §6.3 / F1：新版本 `effective_from` ＝ 提交日 + 7 天）', () => {
  it('生效时刻 ＝ 提交时刻 + 7×24 小时（**逐毫秒**，不是"加 7 个自然日到零点"）', () => {
    const effectiveFrom = resolveEffectiveFrom(NOW);
    expect(SEA_RULE_BUFFER_DAYS).toBe(7);
    expect(effectiveFrom.getTime() - NOW.getTime()).toBe(7 * DAY);
    expect(effectiveFrom.toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });
});

describe('isSameRuleSlot：「插新版本行 ＋ 旧行 disabled」的落点判据', () => {
  it('层级 ＋ 两个 key 全同 ⇒ 同一位置；差一样就不是', () => {
    const base = { level: 3, deptId: 2n, productLineId: null };
    expect(isSameRuleSlot(base, { level: 3, deptId: 2n, productLineId: null })).toBe(true);
    expect(isSameRuleSlot(base, rule({ level: 4, deptId: 2n, productLineId: 1n }))).toBe(false);
    expect(isSameRuleSlot(base, rule({ level: 3, deptId: 9n, productLineId: null }))).toBe(false);
    // L1 ↔ L2 差在"有没有产品线"，同样是两个位置
    expect(isSameRuleSlot(rule({ level: 1 }), rule({ level: 2, productLineId: 1n }))).toBe(false);
  });

  it('两份状态常量与 F1 逐字对应（写库用的码不许各处手写字符串）', () => {
    expect(SEA_RULE_STATUS).toEqual({ active: 'active', disabled: 'disabled' });
  });
});

describe('规则配置的可见 / 可改（需求 §6.3 层级 ＋ 前端 §四.2；合成口径 → D-69）', () => {
  it('能被读：老板 / 管理员 / 有管辖部门的经理；**销售 · 交付 · 无管辖部门的经理 一律不能**', () => {
    expect(canReadSeaRules(viewer(['gm']))).toBe(true);
    expect(canReadSeaRules(viewer(['admin']))).toBe(true);
    expect(canReadSeaRules(viewer(['dept_manager'], [2n, 3n]))).toBe(true);
    // 挂着"经理"角色但没有管辖部门 ⇒ 没有可配的范围，不给入口
    expect(canReadSeaRules(viewer(['dept_manager']))).toBe(false);
    expect(canReadSeaRules(viewer(['sale']))).toBe(false);
    expect(canReadSeaRules(viewer(['delivery', 'service']))).toBe(false);
  });

  it('读范围：老板 / 管理员 **不收敛**（`null`，不是空数组）；经理＝自己管辖的部门集合', () => {
    expect(resolveSeaRuleReadDeptIds(viewer(['gm']))).toBeNull();
    expect(resolveSeaRuleReadDeptIds(viewer(['admin']))).toBeNull();
    expect(resolveSeaRuleReadDeptIds(viewer(['dept_manager'], [2n, 3n]))).toEqual([2n, 3n]);
    // ⚠ `null`（全看）与 `[]`（一个部门都不可见）不是一回事 —— 别把无权者读成"全看"
    expect(resolveSeaRuleReadDeptIds(viewer(['sale']))).toEqual([]);
  });

  it('能改哪一层：L1 / L2 只归老板 / 管理员（经理改不了全局与产品级）', () => {
    const manager = viewer(['dept_manager'], [2n]);
    expect(canManageSeaRule(manager, { level: 1, deptId: null, productLineId: null })).toBe(false);
    expect(canManageSeaRule(manager, { level: 2, deptId: null, productLineId: 1n })).toBe(false);
    expect(canManageSeaRule(viewer(['gm']), { level: 1, deptId: null, productLineId: null })).toBe(true);
    expect(canManageSeaRule(viewer(['admin']), { level: 2, deptId: null, productLineId: 1n })).toBe(true);
  });

  it('能改哪一层：L3 / L4 ＝ **该部门的**部门经理（别部门一律 403）', () => {
    const manager = viewer(['dept_manager'], [2n, 3n]);
    expect(canManageSeaRule(manager, { level: 3, deptId: 2n, productLineId: null })).toBe(true);
    expect(canManageSeaRule(manager, { level: 4, deptId: 3n, productLineId: 1n })).toBe(true);
    expect(canManageSeaRule(manager, { level: 3, deptId: 9n, productLineId: null })).toBe(false);
  });

  it('销售 / 交付 · 客服改不了任何一层（只读角色＋不可配）', () => {
    for (const roles of [['sale'], ['delivery'], ['service']]) {
      expect(canManageSeaRule(viewer(roles), { level: 3, deptId: 2n, productLineId: null })).toBe(false);
      expect(canManageSeaRule(viewer(roles), { level: 1, deptId: null, productLineId: null })).toBe(false);
    }
  });

  it('一人多角色**取并**：`sale + dept_manager` 仍能配本部门（窄角色不许把宽角色拉低）', () => {
    expect(
      canManageSeaRule(viewer(['sale', 'dept_manager'], [2n]), {
        level: 3,
        deptId: 2n,
        productLineId: null,
      }),
    ).toBe(true);
  });
});

describe('countAffectedCustomers：变更预告「本次将影响 X 个客户」（→ 需求 §6.3）', () => {
  const AT = after(7 * DAY); // 新版本生效时刻
  const nextRule = rule({ level: 3, deptId: 2n, productLineId: null, effectiveFrom: AT });

  it('只算**这条规则管得到**的部门×产品线；别部门的在途客户不进这个数', () => {
    const affected = countAffectedCustomers({
      existingRules: [rule({ level: 1 })],
      nextRule,
      groups: [
        { deptId: 2n, productLineId: 1n, count: 5 },
        { deptId: 2n, productLineId: 2n, count: 2 },
        { deptId: 9n, productLineId: 1n, count: 100 },
      ],
      at: AT,
    });

    expect(affected).toBe(7);
  });

  it('**被更高层规则压着的**那一组不算：L4 已经管着 (2,1) ⇒ 新配的 L3 影响不到它', () => {
    const affected = countAffectedCustomers({
      existingRules: [rule({ level: 1 }), rule({ level: 4, deptId: 2n, productLineId: 1n })],
      nextRule,
      groups: [
        { deptId: 2n, productLineId: 1n, count: 5 }, // → L4（不是这条 L3）
        { deptId: 2n, productLineId: 2n, count: 2 }, // → L3（是这条）
      ],
      at: AT,
    });

    expect(affected).toBe(2);
  });

  it('**同位置的旧版本行**不计入自己（它会被置 `disabled`），改完仍算"这条规则"的影响面', () => {
    const oldVersion = rule({ level: 3, deptId: 2n, productLineId: null, followFreqDays: 60 });
    const affected = countAffectedCustomers({
      existingRules: [oldVersion],
      nextRule,
      groups: [{ deptId: 2n, productLineId: 1n, count: 4 }],
      at: AT,
    });

    expect(affected).toBe(4);
  });

  it('**7 天缓冲**：`at` 之后才生效的别家版本行不参与解析（生效那一刻它还压不住）', () => {
    const laterRule = rule({
      level: 4,
      deptId: 2n,
      productLineId: 1n,
      effectiveFrom: new Date(AT.getTime() + DAY), // 比新版本还晚一天
    });
    const affected = countAffectedCustomers({
      existingRules: [laterRule],
      nextRule,
      groups: [{ deptId: 2n, productLineId: 1n, count: 3 }],
      at: AT,
    });

    expect(affected).toBe(3);
  });

  it('一个在途客户都没有 ⇒ 0（不给"看起来像有影响"的假数）', () => {
    expect(
      countAffectedCustomers({ existingRules: [], nextRule, groups: [], at: AT }),
    ).toBe(0);
  });
});

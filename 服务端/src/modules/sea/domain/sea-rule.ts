// =============================================================================
// F 域纯函数：公海规则**配置**（M9-F 规则配置片）—— 层级语义 / 7 天缓冲 / 权限 / 变更预告
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》**§4.14.10 公海规则配置**：「`GET/PUT /sea/rules`：公海规则 L1-L4
//     配置（`sea_rule` 表）。**改掉海天数走 7 天缓冲**——新值 **7 天后生效**、在途倒计时
//     **从生效日重新起算**、提交时**预告受影响客户数**；落库＝插新版本行 ＋ 旧行 `status=disabled`
//     （**停用不删**）」—— 本文件把这四件事各写成一处纯函数，**不给第二处口径**。
//   · 《销售CRM业务需求文档》§6.3：「规则配置层级（下级覆盖上级）：全局默认（**老板**）→
//     产品级（**老板**）→ 部门级（**部门经理**）→ 部门×产品级（**部门经理**，优先级最高）」；
//     「★ 规则变更的 7 天缓冲：变更后 7 天才生效；生效时所有在途关系的倒计时从生效日重新起算
//     （等于每个客户至少再给一整轮）；提交变更时系统先提示『本次将影响 X 个客户』，经理可取消或
//     改小幅度」；「目的：避免『今天改参数、明天几十个客户集体掉海』」。
//   · 《销售CRM数据架构文档》F1：`level`(1=全局 2=产品线 3=部门 4=部门×产品线) ＋
//     `dept_id/product_line_id`(按层可空) ＋ 四个天数 ＋ `effective_from`（＝变更提交日 + 7 天）
//     ＋ `status`；「命中解析 L4→L1 取第一条」；同节「7 天缓冲落库口径」＝插新版本行 ＋
//     旧行 `disabled`；
//     同 F1 ★ 2026-09-20 修正（P-10）：`stay_days` **只用于「公海停留超期」**，不参与私海掉落倒计时。
//
// ★ **「倒计时重新起算」的实现口径（为什么是 max(锚点, effectiveFrom)）**：
//   扫描侧（`sea-warning.ts` 的 `resolveDropDeadline`）把锚点取成
//   **`max(最近一次有效沟通 ?? 建档时刻, 规则 effective_from)`** —— 规则刚生效时，
//   所有**受该规则约束**的在途关系锚点被抬到生效日 ⇒ 到期时刻＝生效日 + N 天
//   （**每个客户至少再给一整轮**，正是 7 天缓冲要买的效果）。
//   ⚠ 规格原句写「**所有**在途关系的倒计时从 `effective_from` 重新起算」；实现取的是
//     「**受该规则约束的**在途关系」—— 依据有二：① 「改小幅度」这句话只有在"影响面随规则范围变"
//     时才成立；② 字面全局重算**在 F1 的数据模型里无处落**（全局"最近一次变更时刻"没有任何一列
//     承载，`sea_rule.effective_from` 是**逐行**的）。若将来要改成字面全局，先补承载列。
//   ⇒ 预告口径（`countAffectedCustomers`）与它**同一个集合**：改前说影响几个、改后就重算几个，
//     两处共用 `resolveSeaRuleFor`，不会出现"预告 3 个、实际掉 5 个"。
//
// ⚠ **权限口径属"合成"（非规格原文，→《欠账登记表》D-69）**：需求 §6.3 只写了
//   「全局/产品级＝老板、部门级/部门×产品级＝部门经理」两档，**没说管理员**；
//   而《前端》§四.2 把「系统设置」整块给了管理员 ✅（含公海规则子页）、
//   `kernel/data-scope/write-role.ts` 文件头也把「**规则维护**」点名为 admin 的本职。
//   ⇒ 本文件按**三处取并**实现：`gm` / `admin` 可配任意层，`dept_manager` 可配**管辖部门内**的
//     L3 / L4；其余角色一律 403。待需求 §7 补正式权限表后回归规格、撤销本段。
//
// 分层约束（架构 §5.4）：`domain/**` 零框架 / 零 ORM、不查库 —— 本文件只做纯判定，
//   假数据即可单测（→ `sea-rule.spec.ts`）。
// =============================================================================
import { resolveSeaRuleFor, type SeaRuleLike } from './sea-warning';

/** 规则层级（→ F1 `level`；数值**越大越优先**，命中解析 L4→L1 取第一条） */
export const SEA_RULE_LEVEL = {
  /** 全局默认（老板配） */
  global: 1,
  /** 产品级（老板配） */
  productLine: 2,
  /** 部门级（部门经理配） */
  dept: 3,
  /** 部门 × 产品级（部门经理配，优先级最高） */
  deptProductLine: 4,
} as const;

export type SeaRuleLevel = (typeof SEA_RULE_LEVEL)[keyof typeof SEA_RULE_LEVEL];

/**
 * 规则行状态（→ F1 `status`，`VARCHAR(16)`）。
 * ★ 「停用不删」（T5）：改天数＝插新版本行 ＋ 旧行置 `disabled`，**历史版本行永久留在表里**。
 */
export const SEA_RULE_STATUS = {
  active: 'active',
  disabled: 'disabled',
} as const;

/**
 * 7 天缓冲（需求 §6.3：「变更后 **7 天**才生效」）。
 * ★ 只此一处：新版本行的 `effective_from` 与预告的判定基准都由它算出来。
 */
export const SEA_RULE_BUFFER_DAYS = 7;

/**
 * 「可配任意层」的角色（＝能配全局 / 产品级那两档的人）。
 * ⚠ 组合口径见文件头 ⚠ 段（需求 §6.3 ＋ 前端 §四.2 ＋ `write-role.ts`）→ 欠账 **D-69**。
 */
export const SEA_RULE_ADMIN_ROLES = ['gm', 'admin'] as const;

/** 部门经理角色码（部门级 / 部门×产品级，限**管辖部门**内） */
export const SEA_RULE_MANAGER_ROLE = 'dept_manager';

/** 看规则的人（＝请求上下文里与权限有关的那两项，不含 employeeId） */
export interface SeaRuleViewer {
  /** 我持有的角色码（`context.roleCodes`） */
  readonly roleCodes: readonly string[];
  /**
   * 我**管辖**的部门集合（`context.dataScope.deptIds`）。
   * ★ 取**管辖**不取**所属**：需求 §6.3 说的是"部门经理配本部门规则"，
   *   而"所属部门"里含兼岗部门——那不该自动获得配置权。
   */
  readonly managedDeptIds: readonly bigint[];
}

/** 一条规则的"位置"（层级 ＋ 两个 key）—— 配置端点与预告都只认这三样 */
export interface SeaRuleScope {
  readonly level: number;
  readonly deptId: bigint | null;
  readonly productLineId: bigint | null;
}

/** 「按部门 × 产品线」的在途私海条数（C 域聚合出口给 F 域的**唯一**形状） */
export interface PrivateSeaGroup {
  readonly deptId: bigint;
  readonly productLineId: bigint;
  readonly count: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 该角色集合是不是"可配任意层"（老板 / 管理员） */
function isRuleAdmin(viewer: SeaRuleViewer): boolean {
  return SEA_RULE_ADMIN_ROLES.some((code) => viewer.roleCodes.includes(code));
}

/**
 * 层级与两个 key 的搭配是否**合乎 F1 的层级语义**（L1 两空 / L2 只产品线 / L3 只部门 / L4 都有）。
 *
 * ★ 为什么必须有这一道：F1 说「按层可空」，而 DB 里唯一约束只有 `idx_level(level, dept_id,
 *   product_line_id, status)`（**非唯一**）—— 层级与 key 搭配错了不会被库拦下，只会在运行期
 *   静默失配（`matchesLevel` 判不中，那条规则等于没配）。故在**写入口**先拒。
 * @returns `false` ⇒ 调用方给 **400 / 20001**（入参形态问题，不是权限问题）
 */
export function isScopeConsistent(scope: SeaRuleScope): boolean {
  switch (scope.level) {
    case SEA_RULE_LEVEL.global:
      return scope.deptId === null && scope.productLineId === null;
    case SEA_RULE_LEVEL.productLine:
      return scope.deptId === null && scope.productLineId !== null;
    case SEA_RULE_LEVEL.dept:
      return scope.deptId !== null && scope.productLineId === null;
    case SEA_RULE_LEVEL.deptProductLine:
      return scope.deptId !== null && scope.productLineId !== null;
    // 未知层级：**不猜**（`level` 只许 1~4）
    default:
      return false;
  }
}

/**
 * 两条规则是否**在同一个规则位置**（层级 ＋ 两个 key）。
 *
 * ★ 这是「插新版本行 ＋ 旧行 `disabled`」的**落点判据**：同位置只有一行 `active`。
 *   与 `isScopeConsistent` 分开写，是因为本函数**不判合法性**（脏数据也要能比对出同位置、
 *   否则旧行停不掉 ⇒ 同位置两行 active ⇒ 命中解析取到哪条全看排序）。
 */
export function isSameRuleSlot(a: SeaRuleScope, b: SeaRuleScope): boolean {
  return a.level === b.level && a.deptId === b.deptId && a.productLineId === b.productLineId;
}

/** 新版本的生效时刻 ＝ **提交时刻 ＋ 7 天**（需求 §6.3 / F1「`effective_from` ＝ 变更提交日 + 7 天」） */
export function resolveEffectiveFrom(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + SEA_RULE_BUFFER_DAYS * MS_PER_DAY);
}

/**
 * 能不能进「公海规则」这块配置（→《前端》§四.2 系统设置行：老板 ✅ / 管理员 ✅核心 /
 * 部门经理「部分子页（含公海规则）」；**销售与交付·客服全是 ➖**）。
 *
 * ⚠ 判据是**角色**：能不能看 ≠ 能不能改（改哪一层另见 `canManageSeaRule`）。
 */
export function canReadSeaRules(viewer: SeaRuleViewer): boolean {
  if (isRuleAdmin(viewer)) return true;
  return viewer.roleCodes.includes(SEA_RULE_MANAGER_ROLE) && viewer.managedDeptIds.length > 0;
}

/**
 * 规则的**读**范围：`null` ＝ **不收敛**（老板 / 管理员看全部）；数组 ＝ 额外可见这些部门的
 * L3 / L4（**L1 / L2 一律可见** —— 它们是上级兜底，看不到就解释不了"我这个部门到底按几天算"）。
 *
 * ★ 返回 `null` 是**显式语义**（不是"没传"）：调用方必须把 `null` 与空数组分清楚
 *   （空数组＝一个部门都不可见，`null`＝全看），与 D-28 那条「不给默认值」同一姿势。
 * ⚠ 调用前先过 `canReadSeaRules`（无权者这里会回一个无意义的空集合，不当作放行）。
 */
export function resolveSeaRuleReadDeptIds(viewer: SeaRuleViewer): readonly bigint[] | null {
  return isRuleAdmin(viewer) ? null : viewer.managedDeptIds;
}

/**
 * 能不能改**这条层级 / 这个位置**的规则（需求 §6.3 的层级归属）。
 *
 * ```
 * 全局(L1) / 产品级(L2)      → gm / admin
 * 部门(L3) / 部门×产品(L4)   → gm / admin ／ **该部门的**部门经理
 * ```
 * @returns `false` ⇒ 调用方给 **403 / 20003**（不是 400：人的身份不够，不是参数写错）
 */
export function canManageSeaRule(viewer: SeaRuleViewer, scope: SeaRuleScope): boolean {
  if (isRuleAdmin(viewer)) return true;
  if (scope.level === SEA_RULE_LEVEL.global || scope.level === SEA_RULE_LEVEL.productLine) {
    return false;
  }
  if (!viewer.roleCodes.includes(SEA_RULE_MANAGER_ROLE)) return false;
  // `deptId === null` 的 L3/L4 本就过不了 `isScopeConsistent`，这里再兜一道（不读成"全局"）
  return scope.deptId !== null && viewer.managedDeptIds.includes(scope.deptId);
}

/**
 * **本次变更将影响 X 个客户**（需求 §6.3：「提交变更时系统先提示『本次将影响 X 个客户』，
 * 经理可取消或改小幅度」）。
 *
 * 口径 ＝ **新版本生效后、由这条规则约束的在途私海客户数**：
 *   ① 把"变更后"的规则集合拼出来 ＝ **去掉同位置的旧版本行**（会被置 `disabled`）＋ 新版本行；
 *   ② 逐个「部门 × 产品线」用**与扫描同一个** `resolveSeaRuleFor` 解析（L4→L1 取第一条）；
 *   ③ 解析结果就是这条新规则的，把该组的在途条数计进来。
 *
 * ★ 为什么用 `at = 新版本 effective_from`（不是"现在"）：预告的是**生效那一刻**的影响面，
 *   而那 7 天里可能还有别的待生效版本。用"现在"会漏掉将来的层面（比如另一个部门正在改的 L3）。
 * ★ 「在途」＝ C 域聚合出口给的**私海且仍在位有 owner** 的那批（与掉海候选同一套条件）——
 *   预告的数与将来真会被重算的数**同源**。
 * ★ 规则**没配 `follow_freq_days`** 时这些客户其实没有倒计时（扫描会跳过），此处**仍计入**：
 *   本条预告的是「**这条规则会管到多少个客户**」（管辖面），不是"会掉多少个"。
 */
export function countAffectedCustomers(input: {
  /** 现有的 `active` 规则行（**包含待生效的**，判定基准见 `at`） */
  readonly existingRules: readonly SeaRuleLike[];
  /** 本次要落库的**新版本行**（`effectiveFrom` 已是提交日 + 7 天） */
  readonly nextRule: SeaRuleLike;
  /** 「部门 × 产品线」在途私海条数（C 域聚合出口） */
  readonly groups: readonly PrivateSeaGroup[];
  /** 判定基准时刻 ＝ 新版本的 `effective_from` */
  readonly at: Date;
}): number {
  const others = input.existingRules.filter((rule) => !isSameRuleSlot(rule, input.nextRule));
  const rules = [...others, input.nextRule];

  let affected = 0;
  for (const group of input.groups) {
    const hit = resolveSeaRuleFor(
      rules,
      { deptId: group.deptId, productLineId: group.productLineId },
      input.at,
    );
    if (hit !== null && isSameRuleSlot(hit, input.nextRule)) affected += group.count;
  }
  return affected;
}

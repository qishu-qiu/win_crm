// =============================================================================
// A 域纯规则（M1-06）—— 「角色码 → 数据范围 / 主角色」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §7.2：`dataScope.type` **四档**（2026-09-14 由三档补齐）——
//       `self`（销售：本人 ∪ 有效协同 ∪ 公海） / `serving`（**交付·客服：仅「服务中」客户**＝
//       **在合同服务期内**，只读、不进公海） / `dept`（部门经理：管辖部门） / `all`（总经理 / 管理员：全公司）。
//   · 《销售CRM业务需求文档》V1.26 §4.2 可见范围表 ＋《接口API文档》V1.16 §2.2
//     ＋《数据架构文档》V1.31 §十一（三处同口径，实现落点＝架构 §7.2）。
//   · 《销售CRM业务需求文档》：**管理员可查看业务数据（2026-09-11 定；2026-09-14 补「只读 ＋
//     每次查看写 `operation_log` ＋ 不解除金额脱敏」）** —— 故 `admin` 亦落 `all`。
//     ★ 「只读 / 留痕 / 不脱敏」是**写权限与出口渲染**约束，**不属于数据范围**，别混进本文件。
//   · 《销售CRM数据架构文档》V1.31 A4：内置角色码 `sale / service / delivery / admin / dept_manager / gm`。
//     ⚠ 是 `sale` **不是** `sales` —— `kernel/context/jwt-claims.ts` 的注释里写的 `sales` 是笔误，
//       以 A4 表为准。
//     ⚠~~现场核对（2026-09-14）：`0001_init` 只有建表、没有 `role` 种子~~ → **已解决**：
//       A 域种子落在 `服务端/prisma/seed/001_dev_seed.sql`（幂等，含 6 角色 / 6 员工 / 5 部门）。
//
// 分层约束（架构 §5.4）：`domain/**` 须与框架 / ORM 解耦 ——
//   本文件**不 import `@nestjs/*` / `@prisma/client`**，也不查库，用假数据即可单测。
//   `DataScopeType` 只做**类型**引用（`import type`，编译期擦除，不产生运行期依赖）。
// =============================================================================
import type { DataScopeType } from '../../../kernel/context/request-context';

/** 内置角色码（→ 数据架构 A4，内置 6 条，`builtin` 不可删） */
export const BUILTIN_ROLE_CODES = [
  'sale',
  'service',
  'delivery',
  'admin',
  'dept_manager',
  'gm',
] as const;

export type BuiltinRoleCode = (typeof BUILTIN_ROLE_CODES)[number];

/**
 * 主角色优先级 —— **从「权限最大」到「最普通」**，用于 `/account/me` 的 `role` 字段。
 *
 * ⚠ 规格**没有定义**「一人多角色时 `role` 取哪一个」（API §5.2 的 `UserVO` 只有 `role` 单值，
 *   而 A5 明写一人可多角色）。此处取「权限最大者」是本项目的技术口径：
 *   前端据 `role` 渲染菜单，取最大者才不会把总经理渲染成销售菜单。
 *   → 已记入 M1 完成报告「规格缺口」待确认。
 */
const PRIMARY_ROLE_PRIORITY: readonly string[] = [
  'gm',
  'admin',
  'dept_manager',
  'sale',
  'service',
  'delivery',
];

/**
 * 角色优先级序号（**越小越优先**）；未知角色码（自定义角色）排在所有内置角色之后。
 * 供 `resolvePrimaryRole` 与 `mergePermissionLevels` 共用**同一张优先级表** ——
 * 菜单取的角色与权限取的角色必须同源，否则会出现「菜单是总经理、权限是销售」的错位。
 */
export function rolePriority(roleCode: string): number {
  const index = PRIMARY_ROLE_PRIORITY.indexOf(roleCode);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 角色码集合 → 主角色码（`UserVO.role`）。
 * 未知角色码不抛错（显示不出主角色不该让登录失败），取字典序最小者保证**同输入同输出**。
 */
export function resolvePrimaryRole(roleCodes: readonly string[]): string {
  for (const code of PRIMARY_ROLE_PRIORITY) {
    if (roleCodes.includes(code)) return code;
  }
  return [...roleCodes].sort()[0] ?? '';
}

/** `serving` 档的角色码（交付 / 客服）—— 单独一处，避免在多个判断里各写一遍字符串 */
const SERVING_ROLE_CODES = ['service', 'delivery'] as const;

/**
 * 角色码集合 → 数据范围档位（→ 架构 §7.2，**按「范围从宽到窄」顺序判定**）。
 *
 * ```
 * gm / admin          → all      （总经理全公司；管理员可查看业务数据）
 * dept_manager        → dept     （只定档位；具体部门集合由 dept_manager 表提供）
 * sale                → self     （本人私海 ∪ 有效协同 ∪ 公海）
 * service / delivery  → serving  （仅「服务中」客户＝在合同服务期内；只读、不进公海）
 * 无角色 / 未知角色     → self     （最小权限兜底，**绝不默认放行**）
 * ```
 *
 * ★ **一人多角色时取更宽的那一档**（顺序即宽窄序，从上往下取第一个命中）：
 *   与 `resolvePrimaryRole`（主角色取权限最大者）**同一条思路** —— 窄角色不许把宽角色拉低。
 *   ⚠ 规格**没有定义**多角色的数据范围合成（`employee_role` 允许一人多角色，→ A5），
 *     本序是**本项目技术口径**：`sale ＋ delivery` 判 `self`（销售是客户经营第一人，
 *     若判成 `serving` 他会连自己的私海与掉海客户都看不到，直接影响经营动作）；
 *     `service ＋ delivery` 判 `serving`。→ 已记入本轮完成报告「规格缺口」待确认。
 *
 * ⚠ `all` / `self` / `serving` 时本函数**不管部门集合**（一律空数组）；
 *   `dept` 时调用方须再查 `dept_manager` 表把 id 集合补齐 —— 置空会让经理「看到空数据」，
 *   那是静默错误，比抛错更危险。
 */
export function resolveDataScope(roleCodes: readonly string[]): DataScopeType {
  if (roleCodes.includes('gm') || roleCodes.includes('admin')) return 'all';
  if (roleCodes.includes('dept_manager')) return 'dept';
  if (roleCodes.includes('sale')) return 'self';
  if (SERVING_ROLE_CODES.some((code) => roleCodes.includes(code))) return 'serving';
  return 'self';
}

/** 是否「经理」档（`/account/me` 的 `managed_dept_ids` 非空即经理，此处供守卫与断言复用） */
export function isDeptScopedScope(scope: DataScopeType): boolean {
  return scope === 'dept';
}

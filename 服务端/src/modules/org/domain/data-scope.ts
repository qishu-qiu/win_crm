// =============================================================================
// A 域纯规则（M1-06）—— 「角色码 → 数据范围 / 主角色」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.1 §7.2：`dataScope.type` 三档 ——
//       `self`（销售：本人） / `dept`（部门经理：管辖部门） / `all`（总经理：全公司）。
//   · 《销售CRM业务需求文档》：**管理员可查看业务数据（2026-09-11 定）** ——
//     故 `admin` 亦落 `all`。注意「只读」是**写权限**约束，不属于数据范围，别混进来。
//   · 《销售CRM数据架构文档》A4：内置角色码 `sale / service / delivery / admin / dept_manager / gm`。
//     ⚠ 是 `sale` **不是** `sales` —— `kernel/context/jwt-claims.ts` 的注释里写的 `sales` 是笔误，
//       以 A4 表为准。
//     ⚠⚠ 现场核对（2026-09-14）：`prisma/migrations/0001_init` **只有建表、没有任何 `role` 种子**
//       （A4 只写「内置 6 条」，种子 SQL 并未落库；全库 `INSERT` 只出现在 `operation_log` 的注释里）。
//       → 真账号登录前**必须先补 role 种子 ＋ 一个测试员工**，否则 `employee_role` 是空的、
//         `resolveDataScope` 只会返回 `self`。已记入 M1 待办（需七叔明文执行令才能动真库）。
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

/**
 * 角色码集合 → 数据范围档位（→ 架构 §7.2）。
 *
 * ```
 * gm / admin        → all   （总经理全公司；管理员可查看业务数据 2026-09-11 定）
 * dept_manager      → dept  （只定档位；具体部门集合由 dept_manager 表提供）
 * 其余（sale/service/delivery） → self
 * ```
 *
 * ⚠ `all` 时本函数**不管部门集合**；`dept` 时调用方须再查 `dept_manager` 表把 id 集合补齐
 *   —— 置空会让经理「看到空数据」，那是静默错误，比抛错更危险。
 */
export function resolveDataScope(roleCodes: readonly string[]): DataScopeType {
  if (roleCodes.includes('gm') || roleCodes.includes('admin')) return 'all';
  if (roleCodes.includes('dept_manager')) return 'dept';
  return 'self';
}

/** 是否「经理」档（`/account/me` 的 `managed_dept_ids` 非空即经理，此处供守卫与断言复用） */
export function isDeptScopedScope(scope: DataScopeType): boolean {
  return scope === 'dept';
}

// =============================================================================
// A 域纯规则（M1-05 / M1-10 的配套）—— 权限矩阵行 → `UserVO.permissions`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §5.2：`UserVO.permissions = {"perm_key":"level"}`。
//   · 《销售CRM数据架构文档》A6 `permission_matrix(perm_key, role_code, level)`，
//     `level ∈ visible / masked / denied`。
//
// ⚠ 规格**没有定义「一人多角色时同一个 `perm_key` 取哪一个 level`」**
//   （A5 明写一人可多角色，A6 是 (perm_key, role_code) 二维表，天然会撞行）。
//   本项目技术口径：**按角色优先级取先出现者**（与 `resolvePrimaryRole` 同一优先级表）——
//   理由＝总经理挂着「销售」角色时不该被降级成销售的权限，与菜单/数据范围口径保持自洽。
//   → 已记入 M1 完成报告「规格缺口」待确认。
//
// 分层约束（架构 §5.4）：`domain/**` 不与框架 / ORM 耦合；本文件**不 import `@nestjs/*` / `@prisma/client`**。
// =============================================================================
import { rolePriority } from './data-scope';

/** 一条权限矩阵行（形状对齐 A6；由 repository 取回后原样传入，**不在这里查库**） */
export interface PermissionRow {
  perm_key: string;
  role_code: string;
  level: string;
}

/**
 * 权限矩阵行 → `perm_key -> level` 映射（`UserVO.permissions`）。
 *
 * @param rows     该员工命中的矩阵行（`perm_key` 可能重复）
 * @param roleCodes 该员工的角色码集合 —— **既排优先级，也做一次过滤**
 * @returns 按 `perm_key` 字典序排列的普通对象 —— **排序是为了让出参稳定**，
 *          否则同样的输入在不同进程 / 不同查询计划下会给出不同键序，前端 diff 与快照测试都会抖。
 *
 * ★ 为什么要**在这里再过滤一遍** `roleCodes`（哪怕仓储的 SQL 已经按角色关联过）：
 *   权限是**鉴权结果**，属最不能靠「上游一定没错」的一类计算。仓储换一种 join 写法、
 *   将来加个「角色继承」，误把别人的行带进来，症状是**越权**且线上毫无提示。
 *   这里多一次集合判断（O(1)），换来的是「出参只可能由**该员工自己的角色码**决定」这条不变量。
 *
 * 未知角色码（库里被手工塞的自定义角色）排在**所有内置角色之后**，且互相之间保持「先到先得」，
 * 保证同输入同输出，不会随查询顺序漂移。
 */
export function mergePermissionLevels(
  rows: readonly PermissionRow[],
  roleCodes: readonly string[],
): Record<string, string> {
  const ownRoles = new Set(roleCodes);
  const winner = new Map<string, { rank: number; level: string }>();

  for (const row of rows) {
    if (!ownRoles.has(row.role_code)) continue;

    const rank = rolePriority(row.role_code);
    const current = winner.get(row.perm_key);
    if (current === undefined || rank < current.rank) {
      winner.set(row.perm_key, { rank, level: row.level });
    }
  }

  return Object.fromEntries(
    [...winner.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([permKey, value]) => [permKey, value.level]),
  );
}

/** 角色码是否属于给定集合（`permissions` 兜底判空的便捷断言，供 spec 与守卫复用） */
export function hasAnyRole(roleCodes: readonly string[], expected: readonly string[]): boolean {
  return expected.some((code) => roleCodes.includes(code));
}

// =============================================================================
// A 域纯规则 —— 员工列表的可见范围（G7 收敛）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §4.2：`GET /org/employees` ——
//     「**服务端按 `managed_dept_ids` 收敛**（G7）；**销售只能看同部门**」。
//   · 同 §4.2 通用约定（G7）：**多部门筛选取「登录人管辖部门 ∩ 请求部门」** ——
//     即「范围永远是登录人管辖范围与请求范围的**交集**，绝不放大**」。
//   · 《销售CRM接口API文档》V1.18 §2.2 / 《数据架构文档》V1.32 §十一 /《业务需求文档》§4.2：
//     `all`（总经理 / 管理员）不过滤；`dept`（经理）＝管辖部门；`self` / `serving` 仅**同部门**。
//   · 《架构设计说明》V1.3 §7.2：数据范围注入「一处收口」，**禁止在 repository 手写范围条件**。
//
// ★ **M5-02 起，档位判定不在这里了**：唯一入口＝`kernel/data-scope/data-scope-target.ts`。
//   本文件只剩「把范围描述翻译成**员工表**的过滤依据」这一件事（＝A 域自己的语义）。
//   ⚠ 员工表**只有部门归属、没有 owner 概念**，故 `self` / `serving` 在这里都收敛成「同部门」
//     （判据＝接口 §4.2「销售只能看同部门」）—— 这是**A 域的翻译**，不是 kernel 的档位判定。
//   ★ 旧说法「M5 会把范围注入到所有列表查询，本文件只解决 A 域这一处」**已作废**：
//     收口方式是「kernel 出判定 ＋ 各域翻译」，**不是**「拦截器统一注入」（拦截器改不了 service 内的查询）。
//
// 分层约束（架构 §5.4）：`domain/**` 不 import 框架 / ORM、不查库，用假数据即可单测。
// =============================================================================
import type { DataScope } from '../../../kernel/context/request-context';
// ⚠ 必须走**深路径**、不能用 `../../../kernel` 桶文件：桶会连带 import `@nestjs/*`（audit 等），
//   而 `domain/**` 的硬约束是零框架依赖（架构 §5.4）。`resolveDataScopeTarget` 本身是纯函数。
import { resolveDataScopeTarget } from '../../../kernel/data-scope/data-scope-target';

/**
 * 「这一次请求能看到哪些部门的人」。
 *
 * 返回 `null` ＝ **不过滤**（`all` 档：总经理 / 管理员 —— 与 §7.2「总经理：不过滤」一致）；
 * 返回数组 ＝ **只保留部门归属与该集合有交集的员工**。
 *
 * ★ 为什么用 `null` 而不是「返回全量部门集合」：全量部门集合在这里是**查不出来的**
 *   （domain 层不查库），用 `null` 表达「不限」比伪造一个集合诚实。
 */
export function visibleEmployeeDeptIds(
  scope: DataScope,
  myDeptIds: readonly bigint[],
): readonly bigint[] | null {
  // ★ 档位判定一律走 kernel 唯一入口（M5-02）；本文件只做「范围描述 → 员工表怎么过滤」的翻译
  const target = resolveDataScopeTarget(scope);

  // 总经理 / 管理员：全公司可见（管理员另有「只读 ＋ 每次查看留痕」约束，属写权限 / 审计，不在这里）
  if (target.mode === 'all') return null;
  // 部门经理：管辖部门（`dept` 档的集合由 kernel 从 `dataScope.deptIds` 取出，→ jwt-claims 契约）
  if (target.mode === 'depts') return target.deptIds;
  // 销售（self）/ 交付·客服（serving）：只能看同部门 —— 即「我所属 ∪ 我管辖」
  return myDeptIds;
}

/**
 * 单个员工是否落在允许范围内（`allowed === null` ＝ 不过滤，一律可见）。
 *
 * `employeeDeptIds` 应传**主部门 ＋ 兼部门**：兼部门员工也是「本部门的人」，
 * 漏掉兼部门会让兼部门同事在列表里凭空消失（静默少数据，比报错更难查）。
 */
export function isEmployeeVisible(
  allowedDeptIds: readonly bigint[] | null,
  employeeDeptIds: readonly bigint[],
): boolean {
  if (allowedDeptIds === null) return true;

  const allowed = new Set(allowedDeptIds);
  return employeeDeptIds.some((id) => allowed.has(id));
}

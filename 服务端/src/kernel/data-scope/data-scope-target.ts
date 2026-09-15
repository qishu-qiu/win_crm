// =============================================================================
// 数据范围 → 查询目标（M5-02）—— ★ 「我能看到谁」的**唯一判定点** ★
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §7.2 数据范围注入（**四档**）：
//       销售 `self` ＝ 本人 ∪ 有效协同人 ∪ 公海；**交付·客服 `serving` ＝ 仅「服务中」客户**
//       （＝在合同服务期内，只读、**不进公海**）；经理 `dept` ＝ 管辖部门；总经理 / 管理员 `all` ＝ 不过滤。
//       ★「所有列表查询必须经过它」「**禁止**在 repository 手写 `where owner_id = ...`」。
//   · 《销售CRM业务需求文档》§4.2 可见范围表（四档同口径）＋《接口API文档》§2.2（越界 → 403 / 20003）。
//   · 《销售CRM架构设计说明》§5.2 / §5.4：`kernel/` ＝ 第 0 层内核 —— **谁都能用、它不依赖任何人**。
//
// ★ 为什么落点是 `kernel/`，不是任务书写的 `domain/`（2026-09-15 七叔拍板 · 开工前已说明）：
//   ① `shared/**` 业务域**不许 import**（§5.4 用 ESLint 硬卡）⇒ 放 shared 等于各域都用不到；
//   ② `modules/<域>/domain/**` 是**本域私有**，别的域 import 它就是跨域引内部实现（§5.3 禁止）；
//   ③ `kernel/**` 是唯一「**所有域都能用** ＋ 与被依赖方无环」的位置，且天然是纯函数、零框架依赖。
//
// ★ 本文件只回答「**这次请求的范围是什么**」，**不回答「我的表怎么落成 SQL」**：
//   各表的归属语义本就不同 —— `business_relation` 的 owner 落在**成员表**、`employee` **只有部门**、
//   公司档案 `company` 是**全公司共享的公司公海**（根本没有 owner 归属，不该按 owner 过滤）。
//   把「表怎么过滤」也塞进来，就得为每张表加分支 ＝ 把 7 个域的私事搬进内核。
//   故此处只出**中立的范围描述**，由各域 repository 翻译成自己的 where（M5-03 硬约束 2 的落点）。
//
// 分层约束（架构 §5.4）：本文件**不 import `@nestjs/*` / `@prisma/client`、不查库**，
//   `DataScope` 只做**类型**引用（`import type`，编译期擦除，不产生运行期依赖）。
// =============================================================================
import type { DataScope } from '../context/request-context';

/**
 * 一次请求的**范围描述**（中立于表结构的中介形态）。
 *
 * | mode | 含义 | 各域怎么落 |
 * | --- | --- | --- |
 * | `all` | 不过滤（总经理 / 管理员） | where 里**不加**范围条件 |
 * | `depts` | 限定部门集合 | `dept_id IN (…)`（**空数组＝看不到任何部门，不是不过滤**） |
 * | `self` | 本人相关（owner ∪ 有效协同） | 关系表走成员表子查询；无 owner 概念的表按「同部门」收敛 |
 * | `serving` | 服务中客户（合同服务期内） | ⚠ **E 域（合同）尚未接入**，见 `resolveDataScopeTarget` 的说明 |
 *
 * ★ 用中立形态而非 Prisma `where` 片段：`domain/**` 与 `kernel/**` 都**不许 import Prisma 类型**
 *   （架构 §5.4），且一旦知道表字段名，本文件就绑死在某一张表上、失去「7 域共用一个判定」的意义。
 */
export type DataScopeTarget =
  | { readonly mode: 'all' }
  | { readonly mode: 'depts'; readonly deptIds: readonly bigint[] }
  | { readonly mode: 'self' }
  | { readonly mode: 'serving' };

/**
 * 数据范围档位 → 范围描述（**四档 → 四种条件**，M5-02 判据）。
 *
 * ```
 * all     → { mode: 'all' }                         不过滤
 * dept    → { mode: 'depts', deptIds }              `dept` 档的部门集合**只从 `scope.deptIds` 取**
 *                                                   （＝令牌里的「我管辖部门」，见 §7.2 与 M1 签发侧）
 * self    → { mode: 'self' }                        本人 ∪ 有效协同（「和谁有关」由各域用 viewer 自己算）
 * serving → { mode: 'serving' }                     服务中客户
 * ```
 *
 * ★ **唯一入口**：`scope.type` 的判定**只允许出现在本文件**。各域（A 域员工列表 `G7` /
 *   C 域私海公海 / 后续 B·E 域的列表）一律调本函数拿 `mode`，**不得自己写 `if (scope.type === 'all')`**
 *   —— 那正是「散在 ~80 个接口里各写一遍，必然有漏的」（§七 首段）的复现路径。
 *   机械检查（收口自检，M5-03）：
 *     `rg -n "\.type === '(all|dept|self|serving)'" 服务端/src --glob '!src/kernel/**'` 应为 **0 命中**。
 *
 * ⚠ **`serving` 档的真实条件（「仅合同服务期内的客户」）本批尚未生效**（2026-09-15 七叔拍板）：
 *   E 域（合同 / 回款）**还没建**，没有「服务期」可查。故本函数只给出 `mode: 'serving'` 这个**形状**，
 *   各域**暂按 `self` 收敛**（＝现状行为，**比规格窄、不越权**），待 E 域落地后改为按
 *   `service_start / service_end` 过滤。**这条缺口已登记，不是漏做**（→ 交接说明「欠账」）。
 *
 * ⚠ **未知档位一律落 `self`（最窄的常规档），绝不落 `all`** —— 与 `resolveDataScope`
 *   「无角色 / 未知角色 → self」同一条思路：宁可少看到，不可默认全量。
 */
export function resolveDataScopeTarget(scope: DataScope): DataScopeTarget {
  if (scope.type === 'all') return { mode: 'all' };

  if (scope.type === 'dept') {
    // 直接透传（**不补默认部门**）：`dept` 档但管辖部门为空，是「看不到任何部门」——
    // 补成全量就成了越权，补成空数组也只是如实反映事实（→ 架构 §7.2 `dept_manager` 表提供集合）。
    return { mode: 'depts', deptIds: [...scope.deptIds] };
  }

  if (scope.type === 'serving') return { mode: 'serving' };

  // `self` ＋ 类型上不可能出现的档位（防御式兜底）：都按「本人相关」处理，**绝不放成全部**
  return { mode: 'self' };
}

// =============================================================================
// C 域纯规则（M3-07 / M3-08 的范围口径）—— 「我**能看**哪些关系、**能写**哪些关系」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM业务需求文档》§4.2 可见范围表 ＋《销售CRM接口API文档》§2.2 ＋
//     《销售CRM架构设计说明》§7.2（三处同口径，**四档**）：
//       销售 `self`      ＝ 本人 owner 私海（含 collaborator / ask_help 并集）∪ 公海
//       交付·客服 `serving` ＝ 仅「服务中」客户（＝**在合同服务期内**）——**只读**、**不进公海**
//       部门经理 `dept`   ＝ 管辖部门（`dept_manager`）
//       总经理·管理员 `all`＝ 不过滤（**管理员另有「只读 ＋ 留痕 ＋ 不解除金额脱敏」**，→ §2.2）
//   · 《销售CRM数据架构文档》C1：**部门公海 ＝ `company_sea` 中 `dept_id`=本部门的关系集合**
//     （映射视图，**不是独立一层**，→ 废止口径 #3 / #18 / #21）⇒ 销售看公海＝看**自己部门**的公海。
//   · 废止口径 #9：「跨部门捡公海」**不存在**；别部门想要 → 自己激活一条本部门的关系。
//   · 同 C1「★ `dept_id` 恒定不可变」⇒ 激活时给的 `dept_id` 必须落在**可建范围内**，
//     否则就是「替别的部门建档」——那是越权，不是业务便捷。
//
// ★ 为什么 M3 就要做范围收敛（而架构把「数据范围注入」排到 M5）：
//   M3 交付的是**第一个客户数据列表**。不收敛 ＝ 上线即越权口子（能列出全公司的私海）。
//   M1 的 `/org/employees` 同样提前做了 G7 收敛 —— 同一判断，不重复论证。
//
// ★ 2026-09-15（M5-01/02）落点已定 —— **旧说法「M5 把判定搬进数据范围拦截器」作废**：
//   拦截器在响应式管道里**改不了 service 内部的 Prisma 查询**，故它只负责「把范围打标到请求上」；
//   唯一的档位判定收进 `kernel/data-scope/data-scope-target.ts`（M5-02）。
//   本文件＝**C 域的翻译层**：把「范围描述 ＋ 私海 / 公海页签语义」翻成 `RelationScope`
//   （service 据它选一个仓储方法），它**不再是**档位判定的落点。
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 ——
//   `DataScope` / `DataScopeType` 只做**类型**引用（`import type`，编译期擦除，不产生运行期依赖）。
//   ⚠ `resolveDataScopeTarget` 必须走**深路径**：`../../../kernel` 桶文件会连带 import `@nestjs/*`。
// =============================================================================
import type { DataScope } from '../../../kernel/context/request-context';
import { resolveDataScopeTarget } from '../../../kernel/data-scope/data-scope-target';
import { isBusinessWriteRole } from '../../../kernel/data-scope/write-role';
import { OWNER_MEMBER_TYPE, isEffectiveCollaborator, type RelationMemberLike } from './relation-owner';

/** 关系列表的两个页签（→ 接口 §4.4 / 前端 §四：私海 / 公海） */
export type RelationListTab = 'private' | 'sea';

/** 「查看者」三件套（**只从令牌来**，不查库 —— → 架构 §7.1「横切层只读上下文」） */
export interface RelationViewer {
  employeeId: bigint;
  roleCodes: readonly string[];
  dataScope: DataScope;
  /** 我所属部门（含**兼部门**，→ 令牌声明 `dept_ids`）；`dataScope.type='dept'` 时它**不是**管辖部门 */
  myDeptIds: readonly bigint[];
}

/**
 * 列表范围（service 据此**选一个仓储方法**，不在 service 里拼 `where`）。
 *
 * - `all`   —— 不过滤（总经理 / 管理员）
 * - `dept`  —— 按**给定部门集合**过滤（经理＝管辖部门；销售看公海＝我所属部门）
 * - `mine`  —— 我 owner ∪ 我有效协同（销售 / 交付·客服的私海）
 * - `denied`—— 无权限（→ 403 / 20003）
 */
export interface RelationScope {
  kind: 'all' | 'dept' | 'mine' | 'denied';
  /** 仅 `kind='dept'` 有意义；其余档位为空数组（**空数组 ≠ 不过滤**，别混） */
  deptIds: readonly bigint[];
}

/**
 * 解析列表范围（→ M3-07 私海 / M3-08 公海）。
 *
 * ★ 档位判定**不在这里**：一律走 kernel 唯一入口（M5-02），本函数只加**C 域的页签语义**。
 * ★ 交付 / 客服看**公海** → `denied`：§2.2 原文「**不进公海**」
 *   —— 返回空列表是**静默错误**（看着像「今天公海没人」），故给 403。
 */
export function resolveRelationListScope(
  tab: RelationListTab,
  viewer: RelationViewer,
): RelationScope {
  const target = resolveDataScopeTarget(viewer.dataScope);

  if (target.mode === 'all') return { kind: 'all', deptIds: [] };

  if (tab === 'sea') {
    // 公海：交付 / 客服**不进公海**（§2.2）；其余按部门看（部门公海＝本部门的关系集合，→ C1）
    if (target.mode === 'serving') return { kind: 'denied', deptIds: [] };
    // 经理＝管辖部门；销售＝**我所属部门**（看公海看的是本部门那一份，不是「和我有关的」）
    const deptIds = target.mode === 'depts' ? target.deptIds : viewer.myDeptIds;
    return { kind: 'dept', deptIds: [...deptIds] };
  }

  // 私海：经理按管辖部门；销售 / 交付·客服按「和我有关的关系」
  // ⚠ 交付 / 客服的正解是「仅**服务中**（＝在合同服务期内）」—— 合同表属 **E 域、尚未建**，
  //   M5 已裁「只做形状、不接真数据」（→ 交接说明欠账），故此处仍收敛到
  //   「我参与的关系（owner ∪ 有效协同）」：**比规格窄**、不越权。E 域落地后改按服务期过滤。
  if (target.mode === 'depts') return { kind: 'dept', deptIds: [...target.deptIds] };
  return { kind: 'mine', deptIds: [] };
}

/**
 * **可写**角色（→ M3 的写入口：激活 / 改属性 / 加成员）。
 *
 * ⚠ 规格**没有**一张「谁能写业务关系」的表，本判定由三处**已定口径**合成，属**本项目技术口径**：
 *   ① 数据范围表（→ §4.2）只给了「能看到谁」，故可见 ≠ 可写；
 *   ② 管理员＝**只读**（2026-09-14 定，→ §2.2：可以看业务数据，但只读 ＋ 留痕）；
 *   ③ 交付 / 客服＝**只读**（→ §2.2「只读；不进公海、不触发掉公海」，其日常留在工单 / 台账）。
 *   ⇒ 可写集合 ＝ `sale` / `dept_manager` / `gm`。
 *   ★ 「管理员 ＋ 销售」这种叠加仍**可写**（走销售那份权利）—— 与 `resolveDataScope`
 *     「多角色取更宽」同一条思路，**不是**「有一个只读角色就全禁」。
 *   → 已登记待确认（交接说明 §五）。
 */
export function isRelationWriteRole(roleCodes: readonly string[]): boolean {
  // ★ 判定**已上移 kernel**（`kernel/data-scope/write-role.ts`，2026-09-15）：B 域建档也要同一口径，
  //   而域之间不许互相 import ⇒ 只能放 kernel 各域共用。本函数保留＝**C 域的语义别名**
  //   （读代码时看得出"这是改关系的写权限"），行为与 kernel 完全一致，**别再各写一份**。
  return isBusinessWriteRole(roleCodes);
}

/** 写权限判定结果（service 据此给 403 人话） */
export type RelationWriteVerdict = { ok: true } | { ok: false; kind: 'read_only' | 'out_of_scope' };

/**
 * 能不能**看这条关系**（详情 / 成员列表）。
 *
 * ⚠ 与 `checkRelationWrite` 的关键差别：**这里不判「可写角色」** —— 管理员与交付 / 客服
 *   是「只读」而非「不可见」（→ §2.2：管理员可查看业务数据、交付 · 客服看服务中的客户）。
 *   把两者合成一个函数，会顺手把只读角色挡在详情页外面（少给他们该看的）。
 *
 * ★ `self` / `serving` 档＝「我参与的关系」（我主责 ∪ 我有效协同），与列表口径一致
 *   （列表能看见的东西，点进去必须打得开，否则就是「列表骗人」）。
 */
export function checkRelationRead(
  input: { deptId: bigint; members: readonly RelationMemberLike[] },
  viewer: RelationViewer,
  now: Date,
): RelationWriteVerdict {
  const { type } = viewer.dataScope;
  if (type === 'all') return { ok: true };
  if (type === 'dept') {
    return viewer.dataScope.deptIds.includes(input.deptId)
      ? { ok: true }
      : { ok: false, kind: 'out_of_scope' };
  }

  const mine = input.members.some(
    (member) =>
      (member.memberType === OWNER_MEMBER_TYPE &&
        member.employeeId === viewer.employeeId &&
        (member.revokedAt ?? null) === null) ||
      (member.employeeId === viewer.employeeId && isEffectiveCollaborator(member, now)),
  );
  return mine ? { ok: true } : { ok: false, kind: 'out_of_scope' };
}

/**
 * 能不能**在某个部门激活关系**（`POST /relations` 的 `dept_id` 范围校验）。
 *
 * ★ 判据：管理员 / 交付·客服 → 拒（只读）；`all` 档 → 任意部门；`dept` 档 → **管辖部门**；
 *   其余（销售）→ **我所属部门**（含兼部门）。
 */
export function checkActivateScope(
  deptId: bigint,
  viewer: RelationViewer,
): RelationWriteVerdict {
  if (!isRelationWriteRole(viewer.roleCodes)) return { ok: false, kind: 'read_only' };

  const { type } = viewer.dataScope;
  if (type === 'all') return { ok: true };

  const allowed = type === 'dept' ? viewer.dataScope.deptIds : viewer.myDeptIds;
  return allowed.includes(deptId) ? { ok: true } : { ok: false, kind: 'out_of_scope' };
}

/**
 * 能不能**改这条关系**（详情 / 改属性 / 加成员）。
 *
 * ★ 与「激活」的差别：这里判的是**已有关系**——除了范围，还要看**我是不是它的 owner**：
 *   `all` 档（总经理）不过滤；`dept` 档＝管辖部门内的关系；`mine` 档＝**我 owner** 的关系。
 *
 * ★★ **协同人不能改 —— 已定口径（2026-09-15 七叔拍板「维持」），不是待办**：
 *   协同人**只写跟单**（走读口径 ＋ 写角色，→ `relation.service.ts` 的 `requireWritableRelation`）；
 *   **改关系属性（紧迫档 / 价值档 / 下一步提示 / 竞品）与加成员，一律归 owner**（经理 / 总经理可兜底）。
 *   ⚠ 规格 C2「协同与 owner 同级」讲的是**跟单的读写**，**不含**本函数管辖的写动作 ——
 *     下个窗口读到那句**不要**据此放开这里；真要放开，必须先改签名（入参补 `members`）
 *     并同时改 `relation-scope.spec.ts` 里那条「★ 协同人 → 拒」的锚点用例。
 */
export function checkRelationWrite(
  input: { deptId: bigint; ownerId: bigint | null },
  viewer: RelationViewer,
): RelationWriteVerdict {
  if (!isRelationWriteRole(viewer.roleCodes)) return { ok: false, kind: 'read_only' };

  const { type } = viewer.dataScope;
  if (type === 'all') return { ok: true };
  if (type === 'dept') {
    return viewer.dataScope.deptIds.includes(input.deptId)
      ? { ok: true }
      : { ok: false, kind: 'out_of_scope' };
  }
  return input.ownerId === viewer.employeeId ? { ok: true } : { ok: false, kind: 'out_of_scope' };
}

/** 数据范围档位（转出去给 service 判「私海 / 公海」时用，避免 service 重复写字符串） */
export function seaStatusOfTab(tab: RelationListTab): 'private' | 'company_sea' {
  return tab === 'private' ? 'private' : 'company_sea';
}

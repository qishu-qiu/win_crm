// =============================================================================
// C 域仓储（M3-02 / M3-03 / M3-07 / M3-08）
//
// 分层约束（架构 §5.4）：**本文件是全项目「唯一允许 import Prisma 干活的层」**
//   —— 只查 / 写库，**不写业务判断**（唯一键格式在 `domain/relation-active-key.ts`、
//   范围判定在 `domain/relation-scope.ts`、owner 判定在 `domain/relation-owner.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》C1（`business_relation`）/
//     C2（`relation_member`）。
//   · 逻辑删除一律 `deleted_at IS NULL`（数据架构 §二 总则）；`merged_into IS NOT NULL`
//     是**被并分支**（→ C1：跟单仍挂原节点、展示层当分支）⇒ **列表与详情都要跳过它**，
//     否则「已并入 survivor 的那条关系」会一直在私海里占一行（而它已不占活跃位）。
//   · **活跃唯一位**由生成列 `active_key`（`private` 且未并 → 三元组）＋ `uk_active_rel` 保证
//     （→ C1 / `migrations/0001_init` ③）—— 见下方 `findActiveRelation` 的 ★ 说明。
//
// ★ 为什么仓储方法**按「范围」逐个具名**（而不是收一个 `where` 片段）：
//   §7.2 明令「**禁止**在 repository 手写 `where owner_id = ...`」——那句话的意思是
//   「范围条件不许各处各自发挥」。办法有两种：service 拼 `where`（就把 SQL 知识漏进 service 了），
//   或**范围与方法一一对应**（本文件的取法）：判定在 domain，取数在仓储，名字自己说明范围。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { type Pagination } from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COMPANY_SEA_STATUS,
  PRIVATE_SEA_STATUS,
  type RelationTriple,
} from './domain/relation-active-key';
import { type RelationListFilter } from './domain/relation-list-filter';
import { COLLABORATOR_MEMBER_TYPE, OWNER_MEMBER_TYPE } from './domain/relation-owner';

/** 交互式事务客户端（同 M2：直接取 Prisma 的 `TransactionClient`，类型上就没有 `$transaction`） */
export type RelationTxClient = Prisma.TransactionClient;

/**
 * 关系读出的列 ＋ 成员（**本域字段**；`company` / `dept` / `product_line` 的**名字**
 * 由 service 走跨域出口装配 —— 仓储只给 id，绝不 join 别人的表）。
 */
const RELATION_SELECT = {
  id: true,
  company_id: true,
  dept_id: true,
  product_line_id: true,
  stage_id: true,
  urgency: true,
  value_tier: true,
  customer_level: true,
  competition: true,
  competitor_id: true,
  sea_status: true,
  last_event_at: true,
  next_action_hint: true,
  merged_into: true,
  created_at: true,
  updated_at: true,
  members: {
    select: {
      employee_id: true,
      member_type: true,
      source: true,
      valid_until: true,
      revoked_at: true,
    },
    orderBy: { id: 'asc' },
  },
} as const;

/** 建档关系时写入的列（由 service 组装好，仓储只管落库） */
export interface CreateRelationData {
  company_id: bigint;
  dept_id: bigint;
  product_line_id: bigint;
  created_by: bigint;
}

/** 加成员时写入的列 */
export interface CreateMemberData {
  relation_id: bigint;
  employee_id: bigint;
  member_type: string;
  added_by: bigint;
  source?: string;
  valid_until?: Date;
}

/** 改属性时写入的列（**只带给了值的字段**，由 service 决定） */
export interface UpdateRelationData {
  urgency?: string;
  value_tier?: string;
  next_action_hint?: string;
  competition?: string;
  competitor_id?: bigint;
  updated_by: bigint;
}

@Injectable()
export class RelationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===== M3-02 / M3-03 激活（关系 ＋ owner 成员，本域事务内两步）=====

  /**
   * 插入业务关系。
   * ★ `sea_status` 走 DB 默认 `private`（本步同时写 owner 成员 ⇒ 「有 owner」成立）；
   *   **不显式写 `active_key`**：它是生成列，写了会报错（且必须由 DB 生成，
   *   否则「同键只有一条活跃」这件事就没有单一事实源了）。
   */
  createRelation(data: CreateRelationData, tx?: RelationTxClient) {
    const client = tx ?? this.prisma;
    return client.businessRelation.create({
      data: {
        company_id: data.company_id,
        dept_id: data.dept_id,
        product_line_id: data.product_line_id,
        created_by: data.created_by,
        updated_by: data.created_by,
      },
      select: RELATION_SELECT,
    });
  }

  /**
   * 插入关系成员。
   * ★ 撞 `uk_member`（同关系同人同类型重复授予）或 `uk_owner`（一关系两 owner）
   *   → Prisma 抛 **P2002**，由 `mapPrismaError` 映射成人话（→ §7.5）。
   */
  createMember(data: CreateMemberData, tx?: RelationTxClient) {
    const client = tx ?? this.prisma;
    return client.relationMember.create({
      data: {
        relation_id: data.relation_id,
        employee_id: data.employee_id,
        member_type: data.member_type,
        added_by: data.added_by,
        added_at: new Date(),
        ...(data.source === undefined ? {} : { source: data.source }),
        ...(data.valid_until === undefined ? {} : { valid_until: data.valid_until }),
      },
    });
  }

  // ===== 读（详情 / 唯一键预检）=====

  /** 按主键取**未删除**的关系（**含**被并分支：详情要能打开它，展示层当分支呈现） */
  findRelationById(id: bigint) {
    return this.prisma.businessRelation.findFirst({
      where: { id, deleted_at: null },
      select: RELATION_SELECT,
    });
  }

  /**
   * 按主键批量取「关系 → 公司」指针（D 域「今日动线」要 `relation:{id,name}`，→ 接口 §5.7）。
   *
   * ★ 只 select 两列：跨域出口只该给出**调用方要的那点信息**，
   *   不让外部顺着出口把整行读走（要更多数据请走 `RelationService` 的语义化出口）。
   */
  findRelationRefsByIds(ids: readonly bigint[]) {
    return this.prisma.businessRelation.findMany({
      where: { id: { in: [...ids] }, deleted_at: null },
      select: { id: true, company_id: true },
    });
  }

  /**
   * 活跃唯一键**预检**：同 公司 × 部门 × 产品线 是否已有**活跃**（私海且未并）的关系。
   *
   * ★ 为什么不用 `active_key` 直接查：该列在 Prisma schema 里是 `@ignore`（生成列**不可写**），
   *   查它就得退回 `$queryRaw`。而 `active_key` 的表达式本身就是
   *   「`sea_status='private' AND merged_into IS NULL` ? 三元组 : NULL」——
   *   用等价的普通条件表达，语义**完全一致**且能被 Prisma 类型系统保护；
   *   真并发下漏过预检的那一条，由 DB 的 `uk_active_rel` 兜底（→ 本域 service 两条都要）。
   */
  findActiveRelation(triple: RelationTriple) {
    return this.prisma.businessRelation.findFirst({
      where: {
        company_id: triple.companyId,
        dept_id: triple.deptId,
        product_line_id: triple.productLineId,
        sea_status: PRIVATE_SEA_STATUS,
        merged_into: null,
        deleted_at: null,
      },
      select: RELATION_SELECT,
    });
  }

  /** 是否已有该成员（**含已撤销**：重复授予要给人话，不能等 DB 的 `uk_member` 报 409 兜底） */
  findMember(input: { relation_id: bigint; employee_id: bigint; member_type: string }) {
    return this.prisma.relationMember.findFirst({
      where: {
        relation_id: input.relation_id,
        employee_id: input.employee_id,
        member_type: input.member_type,
      },
      select: { id: true, revoked_at: true },
    });
  }

  // ===== M7-01 公海「领取到私海」（→ 接口 §4.5 `POST /sea/company/:id/claim`；D-33）=====

  /**
   * 找「公司 × 部门 × 产品线」下的**公海**关系（＝认领目标）。
   *
   * ★ 为什么可能不止一行、要**排序取一条**：同三元组的关系掉海后本部门又新建了一条
   *   （`uk_active_rel` 只在 `private` 时占位，故两条能并存）⇒ 残留多行。按 `updated_at`
   *   倒序取**最近动过**的一条（掉海 / 改属性都会更新它）。
   * ⚠ **不查 `sea_record`** 去取"最近掉海"：那是 **F 域的表**，同层禁依赖（架构 §3 / §5.2）。
   */
  findCompanySeaRelation(triple: RelationTriple) {
    return this.prisma.businessRelation.findFirst({
      where: {
        company_id: triple.companyId,
        dept_id: triple.deptId,
        product_line_id: triple.productLineId,
        sea_status: COMPANY_SEA_STATUS,
        merged_into: null,
        deleted_at: null,
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      select: RELATION_SELECT,
    });
  }

  /**
   * ★ **原子认领**（→ 数据架构 §10.2-3）：条件 UPDATE，调用方按 `count === 1` 判"抢到了"。
   *
   * ★ 同一句 UPDATE 顺带把 **`stage_id` 置回 1**（重新领取＝新一轮从阶段 1 开始，→ 需求 §8.1）：
   *   两件事必须**同一条语句**——拆成两条就会出现"抢到了但阶段没重置"的半截状态，
   *   而阶段又是并发下的共享状态（另一人抢到后立刻推进阶段时更明显）。
   */
  claimSeaRelation(
    relationId: bigint,
    data: { employeeId: bigint; stageId: number },
    tx?: RelationTxClient,
  ) {
    const client = tx ?? this.prisma;
    return client.businessRelation.updateMany({
      where: {
        id: relationId,
        sea_status: COMPANY_SEA_STATUS,
        deleted_at: null,
        merged_into: null,
      },
      data: {
        sea_status: PRIVATE_SEA_STATUS,
        stage_id: data.stageId,
        updated_by: data.employeeId,
      },
    });
  }

  /** 撤销该关系**在位**的 owner 成员（认领前清位：掉海任务未建，公海里可能残留在位 owner 行） */
  revokeActiveOwner(relationId: bigint, by: bigint, tx?: RelationTxClient) {
    const client = tx ?? this.prisma;
    return client.relationMember.updateMany({
      where: {
        relation_id: relationId,
        member_type: OWNER_MEMBER_TYPE,
        revoked_at: null,
      },
      data: { revoked_at: new Date(), revoked_by: by },
    });
  }

  /**
   * 复活一条**已撤销**的成员行。
   * ★ `uk_member(relation_id, employee_id, member_type)` **不含 `revoked_at`** ⇒ 同一人同类型
   *   永远只有一行：曾当过该关系 owner 的人**再领回**时，不能 INSERT（撞唯一键），只能复活。
   */
  reviveMember(memberId: bigint, data: { added_by: bigint; added_at: Date }, tx?: RelationTxClient) {
    const client = tx ?? this.prisma;
    return client.relationMember.update({
      where: { id: memberId },
      data: {
        revoked_at: null,
        revoked_by: null,
        added_at: data.added_at,
        added_by: data.added_by,
      },
    });
  }

  /**
   * 阶段推进留痕（→ C3 `relation_stage_log`）。
   * ★ 本轮**重新领取导致的"回到阶段 1"也走本表**：`action='normal'`（不是 rollback ——
   *   它不是"阶段往后退"，而是新一轮的正常起点）、`reason` 留 `null`（**不新造 reason 码**）。
   */
  createStageLog(
    data: {
      relation_id: bigint;
      from_stage: number | null;
      to_stage: number;
      action: string;
      reason: string | null;
      operator_id: bigint;
    },
    tx?: RelationTxClient,
  ) {
    const client = tx ?? this.prisma;
    return client.relationStageLog.create({ data });
  }

  // ===== M3-07 私海列表（三种范围，方法名即范围）=====
  //
  // ★ **M6-07 起带分页**（→ 接口 §2.7）：五个列表方法都收 `Pagination`、都返回 `{ rows, total }`。
  //   · `total` ＝ 同一个 `where` 的**全量条数**（前端「共 N 条」，→ 设计规范 §4.3）——
  //     故筛选条件抽成私有 `*Where()`，**findMany 与 count 共用一份**；两处各写一遍
  //     ＝「改一处漏一处」（本项目一号坑）。
  //   · 取页与计数包在**本域只读事务**里（§5.2 ③ 只禁跨域大事务）：否则 `total` 与 `rows`
  //     可能来自两个瞬间，并发新建时会出现「共 21 条」却翻不到第 2 页的自相矛盾数字。
  //   · 排序恒 `id desc`（新建的在前）：§2.7 的 `order_by` / `desc` 属后续（→ 交接说明 §三 欠账）。

  /** 私海 · **我参与**（`self` 档：我 owner ∪ 我**有效**协同）的筛选条件 */
  private privateSeaWhereOfEmployee(
    employeeId: bigint,
    now: Date,
  ): Prisma.BusinessRelationWhereInput {
    return {
      deleted_at: null,
      merged_into: null,
      sea_status: PRIVATE_SEA_STATUS,
      members: {
        some: {
          employee_id: employeeId,
          revoked_at: null,
          OR: [
            { member_type: OWNER_MEMBER_TYPE },
            {
              member_type: COLLABORATOR_MEMBER_TYPE,
              OR: [{ valid_until: null }, { valid_until: { gt: now } }],
            },
          ],
        },
      },
    };
  }

  /** 私海 · **这些部门的**（`dept` 档：经理＝管辖部门）条件 */
  private privateSeaWhereOfDepts(deptIds: readonly bigint[]): Prisma.BusinessRelationWhereInput {
    return {
      deleted_at: null,
      merged_into: null,
      sea_status: PRIVATE_SEA_STATUS,
      dept_id: { in: [...deptIds] },
    };
  }

  /** 私海 · **全部**（`all` 档：总经理 / 管理员；管理员只读在 service 层拦）条件 */
  private privateSeaWhere(): Prisma.BusinessRelationWhereInput {
    return { deleted_at: null, merged_into: null, sea_status: PRIVATE_SEA_STATUS };
  }

  /** 公海 · **这些部门的**条件（→ C1：部门公海＝`company_sea` 中 `dept_id`=本部门的关系集合） */
  private companySeaWhereOfDepts(deptIds: readonly bigint[]): Prisma.BusinessRelationWhereInput {
    return {
      deleted_at: null,
      merged_into: null,
      sea_status: COMPANY_SEA_STATUS,
      dept_id: { in: [...deptIds] },
    };
  }

  /** 公海 · **全部**条件 */
  private companySeaWhere(): Prisma.BusinessRelationWhereInput {
    return { deleted_at: null, merged_into: null, sea_status: COMPANY_SEA_STATUS };
  }

  /**
   * 筛选条件（视图 / 紧迫档）→ Prisma `where` 片段。
   * ★ **翻译只在这一处**：上游 `domain/relation-list-filter.ts` 给的是**纯数据**
   *   （要按哪些阶段 / 哪些紧迫档过滤），到这里才落成表列名 —— domain 不许碰 Prisma，
   *   repository 才是那一层（架构 §5.4）。
   */
  private filterWhere(filter: RelationListFilter): Prisma.BusinessRelationWhereInput {
    return {
      ...(filter.stages === undefined ? {} : { stage_id: { in: [...filter.stages] } }),
      ...(filter.urgencies === undefined ? {} : { urgency: { in: [...filter.urgencies] } }),
    };
  }

  /**
   * 一个范围条件 ＋ 筛选 ＋ 分页 → `{ rows, total }`（五个列表方法共用，避免同一段事务抄五遍）。
   * ★ `total` 必须与 `rows` 用**同一个复合条件**（范围 ∩ 筛选）：否则筛出 3 条却显示「共 20 条」，
   *   翻页还会翻出空页 —— 假数字比没数字更坏（→ 铁律坑 16 同类）。
   */
  private async pageOf(
    scopeWhere: Prisma.BusinessRelationWhereInput,
    filter: RelationListFilter,
    pagination: Pagination,
  ) {
    const where: Prisma.BusinessRelationWhereInput = {
      ...scopeWhere,
      ...this.filterWhere(filter),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessRelation.findMany({
        where,
        select: RELATION_SELECT,
        orderBy: { id: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.businessRelation.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * 私海 · **我参与**（`self` 档：我 owner ∪ 我**有效**协同）。
   *
   * ★ `now` 由调用方传入（不在 SQL 里写 `NOW()`）：口径要与
   *   `domain/relation-owner.ts` 的 `isEffectiveCollaborator` **同一个时刻**，
   *   否则「列表里有它、点进去说没权限」这种自相矛盾迟早发生；传参也让单测可控。
   */
  listPrivateRelationsOfEmployee(
    employeeId: bigint,
    now: Date,
    filter: RelationListFilter,
    pagination: Pagination,
  ) {
    return this.pageOf(this.privateSeaWhereOfEmployee(employeeId, now), filter, pagination);
  }

  /** 私海 · **这些部门的**（`dept` 档：经理＝管辖部门） */
  listPrivateRelationsOfDepts(
    deptIds: readonly bigint[],
    filter: RelationListFilter,
    pagination: Pagination,
  ) {
    return this.pageOf(this.privateSeaWhereOfDepts(deptIds), filter, pagination);
  }

  /** 私海 · **全部**（`all` 档：总经理 / 管理员；管理员只读在 service 层拦） */
  listPrivateRelations(filter: RelationListFilter, pagination: Pagination) {
    return this.pageOf(this.privateSeaWhere(), filter, pagination);
  }

  // ===== M3-08 公海列表（同上三种范围）=====

  /** 公海 · **这些部门的**（→ C1：部门公海＝`company_sea` 中 `dept_id`=本部门的关系集合） */
  listSeaRelationsOfDepts(
    deptIds: readonly bigint[],
    filter: RelationListFilter,
    pagination: Pagination,
  ) {
    return this.pageOf(this.companySeaWhereOfDepts(deptIds), filter, pagination);
  }

  /** 公海 · **全部** */
  listSeaRelations(filter: RelationListFilter, pagination: Pagination) {
    return this.pageOf(this.companySeaWhere(), filter, pagination);
  }

  // ===== M3-10 改属性 =====

  /** 改关系属性（**只改给的列**；`updated_by` 由 service 带） */
  updateRelation(id: bigint, data: UpdateRelationData) {
    return this.prisma.businessRelation.update({
      where: { id },
      data: {
        updated_by: data.updated_by,
        ...(data.urgency === undefined ? {} : { urgency: data.urgency }),
        ...(data.value_tier === undefined ? {} : { value_tier: data.value_tier }),
        ...(data.next_action_hint === undefined ? {} : { next_action_hint: data.next_action_hint }),
        ...(data.competition === undefined ? {} : { competition: data.competition }),
        ...(data.competitor_id === undefined ? {} : { competitor_id: data.competitor_id }),
      },
      select: RELATION_SELECT,
    });
  }

  /**
   * 回写「最近一次**有效沟通**时间」（→ C1 `last_event_at`；**M4-07 由 D 域触发**）。
   *
   * ★ 为什么单独一个方法（而不是复用 `updateRelation`）：
   *   ① 调用方是 **D 域**（`EngineService`），它要的是「把时间改掉」，
   *      `last_event_at` **不在** `UpdateRelationData` 的白名单里（销售**不能手改**这个字段）；
   *   ② 本域其它动作（领取 / 转交）将来也可能要改它，收在本域仓储里最省事。
   * ⚠ **不写 `updated_at` 之外的审计**：`updated_at` 由 Prisma `@updatedAt` 自动维护；
   *   `updated_by` **不动**（回写人是系统行为，不是某个员工主动改的，写了会污染审计）。
   */
  updateLastEventAt(id: bigint, eventAt: Date) {
    return this.prisma.businessRelation.update({
      where: { id },
      data: { last_event_at: eventAt },
      select: { id: true, last_event_at: true },
    });
  }

  /**
   * 竞品是否在名册里（C7 `competitor`）—— 关系上的 `competitor_id` 是外键，先查再写免得 FK 报 500。
   * ⚠ C7 **没有 `deleted_at` 列**（竞品名册是「轻量主数据」，停用走 `status`）——
   *   别照其它表的习惯加 `deleted_at: null`，Prisma 会直接编译不过。
   */
  findCompetitorById(id: bigint) {
    return this.prisma.competitor.findFirst({
      where: { id },
      select: { id: true, name: true },
    });
  }
}

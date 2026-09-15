// =============================================================================
// C 域仓储（M3-02 / M3-03 / M3-07 / M3-08）
//
// 分层约束（架构 §5.4）：**本文件是全项目「唯一允许 import Prisma 干活的层」**
//   —— 只查 / 写库，**不写业务判断**（唯一键格式在 `domain/relation-active-key.ts`、
//   范围判定在 `domain/relation-scope.ts`、owner 判定在 `domain/relation-owner.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》V1.31 C1（`business_relation`）/
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
import { PrismaService } from '../../prisma/prisma.service';
import {
  COMPANY_SEA_STATUS,
  PRIVATE_SEA_STATUS,
  type RelationTriple,
} from './domain/relation-active-key';
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

  // ===== M3-07 私海列表（三种范围，方法名即范围）=====

  /**
   * 私海 · **我参与**（`self` 档：我 owner ∪ 我**有效**协同）。
   *
   * ★ `now` 由调用方传入（不在 SQL 里写 `NOW()`）：口径要与
   *   `domain/relation-owner.ts` 的 `isEffectiveCollaborator` **同一个时刻**，
   *   否则「列表里有它、点进去说没权限」这种自相矛盾迟早发生；传参也让单测可控。
   */
  listPrivateRelationsOfEmployee(employeeId: bigint, now: Date, limit: number) {
    return this.prisma.businessRelation.findMany({
      where: {
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
      },
      select: RELATION_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  /** 私海 · **这些部门的**（`dept` 档：经理＝管辖部门） */
  listPrivateRelationsOfDepts(deptIds: readonly bigint[], limit: number) {
    return this.prisma.businessRelation.findMany({
      where: {
        deleted_at: null,
        merged_into: null,
        sea_status: PRIVATE_SEA_STATUS,
        dept_id: { in: [...deptIds] },
      },
      select: RELATION_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  /** 私海 · **全部**（`all` 档：总经理 / 管理员；管理员只读在 service 层拦） */
  listPrivateRelations(limit: number) {
    return this.prisma.businessRelation.findMany({
      where: { deleted_at: null, merged_into: null, sea_status: PRIVATE_SEA_STATUS },
      select: RELATION_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  // ===== M3-08 公海列表（同上三种范围）=====

  /** 公海 · **这些部门的**（→ C1：部门公海＝`company_sea` 中 `dept_id`=本部门的关系集合） */
  listSeaRelationsOfDepts(deptIds: readonly bigint[], limit: number) {
    return this.prisma.businessRelation.findMany({
      where: {
        deleted_at: null,
        merged_into: null,
        sea_status: COMPANY_SEA_STATUS,
        dept_id: { in: [...deptIds] },
      },
      select: RELATION_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  /** 公海 · **全部** */
  listSeaRelations(limit: number) {
    return this.prisma.businessRelation.findMany({
      where: { deleted_at: null, merged_into: null, sea_status: COMPANY_SEA_STATUS },
      select: RELATION_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
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

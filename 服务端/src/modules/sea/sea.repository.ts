// =============================================================================
// F 域仓储（F-01 公海「领取到私海」）—— **只碰本域的表**（`sea_record`）
//
// 分层约束（架构 §5.4）：本文件是本域「唯一允许 import Prisma 干活的层」——
//   只读写库、**不写业务判断**（权限 / 定位 / 原子性全在 C 域出口与 C 域 domain）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》F2（`sea_record`）：`claimed_by` / `claimed_at` ＝「谁 / 何时领回」；
//     索引 `idx_rel_time(relation_id, dropped_at)` 就是「取该关系最近一条入公海记录」的取法。
//   · 《销售CRM架构设计说明》§5.2 跨域三条路：认领要动的三张表
//     （`business_relation` / `relation_member` / `relation_stage_log`）**全是 C 域的表** ——
//     故本域**只写 `sea_record`**，认领本体一律调 C 域 exports 的 service，
//     **不许**直接 UPDATE 别人的表（跨域直连仓储被 ESLint 硬卡）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPANY_SEA_STATUS, PRIVATE_SEA_STATUS } from '../relation/domain/relation-active-key';
import { SEA_RULE_LEVEL, SEA_RULE_STATUS } from './domain/sea-rule';
import type { SeaRuleLike } from './domain/sea-warning';

@Injectable()
export class SeaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 该关系**最近一条**入公海历史（→ F2 `idx_rel_time`）。
   *
   * ★ 为什么要排序取一条：同一条关系会「掉海 → 领回 → 再掉海」，历史行有多条，
   *   而「本次领回」要回填的是**本轮**那条 ⇒ 按 `dropped_at` 倒序；
   *   时间列是**秒精度**（`DateTime(0)`），同一秒的两行靠 `id` 倒序定序（同 C 域取法）。
   *
   * ★ 返回 `null` ＝ **从来没掉过海**：调用方**跳过、不造行** —— 掉海扫描属 M7 后续片，
   *   现在补一条「假装掉过海」的记录＝**凭实现倒推业务事实**（本项目一号坑的变体）。
   */
  findLatestRecord(relationId: bigint): Promise<{ id: bigint; ownerId: bigint } | null> {
    return this.prisma.seaRecord
      .findFirst({
        where: { relation_id: relationId },
        orderBy: [{ dropped_at: 'desc' }, { id: 'desc' }],
        select: { id: true, owner_id: true },
      })
      .then((row) => (row === null ? null : { id: row.id, ownerId: row.owner_id }));
  }

  /** 回填「谁 / 何时领回」（→ F2 `claimed_by` / `claimed_at`；`idx_claimer` 供领取率 / 公海报表用） */
  markClaimed(recordId: bigint, data: { claimedBy: bigint; claimedAt: Date }) {
    return this.prisma.seaRecord.update({
      where: { id: recordId },
      data: { claimed_by: data.claimedBy, claimed_at: data.claimedAt },
      select: { id: true, claimed_at: true },
    });
  }

  // ===== M9-F 真掉海：写本域历史（→ F2 `sea_record`）=====

  /**
   * 写一行**入公海历史** —— "掉海"这件事在 **F 域**的唯一业务记录（→ F2）。
   *
   * ★ 为什么这行归 F 域：`sea_record` 是本域的表（同 `markClaimed`）；
   *   关系本体 / owner 成员是 **C 域**的表，由 C 域出口自己改（架构 §5.2 跨域三条路）。
   * ★ `from_sea` / `to_sea` 取的是 `sea_status` 的值域 —— 常量**复用 C 域 domain**
   *   （`relation-active-key.ts`）：那是 `sea_status` 语义的唯一落点；在 F 域再抄一遍字符串，
   *   早晚会漂成两套（→ 本项目一号坑「同一事实两个落点」）。
   * ★ `owner_id` ＝ **本次掉海时该关系的归属人快照**（F2 逐字；支撑历史轮次 / 前主人归组）
   *   —— 由调用方从 C 域掉海出口拿（那边是**事务内**取的在位 owner），**不是本层猜的**。
   * ★ `claimed_by` / `claimed_at` **留空**：这是"掉进公海"，还没人领回；
   *   将来领取时由 `markClaimed` 回填（→ F-01）。
   */
  createSeaRecord(data: {
    relationId: bigint;
    ownerId: bigint;
    reason: string;
    droppedAt: Date;
    /** 转移方向（默认 私海→公海）；经理删除关系时填 `company_sea`→`company_sea` */
    fromSea?: string;
    toSea?: string;
  }) {
    return this.prisma.seaRecord.create({
      data: {
        relation_id: data.relationId,
        owner_id: data.ownerId,
        from_sea: data.fromSea ?? PRIVATE_SEA_STATUS,
        to_sea: data.toSea ?? COMPANY_SEA_STATUS,
        reason: data.reason,
        dropped_at: data.droppedAt,
      },
      select: { id: true },
    });
  }

  // ===== M9-F 规则配置（→ 接口 §4.14.10 / §5.16；F1 `sea_rule`）=====

  /**
   * 读**配置页要看的**规则行（→ 接口 §4.14.10）：`status='active'` 的**全部**行。
   *
   * ★ 与 `listActiveSeaRules`（扫描用）的两点差别，别混用：
   *   ① **不按 `effective_from` 过滤** —— 7 天缓冲期内"还没生效但要给经理看"的新版本行
   *      也是 `active`（F1：停用的是**旧**行），漏了它经理就看不到自己刚提交的变更；
   *   ② 出**整行**（四个天数都要展示 / 回填），不是扫描只要的"算倒计时那几列"。
   *
   * ★ 可见范围在**本层**才落地（`deptIds` 由 service 按角色算出来，`domain/**` 只管判角色）：
   *   `null` ＝ 不收敛（老板 / 管理员）；给集合 ＝ **L1 / L2 一律可见**（上级兜底，看不到就解释不了
   *   "我这个部门到底按几天算"）**＋** 这些部门的 L3 / L4。
   *   ⚠ `deptIds` 不给默认值：`null`（全看）与 `[]`（一个部门都不可见）是两件事。
   */
  listActiveRulesForConfig(deptIds: readonly bigint[] | null) {
    return this.prisma.seaRule.findMany({
      where: {
        status: SEA_RULE_STATUS.active,
        ...(deptIds === null
          ? {}
          : {
              OR: [
                { level: { in: [SEA_RULE_LEVEL.global, SEA_RULE_LEVEL.productLine] } },
                { dept_id: { in: [...deptIds] } },
              ],
            }),
      },
      select: {
        id: true,
        level: true,
        dept_id: true,
        product_line_id: true,
        follow_freq_days: true,
        deal_cycle_days: true,
        stay_days: true,
        no_progress_max: true,
        effective_from: true,
        status: true,
      },
      orderBy: [{ level: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * **插新版本行 ＋ 旧行 `status=disabled`**（→ F1「停用不删」；接口 §4.14.10 逐字）。
   *
   * ★ 两件事必须**同生共死**（同位置的"唯一 active 行"这条不变量）：只插不停 ⇒ 同位置两行
   *   `active`，命中解析取到哪条全看排序（＝规则口径随机漂移，最阴的一类 bug）；
   *   只停不插 ⇒ 那层规则凭空消失、部门掉回上级兜底。故走**本域事务**（§5.2 路之③ 允许本域事务）。
   * ★ 「同位置」的判据是 **(level, dept_id, product_line_id)** —— 与 `domain/sea-rule.ts`
   *   的 `isSameRuleSlot` 同一个口径（那边判逻辑、这边落 SQL 条件，两处逐字对应）。
   * ★ `effective_from` 由调用方算好传进来（＝提交日 + 7 天），**本层不读钟** ——
   *   与"任务时刻由调用方传入"同一条纪律：时间口径只有一处。
   */
  replaceRuleVersion(input: {
    level: number;
    deptId: bigint | null;
    productLineId: bigint | null;
    followFreqDays: number | null;
    dealCycleDays: number | null;
    stayDays: number | null;
    noProgressMax: number | null;
    effectiveFrom: Date;
    operatorId: bigint;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.seaRule.updateMany({
        where: {
          level: input.level,
          dept_id: input.deptId,
          product_line_id: input.productLineId,
          status: SEA_RULE_STATUS.active,
        },
        data: { status: SEA_RULE_STATUS.disabled, updated_by: input.operatorId },
      });

      return tx.seaRule.create({
        data: {
          level: input.level,
          dept_id: input.deptId,
          product_line_id: input.productLineId,
          follow_freq_days: input.followFreqDays,
          deal_cycle_days: input.dealCycleDays,
          stay_days: input.stayDays,
          no_progress_max: input.noProgressMax,
          effective_from: input.effectiveFrom,
          status: SEA_RULE_STATUS.active,
          created_by: input.operatorId,
        },
        select: {
          id: true,
          level: true,
          dept_id: true,
          product_line_id: true,
          follow_freq_days: true,
          deal_cycle_days: true,
          stay_days: true,
          no_progress_max: true,
          effective_from: true,
          status: true,
        },
      });
    });
  }

  // ===== 读掉海规则（M7-03；★ 本域写口共三处：`markClaimed` / `createSeaRecord` / `replaceRuleVersion`）=====

  /**
   * 读**生效中**的公海规则（→ F1 `sea_rule`；走 `idx_level(level, dept_id, product_line_id, status)`）。
   *
   * ★ 为什么 `status='active'` ＋ `effective_from <= now` 两个条件都写在 SQL 里：
   *   前者是"停用不删"的版本管理（F1：改天数＝插新行 ＋ 旧行 `status=disabled`）；
   *   后者是 **7 天缓冲**（新行 `effective_from = 提交日 + 7 天`）—— **没生效的行不该出现在候选里**，
   *   否则"哪些规则算数"这件事就漏到了应用层去猜（本域 domain 只做**层级命中**判定，不判生效与否）。
   *
   * ★ `orderBy` 取 `level desc, id desc`：同层多行（历史版本 / 手工脏数据）时**新的优先**；
   *   真正的"取哪一条"仍由 `domain/sea-warning.ts` 的 `resolveSeaRuleFor` 决定（口径只有一处）。
   *
   * ★ 只 select 用得到的列：往 domain 纯函数递的一律是"算倒计时那几列"。
   * ★ 出参在**本层**转成 `SeaRuleLike`（snake_case → 驼峰）：DB 列名是**本层的事**，
   *   `domain/**` 不该认识 `follow_freq_days` 这种列名（它要能拿假数据单测）。
   */
  async listActiveSeaRules(now: Date): Promise<SeaRuleLike[]> {
    const rows = await this.prisma.seaRule.findMany({
      where: { status: 'active', effective_from: { lte: now } },
      select: {
        id: true,
        level: true,
        dept_id: true,
        product_line_id: true,
        follow_freq_days: true,
        effective_from: true,
      },
      orderBy: [{ level: 'desc' }, { id: 'desc' }],
    });

    return rows.map((row) => ({
      level: row.level,
      deptId: row.dept_id,
      productLineId: row.product_line_id,
      followFreqDays: row.follow_freq_days,
      effectiveFrom: row.effective_from,
    }));
  }

  // ===== M8-06 Phase 4 切片③：经理待办（公海停留超期 → 经理决策）=====

  /**
   * 取「在公海（company_sea）且属于可见部门」的关系，及其**最近一次入海时刻**
   * （＝ `sea_record` 最近一条 `dropped_at`，`idx_rel_time`；无历史行的关系不在此列）。
   *
   * ★ 名称一次 join 带出（company / department / product_line），省一次往返；
   *   名字取不到（档案被逻辑删）→ `null`，由 service 决定回 `null` 引用。
   * ★ 范围收敛在**本层**：`deptIds === null` ＝ 不收敛（老板 / 管理员）；
   *   给集合 ＝ 经理管辖部门（与 `listActiveRulesForConfig` 同一档）。
   */
  async listSeaManagerTodo(deptIds: readonly bigint[] | null): Promise<SeaManagerTodoRow[]> {
    const scopeFilter: Prisma.Sql[] = [
      Prisma.sql`br.sea_status = 'company_sea'`,
      Prisma.sql`br.deleted_at IS NULL`,
    ];
    if (deptIds !== null) {
      scopeFilter.push(
        Prisma.sql`br.dept_id IN (${Prisma.join(
          deptIds.map((id) => Prisma.sql`${id}`),
          ', ',
        )})`,
      );
    }
    const whereSql = Prisma.join(scopeFilter, ' AND ');

    return this.prisma.$queryRaw<SeaManagerTodoRow[]>`
      SELECT
        br.id AS relation_id,
        br.company_id AS company_id,
        c.full_name AS company_name,
        br.dept_id AS dept_id,
        d.name AS dept_name,
        br.product_line_id AS product_line_id,
        pl.name AS product_line_name,
        MAX(sr.dropped_at) AS sea_entered_at
      FROM business_relation br
      INNER JOIN (
        SELECT relation_id, MAX(dropped_at) AS dropped_at
        FROM sea_record
        GROUP BY relation_id
      ) sr ON sr.relation_id = br.id
      LEFT JOIN company c ON c.id = br.company_id
      LEFT JOIN department d ON d.id = br.dept_id
      LEFT JOIN product_line pl ON pl.id = br.product_line_id
      WHERE ${whereSql}
      GROUP BY br.id, br.company_id, c.full_name, br.dept_id, d.name, br.product_line_id, pl.name
    `;
  }

  /**
   * 批量取一批关系**最近一条入公海记录**（→ `GET /sea/company` · `/sea/department` 卡片的
   * 「进入时间 / 进入原因」；Phase 6）。
   *
   * ★ 复用 `listSeaManagerTodo` 的 join 思路：本域 `sea_record` 与 C 域 `business_relation`
   *   同一句 raw 里取（那条查询已经这么干了 —— 跨域只读聚合在仓储层是本项目已接受的落点）。
   * ★ 只取「在公海（`company_sea`）且未删」的关系；窗口函数 `ROW_NUMBER` 按
   *   `dropped_at desc, id desc` 取每个关系最新一条（同秒靠 id 定序，与 C 域取法一致）。
   * ★ 同时带出 `dept_id` / `product_line_id`：卡片的「剩余 X 天」要按部门 / 产品线解析
   *   `stay_days`（→ `SeaService.listSeaStayInfo`），省一次往返。
   */
  async listLatestSeaRecords(relationIds: readonly bigint[]): Promise<SeaRecordSummaryRow[]> {
    if (relationIds.length === 0) return [];
    const ids = [...new Set(relationIds)];
    return this.prisma.$queryRaw<SeaRecordSummaryRow[]>`
      SELECT x.relation_id, x.dept_id, x.product_line_id, x.sea_entered_at, x.reason
      FROM (
        SELECT
          br.id AS relation_id,
          br.dept_id AS dept_id,
          br.product_line_id AS product_line_id,
          sr.dropped_at AS sea_entered_at,
          sr.reason AS reason,
          ROW_NUMBER() OVER (
            PARTITION BY br.id ORDER BY sr.dropped_at DESC, sr.id DESC
          ) AS rn
        FROM business_relation br
        INNER JOIN sea_record sr
          ON sr.relation_id = br.id
        WHERE br.deleted_at IS NULL
          AND br.sea_status = 'company_sea'
          AND br.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`), ', ')})
      ) x
      WHERE x.rn = 1
    `;
  }

  /**
   * 掉海记录列表（→ 接口 §5.16 `GET /sea/records`）。
   *
   * ★ 范围收敛在**本层**：`deptIds === null` ＝ 不收敛（老板 / 管理员）；给集合 ＝ 经理管辖部门（与
   *   `listSeaManagerTodo` 同一档）。按 `business_relation.dept_id` 收敛（部门恒定，→ C1）。
   * ★ 一条关系可能多次掉海（多条 `sea_record`），本列表**逐条列出**（不按关系去重）；
   *   排序按 `dropped_at` 倒序（最新掉海的在前）；分页。
   * ★ 名字一次 join 带出（company / department / product_line），省往返；名字取不到 → `null`，由 service 装配。
   * ★ `claimed_by` 是员工 id，名字由 service 走 `OrgService.getEmployeeRefs` 装配（跨域不许查表）。
   */
  async listSeaRecords(
    deptIds: readonly bigint[] | null,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; rows: SeaRecordListItemRow[] }> {
    const whereSql = this.seaRecordScopeFilter(deptIds);
    const rows = await this.prisma.$queryRaw<SeaRecordListItemRow[]>`
      SELECT
        sr.id AS record_id,
        sr.relation_id AS relation_id,
        sr.reason AS reason,
        sr.dropped_at AS dropped_at,
        sr.claimed_by AS claimed_by,
        sr.claimed_at AS claimed_at,
        br.company_id AS company_id,
        c.full_name AS company_name,
        br.dept_id AS dept_id,
        d.name AS dept_name,
        br.product_line_id AS product_line_id,
        pl.name AS product_line_name
      FROM sea_record sr
      INNER JOIN business_relation br ON br.id = sr.relation_id AND br.deleted_at IS NULL
      LEFT JOIN company c ON c.id = br.company_id
      LEFT JOIN department d ON d.id = br.dept_id
      LEFT JOIN product_line pl ON pl.id = br.product_line_id
      WHERE ${whereSql}
      ORDER BY sr.dropped_at DESC, sr.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM sea_record sr
      INNER JOIN business_relation br ON br.id = sr.relation_id AND br.deleted_at IS NULL
      WHERE ${whereSql}
    `;
    return { total: Number(total), rows };
  }

  /** 掉海记录列表的范围条件（`deptIds === null` ＝ 不收敛） */
  private seaRecordScopeFilter(deptIds: readonly bigint[] | null): Prisma.Sql {
    if (deptIds === null) return Prisma.sql`1=1`;
    return Prisma.sql`br.dept_id IN (${Prisma.join(
      deptIds.map((id) => Prisma.sql`${id}`),
      ', ',
    )})`;
  }
}

/** 一条经理待办候选（→ `listSeaManagerTodo` 的 raw 行） */
export interface SeaManagerTodoRow {
  relation_id: bigint;
  company_id: bigint;
  company_name: string | null;
  dept_id: bigint;
  dept_name: string | null;
  product_line_id: bigint;
  product_line_name: string | null;
  /** 最近一次入公海时刻（`sea_record.dropped_at` 最大值） */
  sea_entered_at: Date | null;
}

/** 一条关系的「最近入海记录」摘要（→ `listLatestSeaRecords`） */
export interface SeaRecordSummaryRow {
  relation_id: bigint;
  dept_id: bigint;
  product_line_id: bigint;
  /** 最近一次入公海时刻（`sea_record.dropped_at` 最大值） */
  sea_entered_at: Date | null;
  /** 本次掉海原因码（→ 数据架构 F2 `sea_record.reason` 值域）；从未掉海 → `null` */
  reason: string | null;
}

/** 一条掉海记录原始行（→ `listSeaRecords`） */
export interface SeaRecordListItemRow {
  record_id: bigint;
  relation_id: bigint;
  reason: string;
  dropped_at: Date;
  claimed_by: bigint | null;
  claimed_at: Date | null;
  company_id: bigint;
  company_name: string | null;
  dept_id: bigint;
  dept_name: string | null;
  product_line_id: bigint;
  product_line_name: string | null;
}

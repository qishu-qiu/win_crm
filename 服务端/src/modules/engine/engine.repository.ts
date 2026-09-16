// =============================================================================
// D 域仓储（M4-02 事件写入 / M4-03 承诺建查 / M4-08 时间线取数）
//
// 分层约束（架构 §5.4）：**本文件是本域「唯一允许 import Prisma 干活的层」**
//   —— 只查 / 写库，**不写业务判断**（有效沟通判定在 `domain/event-effective.ts`、
//   回写决策在 `domain/last-event.ts`、幂等键在 `domain/event-idempotency.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》D1（`commitment`）／D2（`action_event`）。
//   · D2：`action_event` **不分区**（故主键即 `id`，`uk_idem` 无需含分区键）；
//     索引 `idx_rel_time(relation_id, event_at)` —— 时间线**倒序**扫描正好命中它；
//     `idx_contact(contact_id, event_at)` 供「待关联公司」按联系人查孤儿跟单（M6 用）。
//   · D2：`relation_id` 与 `contact_id` **至少一非空**（CHECK 约束写在手写 migration 里）——
//     ⚠ DB 会兜底，但**不能等 DB 报错**：service 层先判，给人话。
//   · D1：`commitment` 的 `status` 默认 `open`（DB 默认），`party` ∈ me / them / verdict。
//
// ★ 为什么**不**在这里回写 `business_relation.last_event_at`：那是 **C 域的表**
//   （→ 架构 §5.2 跨域三条路：跨域**禁止直连**，更**禁止跨域大事务**）。
//   本域只写自己的 `action_event`，回写由 service 走 **C 域跨域出口**完成。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** 交互式事务客户端（同 B / C 域：类型上就没有 `$transaction`，防在事务里再开事务） */
export type EngineTxClient = Prisma.TransactionClient;

/** 事件读出的列（→ §5.7 事件项；**不 select 用不到的列**，别图省事 `findMany()` 全取） */
const EVENT_SELECT = {
  id: true,
  relation_id: true,
  contact_id: true,
  actor_id: true,
  owner_snapshot: true,
  action_type: true,
  summary: true,
  outcome: true,
  competition: true,
  competition_note: true,
  duration_min: true,
  mentioned_user_ids: true,
  attachments: true,
  event_at: true,
  created_at: true,
} as const;

/** 承诺读出的列（→ §5.7 承诺项） */
const COMMITMENT_SELECT = {
  id: true,
  relation_id: true,
  contact_id: true,
  owner_id: true,
  party: true,
  ctype: true,
  content: true,
  due_at: true,
  remind_at: true,
  status: true,
  waive_reason: true,
  done_at: true,
  source_event_id: true,
  created_at: true,
} as const;

/**
 * 今日动线里**还该出现**的状态（→ 数据架构 D4：`open` 待办 / `snoozed` 推到今天）。
 * `done` / `ignored` 已处理完，不再推（见 `listAgendaOfUser` 注释 ★）。
 */
const AGENDA_VISIBLE_STATUSES: readonly string[] = ['open', 'snoozed'];

/** 今日动线读出的列（→ §5.7 动线条目；`action_reason` 属 M4-14 之后的处理动作，本批不取） */
const AGENDA_SELECT = {
  id: true,
  ref_type: true,
  ref_id: true,
  relation_id: true,
  contact_id: true,
  reason: true,
  priority: true,
  action_hint: true,
  status: true,
  snooze_count: true,
} as const;

/** 写事件（service 组装好，仓储只管落库） */
export interface CreateEventData {
  relation_id: bigint | null;
  contact_id: bigint | null;
  actor_id: bigint;
  owner_snapshot: bigint | null;
  action_type: string;
  summary: string | null;
  outcome: string | null;
  competition: string | null;
  competitor_id: bigint | null;
  competition_note: string | null;
  duration_min: number | null;
  /**
   * @求助的同事 id 列表。
   * ⚠ **可空列用「不给」表达空、不传 `null`**：Prisma 的可空 `Json` 列不接受裸 `null`
   *   （`null` 在这里有歧义：到底是 SQL NULL 还是 JSON null，故它要求 `Prisma.DbNull` /
   *   `Prisma.JsonNull`）。本列业务上「没 @ 人」＝不写，故**省略该字段**最直接。
   */
  mentioned_user_ids?: number[];
  source: string;
  visit_log_id: bigint | null;
  appointment_id: bigint | null;
  /**
   * 幂等键。
   * ★ **`null` 是合法值**（列可空、`uk_idem` 唯一索引允许多个 NULL）：**批量快速标记**刻意不写它
   *   —— 每次点击都该是一条独立记录（「这个客户打过 N 次」正是这么统计的，→ `quickMark` 方法头 ★③）。
   */
  idempotency_key: string | null;
  event_at: Date;
}

/** 建承诺 */
export interface CreateCommitmentData {
  relation_id: bigint;
  contact_id: bigint | null;
  owner_id: bigint;
  party: string;
  ctype: string;
  content: string;
  due_at: Date | null;
  remind_at: Date | null;
  source_event_id: bigint | null;
  created_by: bigint;
}

/**
 * 改承诺（**只列真会变的字段**）。
 * ★ `status` 只允许流转到 `done` / `cancelled` / `waived`（→ 需求 §10.1 收尾三态）；
 *   流转合法性由 domain 判，本接口不做限制也不给默认值。
 * ★ `waive_reason` 与 `waived` 同写：**「必填」的判定在 domain / service**，仓库层只负责落库。
 */
export interface UpdateCommitmentData {
  status?: string;
  waive_reason?: string | null;
  done_at?: Date | null;
  done_by?: bigint | null;
  due_at?: Date | null;
  remind_at?: Date | null;
  updated_by: bigint;
}

@Injectable()
export class EngineRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===== M4-02 写事件 =====

  /**
   * 插入一条跟单事件。
   *
   * ★ 撞 `uk_idem`（幂等键重复＝重复提交）→ Prisma 抛 **P2002**，由 `mapPrismaError` 映射成人话
   *   （→ §7.5）。⚠ 本批 `mapPrismaError` **尚未登记 `uk_idem`**（走 409 兜底文案），
   *   登记属 M4 文档联动的一部分。
   */
  createEvent(data: CreateEventData, tx?: EngineTxClient) {
    const client = tx ?? this.prisma;
    return client.actionEvent.create({
      data: {
        relation_id: data.relation_id,
        contact_id: data.contact_id,
        actor_id: data.actor_id,
        owner_snapshot: data.owner_snapshot,
        action_type: data.action_type,
        summary: data.summary,
        outcome: data.outcome,
        competition: data.competition,
        competitor_id: data.competitor_id,
        competition_note: data.competition_note,
        duration_min: data.duration_min,
        ...(data.mentioned_user_ids === undefined
          ? {}
          : { mentioned_user_ids: data.mentioned_user_ids }),
        source: data.source,
        visit_log_id: data.visit_log_id,
        appointment_id: data.appointment_id,
        idempotency_key: data.idempotency_key,
        event_at: data.event_at,
      },
      select: EVENT_SELECT,
    });
  }

  /** 按幂等键取已存在的事件（**重复提交时回它**，比抛 409 更友好 —— 但语义仍是「已记过」） */
  findEventByIdempotencyKey(key: string) {
    return this.prisma.actionEvent.findFirst({
      where: { idempotency_key: key },
      select: EVENT_SELECT,
    });
  }

  // ===== M4-08 时间线取数 =====

  /**
   * 某关系的事件时间线（**按 `event_at` 倒序**）。
   *
   * ★ `since` 由调用方传（默认近 1 个月＝接口 §5.7 `range=1m`）：不把「近 1 个月」写死在 SQL 里，
   *   将来可切「全部」（`since = undefined`）；`limit` 是保护（M6 分页前先兜住）。
   * ★ 走 `idx_rel_time(relation_id, event_at)` —— 排序方向与索引一致，不需要 filesort。
   */
  listEventsByRelation(relationId: bigint, since: Date | undefined, limit: number) {
    return this.prisma.actionEvent.findMany({
      where: {
        relation_id: relationId,
        ...(since === undefined ? {} : { event_at: { gte: since } }),
      },
      select: EVENT_SELECT,
      orderBy: { event_at: 'desc' },
      take: limit,
    });
  }

  // ===== M4-03 承诺 建 / 查 =====

  /** 建承诺（**不写 `status`**：走 DB 默认 `open`） */
  createCommitment(data: CreateCommitmentData, tx?: EngineTxClient) {
    const client = tx ?? this.prisma;
    return client.commitment.create({
      data: {
        relation_id: data.relation_id,
        contact_id: data.contact_id,
        owner_id: data.owner_id,
        party: data.party,
        ctype: data.ctype,
        content: data.content,
        due_at: data.due_at,
        remind_at: data.remind_at,
        source_event_id: data.source_event_id,
        created_by: data.created_by,
        updated_by: data.created_by,
      },
      select: COMMITMENT_SELECT,
    });
  }

  /** 某关系的承诺列表（**未完成的在前**：`status` 升序＝ `done` 之前的码排在前面，够用且不猜码顺序） */
  listCommitmentsByRelation(relationId: bigint, limit: number) {
    return this.prisma.commitment.findMany({
      where: { relation_id: relationId },
      select: COMMITMENT_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  // ===== M4-09 承诺：改 =====

  /**
   * 按主键取承诺（**不带任何范围条件**）。
   * ★ 调用方必须自己比对 `relation_id`：入口是 `/relations/:id/commitments`，
   *   不能拿 A 关系的入口去改 B 关系的承诺（那条判断在 service，不在 SQL 里做隐式过滤）。
   */
  findCommitmentById(id: bigint) {
    return this.prisma.commitment.findFirst({ where: { id }, select: COMMITMENT_SELECT });
  }

  /** 改承诺（兑现 / 取消 / 豁免 / 改期）—— 回整行供出参装配 */
  updateCommitment(id: bigint, data: UpdateCommitmentData) {
    return this.prisma.commitment.update({ where: { id }, data, select: COMMITMENT_SELECT });
  }

  // ===== M4-10 今日动线（简版）=====

  /**
   * 某员工某日的动线条目（→ §5.7 `GET /today-agenda`）。
   *
   * ★ **只取 `open` / `snoozed`**：`done` / `ignored` 是**已处理过**的条目
   *   （→ 数据架构 D4「组装方式＝结转 + 新增」：处理状态跨天保留、**不重复推**），
   *   再把它们列进「今天该找谁」就是把已办的事又端上来一遍。
   * ★ 排序＝ `priority` 降序（→ D4 字段说明「为什么今天该找 TA / 优先级 / 建议动作」），
   *   同优先级按 `id` 升序，保证同一份数据每次读出的顺序一致。
   * ⚠ 本批**不实时组装**（组装＝05:00 定时任务，属 M7）：库里没有当日行就返回空数组 ——
   *   前端看到空，不等于「今天没事」，只是「本批还没接组装」（→ 交接说明 §三）。
   */
  listAgendaOfUser(userId: bigint, bizDate: Date, limit: number) {
    return this.prisma.dailyAgenda.findMany({
      where: { user_id: userId, biz_date: bizDate, status: { in: [...AGENDA_VISIBLE_STATUSES] } },
      select: AGENDA_SELECT,
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }
}

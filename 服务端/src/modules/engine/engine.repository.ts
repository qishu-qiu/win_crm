// =============================================================================
// D 域仓储（M4-02 事件写入 / M4-03 承诺建查 / M4-08 时间线取数）
//
// 分层约束（架构 §5.4）：**本文件是本域「唯一允许 import Prisma 干活的层」**
//   —— 只查 / 写库，**不写业务判断**（有效沟通判定在 `domain/event-effective.ts`、
//   回写决策在 `domain/last-event.ts`、幂等键在 `domain/event-idempotency.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》V1.31 D1（`commitment`）／D2（`action_event`）。
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
  done_at: true,
  source_event_id: true,
  created_at: true,
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
  idempotency_key: string;
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
}

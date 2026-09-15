// =============================================================================
// D 域服务（M4-07 写跟单事件 / M4-08 关系时间线）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、跨域取引用），
//   **不写业务规则**（有效沟通 / 回写 / 幂等键全在 `domain/`）、**不写 SQL**（在 `engine.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.17 §5.7（事件项出参、`POST /relations/:id/events` 入参）；
//     §5.6（数据范围）；§2.4（错误码）。
//   · 《销售CRM数据架构文档》V1.31 D2（`action_event`）：快速标记三型**不**回写 `last_event_at`。
//   · 《销售CRM业务需求文档》§10.2：有效沟通**必须写一句话结果**；无效沟通**点一下即可**。
//   · 《销售CRM架构设计说明》V1.3 §5.2 跨域三条路：
//       ① 同步调对方 **exports 的 service** —— 本文件取「关系在不在 / 归谁 / 我能不能写」、
//         以及回写 `last_event_at` 全走 **C 域 `RelationService`** 这一个跨域出口
//         （**禁止**查 C 域的表）；③ 本域多表一致性 → **本域 `$transaction`**。
//
// ★ `last_event_at` 为什么不和事件写进**同一个**事务（与计划 M4-07 字面表述的差别，已登记）：
//   计划行写「**事务**：写事件 + 条件回写 `last_event_at`」，但 `last_event_at` 在
//   `business_relation`（**C 域的表**）—— 架构 §5.2 明令「**不发跨域大事务**」
//   （理由：将来拆服务时跨服务事务要换成最终一致，现在写死就得处处重写）。
//   故本实现＝ ① 本域事务写 `action_event`；② **事务提交后**调 C 域出口回写。
//   ⚠ 架构 §5.3 把这条回写登记为领域事件 `ActionEventRecorded`（D 发 → C 收）；
//     事件总线（M0-29 `EventBus`）**尚未接进 DI**（→ 交接说明 §三 #5），
//     故本批先用跨域路之①（同步调 service，结果可验证、失败可透出），
//     待 M4-11 接事件总线时改为路之②。**两者都不跨域开事务**，差别只在投递方式。
//
// ★ P2002 的处理姿势（与 B / C 域同款，两条都要）：
//   ① **预检**（按幂等键先查一次）→ 覆盖 99% 的「销售手快」，给人话；
//   ② **catch 再映射**（`mapPrismaError` → `uk_idem`）→ 覆盖并发下预检漏过的竞态。
//   两条路径的**文案必须逐字一致**（同源常量 `EVENT_DUPLICATED_MESSAGE`）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import {
  AppError,
  ErrorCode,
  getRequestContext,
  jsonToBigint,
  mapPrismaError,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import { OrgService } from '../org/org.service';
import { RelationService } from '../relation/relation.service';
import { type CreateEventDto } from './dto/engine-request.dto';
import { isSummaryRequired } from './domain/event-effective';
import { buildEventIdempotencyKey } from './domain/event-idempotency';
import { decideLastEventUpdate } from './domain/last-event';
import { EngineRepository, type EngineTxClient } from './engine.repository';

/** 跟单事件出参（→ §5.7；未落地字段见 `dto/engine-response.dto.ts` 文件头清单） */
export interface ActionEventVo {
  id: bigint;
  action_type: string;
  summary: string | null;
  outcome: string | null;
  competition: string | null;
  actor: { id: bigint; name: string } | null;
  /** 本条创建时该关系的归属人（→ D2 `owner_snapshot`） */
  owner_snapshot: { id: bigint; name: string } | null;
  contact: { id: bigint; name: string } | null;
  duration_min: number | null;
  event_at: string;
  branch: 'main' | 'sub';
  attachments: unknown[];
}

/** 时间线范围（→ §5.7：`GET /relations/:id/events` 默认 `range=1m`） */
export type EventRange = '1m' | 'all';

/** 与 `mapPrismaError` 中 `uk_idem` 那条**逐字一致**（预检与兜底两处共用，改一处即两处生效） */
const EVENT_DUPLICATED_MESSAGE = '这条跟单刚刚已经记过了';

/** 「近 1 个月」按 30 天算（→ §5.7 `range=1m`） */
const DEFAULT_RANGE_DAYS = 30;

/** 时间线单次上限（本批无分页；分页属 M6，→ 接口 §2.7） */
const TIMELINE_LIMIT = 200;

@Injectable()
export class EngineService {
  constructor(
    private readonly repository: EngineRepository,
    private readonly relation: RelationService,
    private readonly org: OrgService,
    private readonly company: CompanyService,
    private readonly prisma: PrismaService,
  ) {}

  // ===== M4-07 写跟单事件 =====

  /**
   * 记一条跟单（→ §5.7 `POST /relations/:id/events`）。
   *
   * 顺序＝**先权限、再参数、再幂等、最后落库**：
   *   ① 关系存在 ＋ 我对它**可写**（C 域跨域出口，越权 / 只读角色 → 403）；
   *   ② `contact_id` 存在性（跨域走 B 域出口）＋ `summary` 必填（有效沟通才写字）；
   *   ③ 幂等键预检（重复提交 → 409，与 `uk_idem` 兜底**同一句**人话）；
   *   ④ 本域事务写 `action_event`（**只写本域的表**）；
   *   ⑤ 事务提交后：**仅有效沟通**才回写 `last_event_at`（走 C 域出口，见文件头 ★）。
   */
  async recordEvent(relationId: string, dto: CreateEventDto): Promise<ActionEventVo> {
    const viewer = requireViewer();

    // ① 存在 ＋ 可写（C 域出口：`dept` / `mine` 档都在这一个方法里判完）
    const relation = await this.relation.requireWritableRelation(relationId);

    // ② 联系人存在性（选填：给了就必须存在，不给＝本条不绑具体联系人）
    let contactId: bigint | null = null;
    if (dto.contact_id !== undefined && dto.contact_id !== '') {
      contactId = jsonToBigint(dto.contact_id, 'contact_id');
      const contacts = await this.company.getContactRefs([contactId]);
      if (contacts.length === 0) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：contact_id 指向的联系人不存在', {
          constraint: 'event.contact_missing',
        });
      }
    }

    const outcome = dto.outcome ?? null;
    if (isSummaryRequired(outcome) && (dto.summary ?? '').trim() === '') {
      // 快速标记三型不强制写字（→ 需求 §10.2）；其余一律要一句话结果
      throw new AppError(
        ErrorCode.REQUIRED_MISSING,
        422,
        '有效沟通必须写一句话结果；未接通请点「快速标记」',
        { constraint: 'event.summary_required' },
      );
    }

    // ③ 幂等键：由**内容**决定（不含当前时刻，→ `domain/event-idempotency.ts` 文件头 ★）
    const idempotencyKey = buildEventIdempotencyKey({
      relationId: relation.id,
      contactId,
      actorId: viewer.employeeId,
      actionType: dto.action_type,
      outcome,
      summary: dto.summary ?? null,
      durationMin: dto.duration_min ?? null,
    });

    const duplicated = await this.repository.findEventByIdempotencyKey(idempotencyKey);
    if (duplicated !== null) {
      throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, EVENT_DUPLICATED_MESSAGE, {
        constraint: 'uk_idem',
      });
    }

    const eventAt = new Date();
    const created = await this.prisma
      .$transaction(async (tx) => {
        const client: EngineTxClient = tx;
        return this.repository.createEvent(
          {
            relation_id: relation.id,
            contact_id: contactId,
            actor_id: viewer.employeeId,
            // ★ `owner_snapshot` ＝ **写入那一刻**该关系的 owner（→ D2：按轮次归组用）
            owner_snapshot: relation.ownerId,
            action_type: dto.action_type,
            summary: dto.summary ?? null,
            outcome,
            competition: dto.competition ?? null,
            competitor_id: null,
            competition_note: dto.competition_note ?? null,
            duration_min: dto.duration_min ?? null,
            ...(dto.mentioned_user_ids === undefined
              ? {}
              : { mentioned_user_ids: dto.mentioned_user_ids.map((id) => Number(id)) }),
            source: 'manual',
            visit_log_id: null,
            appointment_id: null,
            idempotency_key: idempotencyKey,
            event_at: eventAt,
          },
          client,
        );
      })
      .catch((error: unknown) => {
        throw mapPrismaError(error) ?? error;
      });

    // ⑤ 仅有效沟通才回写（**事务已提交**；跨域不进同一事务，见文件头 ★）
    const decision = decideLastEventUpdate({ outcome, eventAt: created.event_at });
    if (decision.shouldUpdate && decision.eventAt !== null) {
      await this.relation.touchLastEventAt(relation.id, decision.eventAt);
    }

    return this.buildVo(
      created,
      relation.ownerId,
      await this.loadRefs([created], [relation.ownerId]),
    );
  }

  // ===== M4-08 关系时间线 =====

  /**
   * 关系时间线（→ §5.7 `GET /relations/:id/events`，**按 `event_at` 倒序**）。
   *
   * ★ 可见性走 C 域 `getRelation`（含范围校验）—— 跟单的可见性**继承业务关系权限**
   *   （→ 需求 §10.2），不在 D 域另写一套。
   */
  async listEvents(relationId: string, range: EventRange = '1m'): Promise<ActionEventVo[]> {
    requireViewer();
    const relation = await this.relation.getRelation(relationId);

    const since =
      range === 'all' ? undefined : addDays(new Date(), -DEFAULT_RANGE_DAYS);
    const rows = await this.repository.listEventsByRelation(relation.id, since, TIMELINE_LIMIT);
    if (rows.length === 0) return [];

    const ownerId = relation.owner === null ? null : relation.owner.id;
    const refs = await this.loadRefs(rows, [ownerId]);
    return rows.map((row) => this.buildVo(row, ownerId, refs));
  }

  // ===== 私有：取引用 / 装配 =====

  /** 批量取跨域引用（**一次列表一次往返**）：员工（A 域）＋ 联系人（B 域） */
  private async loadRefs(
    rows: readonly EventRow[],
    extraEmployeeIds: readonly (bigint | null)[],
  ): Promise<RefMaps> {
    const employeeIds = [
      ...new Set([
        ...rows.map((row) => row.actor_id),
        ...rows.map((row) => row.owner_snapshot),
        ...extraEmployeeIds,
      ].filter((id): id is bigint => id !== null)),
    ];
    const contactIds = [
      ...new Set(rows.map((row) => row.contact_id).filter((id): id is bigint => id !== null)),
    ];

    const [employees, contacts] = await Promise.all([
      this.org.getEmployeeRefs(employeeIds),
      this.company.getContactRefs(contactIds),
    ]);

    return { employees: toNameMap(employees), contacts: toNameMap(contacts) };
  }

  /** 行 → 事件项出参（纯装配；权限 / 有效性等判断都不在这一层做） */
  private buildVo(row: EventRow, ownerId: bigint | null, refs: RefMaps): ActionEventVo {
    return {
      id: row.id,
      action_type: row.action_type,
      summary: row.summary,
      outcome: row.outcome,
      competition: row.competition,
      actor: refOf(refs.employees, row.actor_id),
      owner_snapshot: refOf(refs.employees, row.owner_snapshot),
      contact: refOf(refs.contacts, row.contact_id),
      duration_min: row.duration_min,
      event_at: row.event_at.toISOString(),
      // ★ 分界基准＝**该关系的 owner**，不是当前登录人（→ 决策 #30：经理打开也是主跟单人视角）
      branch: ownerId !== null && row.actor_id === ownerId ? 'main' : 'sub',
      attachments: [],
    };
  }
}

/** 仓储读出的事件行（结构取自 `EVENT_SELECT`，**不手抄字段**） */
type EventRow = NonNullable<Awaited<ReturnType<EngineRepository['findEventByIdempotencyKey']>>>;

/** 跨域引用表（id 十进制串 → 名字） */
interface RefMaps {
  employees: Map<string, string>;
  contacts: Map<string, string>;
}

/**
 * 当前登录人（**只从令牌 / 上下文来**，不查库，→ 架构 §7.1）。
 * 本批只用它取 `actor_id`，权限由 C 域出口判 —— 但**没有上下文就必须 401**（守卫没跑＝编程错误）。
 */
function requireViewer(): { employeeId: bigint } {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'engine.no_context',
    });
  }
  return { employeeId: context.employeeId };
}

function toNameMap(refs: readonly { id: bigint; name: string }[]): Map<string, string> {
  return new Map(refs.map((ref) => [ref.id.toString(), ref.name]));
}

/** id（可为 `null`）→ `{id,name}`；引用取不到 → `null`（**不编名字**：员工停用 / 联系人已删时取不到） */
function refOf(map: Map<string, string>, id: bigint | null): { id: bigint; name: string } | null {
  if (id === null) return null;
  const name = map.get(id.toString());
  return name === undefined ? null : { id, name };
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

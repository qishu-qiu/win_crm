// =============================================================================
// D 域服务（M4-07 写跟单事件 / M4-08 关系时间线）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、跨域取引用），
//   **不写业务规则**（有效沟通 / 回写 / 幂等键全在 `domain/`）、**不写 SQL**（在 `engine.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.7（事件项出参、`POST /relations/:id/events` 入参）；
//     §5.6（数据范围）；§2.4（错误码）。
//   · 《销售CRM数据架构文档》D2（`action_event`）：快速标记三型**不**回写 `last_event_at`。
//   · 《销售CRM业务需求文档》§10.2：有效沟通**必须写一句话结果**；无效沟通**点一下即可**。
//   · 《销售CRM架构设计说明》§5.2 跨域三条路：
//       ① 同步调对方 **exports 的 service** —— 本文件取「关系在不在 / 归谁 / 我能不能写」、
//         以及回写 `last_event_at` 全走 **C 域 `RelationService`** 这一个跨域出口
//         （**禁止**查 C 域的表）；③ 本域多表一致性 → **本域 `$transaction`**。
//   · 同 §7.4：**所有增删改都要留痕**（2026-09-15 七叔口径：「**符合等保标准，所有的增删改
//     都有迹可查**」）—— 本域三个写动作（写跟单 / 建承诺 / 改承诺）由**统一审计切面**
//     （`shared/interceptors/audit-log.interceptor.ts`）自动留痕，动作名＝ `ENGINE_AUDIT_ACTIONS`。
//     ⚠ **本文件里唯一例外**是 `listEvents` 的**查看留痕**：查看是 GET（不在切面范围），
//       且只对**管理员**触发（→ 需求 §4.2 ★ / §4.3 三「管理员每次查看写 operation_log」）。
//
// ★ `last_event_at` 为什么不和事件写进**同一个**事务（与计划 M4-07 字面表述的差别，已登记）：
//   计划行写「**事务**：写事件 + 条件回写 `last_event_at`」，但 `last_event_at` 在
//   `business_relation`（**C 域的表**）—— 架构 §5.2 明令「**不发跨域大事务**」
//   （理由：将来拆服务时跨服务事务要换成最终一致，现在写死就得处处重写）。
//   故本实现＝ ① 本域事务写 `action_event`；② **事务提交后**调 C 域出口回写。
//   ⚠ 架构 §5.3 把这条回写登记为领域事件 `ActionEventRecorded`（D 发 → C 收）。
//     事件总线自 M4-11 起**已在 DI 里**（`EventBusModule`，`@Global()`；C 域发 `RelationCreated`
//     用的就是它，→ `engine-event.subscriber.ts`），但**本处仍走跨域路之①（同步调 service）**：
//     回写成不成功是**本次请求**的一部分（结果可验证、失败可透出），改走事件就是「不等结果」，
//     语义变了。**两者都不跨域开事务**，差别只在投递方式。
//
// ★ P2002 的处理姿势（与 B / C 域同款，两条都要）：
//   ① **预检**（按幂等键先查一次）→ 覆盖 99% 的「销售手快」，给人话；
//   ② **catch 再映射**（`mapPrismaError` → `uk_idem`）→ 覆盖并发下预检漏过的竞态。
//   两条路径的**文案必须逐字一致**（同源常量 `EVENT_DUPLICATED_MESSAGE`）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import {
  AppError,
  // ⚠ 必须是**值导入**（不能写 `type AuditService`）：Nest 靠 `design:paramtypes` 元数据注入，
  //   类型导入会被编译期擦除 → 元数据退化成 `Function` → 启动即报「依赖解析失败」（→ 铁律坑 31）
  AuditService,
  type DomainEvent,
  ErrorCode,
  getRequestContext,
  jsonToBigint,
  mapPrismaError,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import { OrgService } from '../org/org.service';
// ⚠ 只带一个**类型**（`RelationVo`）：`activateContactRelation` 的出参＝ C 域的关系列表项形状 ＋
//   `linked_events` —— 形状的唯一落点在 C 域，在 D 域重抄约 20 个字段就是双真相源。
import { RelationService, type RelationVo } from '../relation/relation.service';
import {
  checkCommitmentMutable,
  checkWaiveReason,
  requiresWaiveReason,
} from './domain/commitment-rules';
import {
  type ActivateRelationDto,
  type CreateCommitmentDto,
  type CreateEventDto,
  type QuickMarkDto,
  type UpdateCommitmentDto,
} from './dto/engine-request.dto';
import { isSummaryRequired } from './domain/event-effective';
import { buildEventIdempotencyKey } from './domain/event-idempotency';
import { decideLastEventUpdate } from './domain/last-event';
import { EngineRepository, type EngineTxClient } from './engine.repository';

/**
 * D 域写动作 ＋ 查看留痕的动作名（→ A10 口径 `模块.动词`；2026-09-15 定）。
 * ★ 集中一处导出（同 A / B / C 域）：动作名是检索键，**只增不改**。
 */
export const ENGINE_AUDIT_ACTIONS = {
  /** 记一条跟单 → `POST /relations/:id/events`（写动作，由统一切面留痕） */
  eventCreate: 'event.create',
  /** 建承诺 → `POST /relations/:id/commitments`（写动作，由统一切面留痕） */
  commitmentCreate: 'commitment.create',
  /** 改承诺（兑现 / 取消 / 豁免 / 改期）→ `PUT /relations/:id/commitments`（写动作，由统一切面留痕） */
  commitmentUpdate: 'commitment.update',
  /** ★ 批量快速标记 → `POST /events/quick-mark`（写动作，由统一切面留痕） */
  quickMark: 'event.quick_mark',
  /**
   * ★ 关联公司并激活业务关系 → `POST /contacts/:id/activate-relation`（写动作，由统一切面留痕）。
   * ⚠ 三段式动作名（`模块.动词` 的动词位不是名词）—— 本动作**写三张表**（就职 / 关系 / 跟单），
   *   故不能拆成「像哪个对象的增删改」；记为 `contact.activate_relation` 与接口 §5.6 的端点名同字。
   */
  contactActivateRelation: 'contact.activate_relation',
  /** ★ 查看跟单全文 → `GET /relations/:id/events`：**读路径**，只对**管理员**写（本文件手工调 `recordStandalone`） */
  eventView: 'event.view',
} as const;

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

/** 承诺出参（→ §5.7 承诺形状；不含 actor / owner 名，规格里就没这两个字段） */
export interface CommitmentVo {
  id: bigint;
  relation_id: bigint;
  party: string;
  ctype: string;
  content: string;
  due_at: string | null;
  remind_at: string | null;
  status: string;
  /** 豁免原因（仅 `status=waived` 有值；→ 需求 §10.1） */
  waive_reason: string | null;
  done_at: string | null;
}

/**
 * 今日动线条目出参（→ §5.7）。
 * ⚠ `relation` **可空**：动线条目存在「只有联系人、还没挂关系」的形态
 *   （→ 数据架构 D4 `relation_id` 可空；如「新联系人 7 天未关联公司 → 提醒补全」），
 *   此时没有关系指向。接口 §5.7 把该字段写成非空，本批按 D4 的可空实际处理并**登记待明确**。
 */
export interface AgendaItemVo {
  id: bigint;
  ref_type: string;
  ref_id: bigint | null;
  relation: { id: bigint; name: string } | null;
  contact: { id: bigint; name: string } | null;
  reason: string | null;
  priority: number;
  action_hint: string | null;
  status: string;
  snooze_count: number;
}

/**
 * 批量快速标记出参（→ §5.7）。
 * ⚠ 规格**没给出参形状**（§5.7 只给了 req）—— 本批按「标了几条」实现，
 *   缺口登记（→《欠账登记表》D-24），待回填接口文档。
 */
export interface QuickMarkResultVo {
  /** 实际落库的事件条数（＝去重后能写的关系数） */
  marked: number;
}

/**
 * 「关联公司并激活业务关系」出参（→ 接口 §5.6）＝ **新关系的列表项** ＋ `linked_events`。
 * ★ 列表项形状直接**继承 C 域 `RelationVo`**：§5.6 的「列表项」只有**一份**形状，
 *   在 D 域重抄一遍就是双真相源（前端那两个类型也会跟着分叉）。
 */
export interface ActivateRelationVo extends RelationVo {
  /** 本次搬运的**孤儿跟单**条数（关联前只挂在联系人、没挂关系的那批） */
  linked_events: number;
}

/** `RelationCreated` 事件的载荷（→ C 域 `createRelation` 发出；**最小信息**，架构 §5.3） */
export interface RelationCreatedPayload {
  companyId?: bigint;
  deptId?: bigint;
  productLineId?: bigint;
  ownerId?: bigint | null;
}

/** 时间线范围（→ §5.7：`GET /relations/:id/events` 默认 `range=1m`） */
export type EventRange = '1m' | 'all';

/** 与 `mapPrismaError` 中 `uk_idem` 那条**逐字一致**（预检与兜底两处共用，改一处即两处生效） */
const EVENT_DUPLICATED_MESSAGE = '这条跟单刚刚已经记过了';

/** 「近 1 个月」按 30 天算（→ §5.7 `range=1m`） */
const DEFAULT_RANGE_DAYS = 30;

/** 时间线单次上限（本批无分页；分页待各域列表统一接，→ 接口 §2.7 /《欠账登记表》D-08） */
const TIMELINE_LIMIT = 200;

/** 某关系的承诺列表上限（同上：本批无分页） */
const COMMITMENT_LIMIT = 100;

/** 今日动线条目上限（同上：本批无分页） */
const AGENDA_LIMIT = 100;

/** 快速标记落库时的 `action_type`（→ 见 `quickMark` 方法头 ★：三型都是「电话没打通」这一族） */
const QUICK_MARK_ACTION_TYPE = 'phone';

/** 建档事件的幂等键前缀（→ 见 `recordRelationCreated`：让「至少一次投递」不会写成两条） */
const RELATION_CREATED_KEY_PREFIX = 'relation_created';

/** 建档事件在时间线上显示的那句话（**系统事件**，不是销售写的跟单） */
const RELATION_CREATED_SUMMARY = '建档：激活业务关系';

@Injectable()
export class EngineService {
  constructor(
    private readonly repository: EngineRepository,
    private readonly relation: RelationService,
    private readonly org: OrgService,
    private readonly company: CompanyService,
    private readonly prisma: PrismaService,
    /** 审计留痕（M5-07）—— **只用于 `listEvents` 的管理员查看留痕**；写动作的留痕由统一切面负责 */
    private readonly audit: AuditService,
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

  // ===== M6-09 批量快速标记 =====

  /**
   * 批量快速标记（→ §5.7 `POST /events/quick-mark`；列表页「勾选多个客户 → 一次性标记」）。
   *
   * ★ 与 `recordEvent` 的**三条语义差别**（别把两套逻辑合成一个方法）：
   *   ① **不回写 `last_event_at`**：快速标记＝无效沟通，不重置掉海倒计时
   *      （→ 需求 §6.3 / §十六 #44：否则销售每天点一下就能保号，倒计时被刷爆）；
   *   ② **没有 `summary`**：规格 req 里就没有这个字段（点一下即留痕，不强制写一个字，→ 需求 §10.2）；
   *   ③ **不写幂等键**（`idempotency_key` 留 `null`）：每次点击**都该是一条独立记录** ——
   *      需求 §10.2 要的正是「这个客户打过 N 次」。若沿用内容幂等键（`domain/event-idempotency.ts`
   *      的「同内容同键」），第二天再打同一个号会被判成「刚刚已经记过了」409，统计直接失真。
   *      ⚠ 那个函数是给**写跟单**用的，别搬到这里。
   *
   * ★ `action_type` 固定 `phone`：三型快速标记都是「电话没打通」这一族
   *   （未联系 / 未接电话 / 说两句挂了），而规格 req **没给 `action_type`**
   *   ⇒ 不替销售编动作类型，按唯一可能的动作落（已在报告里点名）。
   *
   * ★ 逐条判**可写**（C 域出口）：越权 / 只读角色当场 403，**不做「跳过坏行、静默成功」**
   *   —— 批量里混进一条别人的客户却弹「标了 9 条」，比直接报错更糟（销售会以为都标上了）。
   */
  async quickMark(dto: QuickMarkDto): Promise<QuickMarkResultVo> {
    const viewer = requireViewer();

    // ① 参数：**两组至少给一组**（→ §5.7）
    const rawRelationIds = dto.relation_ids ?? [];
    const rawContactIds = dto.contact_ids ?? [];
    if (rawRelationIds.length === 0 && rawContactIds.length === 0) {
      throw new AppError(
        ErrorCode.PARAM_INVALID,
        400,
        '参数错误：relation_ids 与 contact_ids 至少给一组',
        { constraint: 'quick_mark.empty' },
      );
    }

    // ② 去重：同一个对象勾两次＝**一条**记录（否则一次点击落两条，统计翻倍）
    const relationIds = [...new Set(rawRelationIds.map((id) => jsonToBigint(id, 'relation_ids')))];
    const contactIds = [...new Set(rawContactIds.map((id) => jsonToBigint(id, 'contact_ids')))];

    // ③ **先全判完可写，再落库**：免得「标了一半才报 403」留下半批脏数据
    //    ③-1 关系侧 → C 域出口（越权 / 只读角色 → 403）
    const relations: { id: bigint; ownerId: bigint | null }[] = [];
    for (const id of relationIds) {
      relations.push(await this.relation.requireWritableRelation(id.toString()));
    }
    //    ③-2 「待关联」联系人侧 → **只有当前归属人能标**（→ 需求 §6.1 ⑦⑨「谁建的归谁」）。
    //         ★ 以**当前** `owner_id` 为准，不是最初的建档人：归属**可改**（经理分派 / 离职交接，
    //           只留痕不走审批，→ 需求 §6.1 ⑨），改完就该由新归属人负责标。
    if (contactIds.length > 0) {
      const owners = await this.company.getContactOwners(contactIds);
      if (owners.length !== contactIds.length) {
        throw new AppError(
          ErrorCode.PARAM_INVALID,
          400,
          '参数错误：contact_ids 里有不存在（或已合并 / 已删除）的联系人',
          { constraint: 'quick_mark.contact_missing' },
        );
      }
      if (owners.some((row) => row.owner_id !== viewer.employeeId)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, '只能标记自己的待跟进线索', {
          constraint: 'quick_mark.not_mine',
        });
      }
    }

    const eventAt = new Date();
    /** 两类对象共用的落库字段（**不含** `relation_id` / `contact_id` / `owner_snapshot`） */
    const base = {
      actor_id: viewer.employeeId,
      action_type: QUICK_MARK_ACTION_TYPE,
      summary: null,
      outcome: dto.outcome,
      competition: null,
      competitor_id: null,
      competition_note: null,
      duration_min: null,
      source: 'manual',
      visit_log_id: null,
      appointment_id: null,
      // ★ 不写幂等键（见方法头 ★③）
      idempotency_key: null,
      event_at: eventAt,
    };
    let marked = 0;
    await this.prisma
      .$transaction(async (tx) => {
        const client: EngineTxClient = tx;
        // 关系侧：挂关系（`owner_snapshot` ＝ 该关系当前 owner）
        for (const relation of relations) {
          await this.repository.createEvent(
            { ...base, relation_id: relation.id, contact_id: null, owner_snapshot: relation.ownerId },
            client,
          );
          marked += 1;
        }
        // 联系人侧：**只绑联系人**（`relation_id` 空 —— 「待关联」阶段的正当形态，→ 数据架构 D2）；
        //   此时没有关系，`owner_snapshot` 无从取，留 `null`
        for (const contactId of contactIds) {
          await this.repository.createEvent(
            { ...base, relation_id: null, contact_id: contactId, owner_snapshot: null },
            client,
          );
          marked += 1;
        }
      })
      .catch((error: unknown) => {
        throw mapPrismaError(error) ?? error;
      });

    return { marked };
  }

  // ===== M6-14 关联公司并激活业务关系（→ 接口 §5.6 `POST /contacts/:id/activate-relation`）=====

  /**
   * 关联公司并激活业务关系：**一个动作含三件事** —— ① 建关系（C）② 写就职关系（B）
   * ③ 批量改挂孤儿跟单（D）。规格原文见接口 §5.6（2026-09-16 拍板 · D-29）。
   *
   * ★ 为什么由 **D 域**编排（三件事横跨 B / C / D 三域）：
   *   ① **层级**：`B(L2) < C(L3) < D(L4)`（架构 §5.1 硬规则 1）—— 只有 D 能同时俯视 B 与 C；
   *      而「批量改挂跟单」动的是 `action_event`（**本域的表**），C 域**不可反向依赖** D 域。
   *   ② **出参要同步回 `linked_events`**（搬运条数）⇒ 走不了领域事件：§5.2 路之② 是「我做完一件事、
   *      **我不等结果**」，计数拿不回来。
   *   ⇒ 走 §5.2 路之①（同步调对方 `exports` 的 service），且**不新增领域事件**
   *     （架构 §5.3 的事件清单一个字不动）。
   *
   * ★ 顺序 ＝ **前置校验 → ① 建关系（C）→ ② 写就职（B）→ ③ 搬运（D）**，
   *   三写**不在同一个事务里**（架构 §5.2 明令禁止跨域大事务）。**先 C 后 B** 是有意的：
   *   · `createRelation` 自带完整前置校验（部门范围 / 三元组存在性 / 活跃唯一键）且写在本域事务内
   *     —— 它抛错时**一行都没落**；
   *   · 若把它排在 B 之后：一旦它 409，联系人**已经被挂到公司上**、而关系不存在 ⇒ 再调一次会被
   *     「已挂过公司」挡住，**这条线索就卡死了**（用户没有自救路径）；
   *   · 反过来（先 C 后 B）最坏结果是「关系已建、就职没写成」，用户重试拿到的是
   *     「该公司在该部门·产品线下已有归属，请走转交或协同」—— 这句是**真话**，
   *     且主目标（关系）已经建成。
   *   · 前置校验与写之间的竞态窗口由 B 域出口**复核**兜底（跨域禁大事务下的既有姿势）。
   *
   * ⚠ **不判「这条线索归不归我」**：接口 §5.6 给本端点的错误约定只有「三元组重复 409 /
   *   已挂过公司 409 / 部门越权 · 只读角色 403 / 各类 id 不存在 400」，**没有**「只有归属人能激活」
   *   —— 不自己加码（加码限制＝自造口径，与「清单外不许推出可以做」是两回事，同属不许自造）。
   */
  async activateContactRelation(
    contactId: string,
    dto: ActivateRelationDto,
  ): Promise<ActivateRelationVo> {
    requireViewer();
    const contactIdValue = jsonToBigint(contactId, 'id');

    // 前置校验：「待关联」＝该联系人当前**没有任何**就职记录（B 域出口；不是 → 409 防重复触发）
    await this.company.requireContactUnlinked(contactIdValue);

    // ① 建关系（C 域出口）：部门范围 / 三元组存在性 / `uk_active_rel` ＋ owner 成员（本域事务）
    //    并发出 `RelationCreated`（→ D 域的建档事件订阅者，架构 §5.3）
    const relation = await this.relation.createRelation({
      company_id: dto.company_id,
      dept_id: dto.dept_id,
      product_line_id: dto.product_line_id,
    });

    // ② 写就职关系（B 域出口；`is_current=true`）
    await this.company.linkContactEmployment({
      contactId: contactIdValue,
      companyId: jsonToBigint(dto.company_id, 'company_id'),
      ...(dto.position === undefined ? {} : { position: dto.position }),
    });

    // ③ 批量改挂孤儿跟单（**本域的表**，单条 `updateMany` 即原子 ⇒ 不必包事务）
    const { count } = await this.repository.rehangOrphanEventsOfContact(
      contactIdValue,
      relation.id,
    );

    return { ...relation, linked_events: count };
  }

  // ===== M4-08 关系时间线 =====

  /**
   * 关系时间线（→ §5.7 `GET /relations/:id/events`，**按 `event_at` 倒序**）。
   *
   * ★ 可见性走 C 域 `getRelation`（含范围校验）—— 跟单的可见性**继承业务关系权限**
   *   （→ 需求 §10.2），不在 D 域另写一套。
   */
  async listEvents(relationId: string, range: EventRange = '1m'): Promise<ActionEventVo[]> {
    const viewer = requireViewer();
    const relation = await this.relation.getRelation(relationId);

    // ★ 管理员查看留痕（→ 需求 §4.2 ★ / §4.3 三：「管理员可查看业务数据，但**每次查看写
    //   `operation_log`**」「全文，但只读，且每次查看写 `operation_log`」）。
    //
    // 三条口径说明（★ 别改成「所有角色都记」或「记进业务事务」）：
    //   ① **只记管理员**：查看留痕是**特权账号的护栏**（防"无痕看全公司"）；销售看自己的客户
    //      每次都记＝把审计表变成访问日志，反而淹掉真敏感项（→ P2 拍板时的取舍）。
    //   ② **走 `recordStandalone`**：读路径**没有业务事务**，硬造一个只会污染语义；
    //      且它是 best-effort —— 审计表抖动**不能让谁看不了跟单**。
    //   ③ **看不见的关系不记**：留痕发生在 `getRelation` 的**可见性校验之后**（越权早已 403）。
    //
    // ⚠ 判定用「持有 `admin` 角色」—— 与 C 域 `isRelationWriteRole`（多角色**取宽**、可写性）
    //   刻意不同：可写性是「给不给权利」，留痕是「加不加监控」，故按**字面从严**（admin ＋ 销售
    //   的人，用管理员身份看别人客户也要留痕）。规格未定义多角色叠加，本处属**从严不越权**，
    //   已登记（→ 交接说明）。
    if (viewer.roleCodes.includes('admin')) {
      await this.audit.recordStandalone({
        action: ENGINE_AUDIT_ACTIONS.eventView,
        target_type: 'business_relation',
        target_id: relation.id,
      });
    }

    const since =
      range === 'all' ? undefined : addDays(new Date(), -DEFAULT_RANGE_DAYS);
    const rows = await this.repository.listEventsByRelation(relation.id, since, TIMELINE_LIMIT);
    if (rows.length === 0) return [];

    const ownerId = relation.owner === null ? null : relation.owner.id;
    const refs = await this.loadRefs(rows, [ownerId]);
    return rows.map((row) => this.buildVo(row, ownerId, refs));
  }

  // ===== M4-09 承诺（建 / 列 / 改）=====

  /**
   * 建承诺（→ §5.7 `POST /relations/:id/commitments`）。
   *
   * 顺序同写跟单：**先权限（C 域出口）、再参数（联系人存在性）、最后落库**。
   *
   * ★ `owner_id` ＝ **关系的 owner**（不是"当前操作人"）：
   *   需求 §5.2 / §8.1 定「**未兑现的承诺跟着客户走**」（转交 / 重新领取时 `me` / `verdict`
   *   类承诺整体转给新 owner）—— 可见「承诺归谁」跟的是**关系的归属**。
   *   关系当前没有 owner（如已掉公海）时落到**写它的这个人**：`owner_id` 是必填列，不留空。
   */
  async createCommitment(relationId: string, dto: CreateCommitmentDto): Promise<CommitmentVo> {
    const viewer = requireViewer();
    const relation = await this.relation.requireWritableRelation(relationId);

    let contactId: bigint | null = null;
    if (dto.contact_id !== undefined && dto.contact_id !== '') {
      contactId = jsonToBigint(dto.contact_id, 'contact_id');
      const contacts = await this.company.getContactRefs([contactId]);
      if (contacts.length === 0) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：contact_id 指向的联系人不存在', {
          constraint: 'commitment.contact_missing',
        });
      }
    }

    const created = await this.repository.createCommitment({
      relation_id: relation.id,
      contact_id: contactId,
      owner_id: relation.ownerId ?? viewer.employeeId,
      party: dto.party,
      ctype: dto.ctype,
      content: dto.content,
      // 不给时间＝**未定**（前端「三快选」默认明天由前端给，见 `dto/engine-request.dto.ts`）
      due_at: parseOptionalDate(dto.due_at, 'due_at'),
      remind_at: parseOptionalDate(dto.remind_at, 'remind_at'),
      source_event_id:
        dto.source_event_id === undefined || dto.source_event_id === ''
          ? null
          : jsonToBigint(dto.source_event_id, 'source_event_id'),
      created_by: viewer.employeeId,
    });

    return toCommitmentVo(created);
  }

  /**
   * 某关系的承诺列表（→ §5.7 `GET /relations/:id/commitments`）。
   * ★ 可见性**继承业务关系权限**（同时间线）：走 C 域 `getRelation`，D 域不自造一套。
   */
  async listCommitments(relationId: string): Promise<CommitmentVo[]> {
    requireViewer();
    const relation = await this.relation.getRelation(relationId);
    const rows = await this.repository.listCommitmentsByRelation(relation.id, COMMITMENT_LIMIT);
    return rows.map(toCommitmentVo);
  }

  /**
   * 改承诺（→ §5.7 `PUT /relations/:id/commitments`）：**兑现**（`done`）/ **取消**（`cancelled`）/
   * **豁免**（`waived`）/ **改期**（`due_at` / `remind_at`）。
   *
   * 四道闸：① 能写这条关系（C 域出口）；② 这条承诺**确实挂在这条关系下**（拿 A 关系的入口
   * 不能改 B 的承诺）；③ 已结束的承诺不能再改（`domain/commitment-rules.ts`）；
   * ④ **豁免必填原因**（`waive_reason`，→ 需求 §10.1）—— 收下原因却没处存＝假契约，
   *    故本动作**等到列落地（migration `0005`）才开放**（2026-09-15）。
   */
  async updateCommitment(relationId: string, dto: UpdateCommitmentDto): Promise<CommitmentVo> {
    const viewer = requireViewer();
    const relation = await this.relation.requireWritableRelation(relationId);
    const commitmentId = jsonToBigint(dto.id, 'id');

    const row = await this.repository.findCommitmentById(commitmentId);
    if (row === null || row.relation_id !== relation.id) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：该承诺不属于这条业务关系', {
        constraint: 'commitment.not_found',
      });
    }

    const mutable = checkCommitmentMutable(row.status);
    if (!mutable.ok) {
      throw new AppError(ErrorCode.REQUIRED_MISSING, 422, mutable.reason, {
        constraint: 'commitment.closed',
      });
    }

    // ★ 豁免必填原因（→ 需求 §10.1）：取消＝**记录本身错了**（纠错，不必填）；豁免＝**记录没错、但没成**（必填）
    const waiveReason = (dto.waive_reason ?? '').trim();
    if (dto.status !== undefined && requiresWaiveReason(dto.status)) {
      const reasonCheck = checkWaiveReason(waiveReason);
      if (!reasonCheck.ok) {
        throw new AppError(ErrorCode.REQUIRED_MISSING, 422, reasonCheck.reason, {
          constraint: 'commitment.waive_reason_required',
        });
      }
    }

    const updated = await this.repository.updateCommitment(commitmentId, {
      ...(dto.status === undefined ? {} : { status: dto.status }),
      // 兑现才写兑现时间 / 兑现人（取消不写，免得「取消」也有一条 done 痕迹）
      ...(dto.status === 'done' ? { done_at: new Date(), done_by: viewer.employeeId } : {}),
      // 豁免才写原因（其余状态一律留空，免得「取消」也顶一条原因）
      ...(dto.status === 'waived' ? { waive_reason: waiveReason } : {}),
      ...(dto.due_at === undefined ? {} : { due_at: parseOptionalDate(dto.due_at, 'due_at') }),
      ...(dto.remind_at === undefined ? {} : { remind_at: parseOptionalDate(dto.remind_at, 'remind_at') }),
      updated_by: viewer.employeeId,
    });

    return toCommitmentVo(updated);
  }

  // ===== M4-10 今日动线（简版）=====

  /**
   * 今日该找谁（→ §5.7 `GET /today-agenda`）。
   *
   * ★ 本批＝**直查 `daily_agenda`**（计划 M4-10 原文）：不实时组装、不查承诺 / 预约 / 节奏。
   *   真实来源是每日 05:00 的组装任务（→ 数据架构 D4），属 M7；本批库里没有当日行就返回空数组。
   * ★ 出参要的 `relation:{id,name}` / `contact:{id,name}` 都走**跨域出口**批量取（一次一问）。
   */
  async todayAgenda(): Promise<AgendaItemVo[]> {
    const viewer = requireViewer();
    const rows = await this.repository.listAgendaOfUser(
      viewer.employeeId,
      todayDateKey(new Date()),
      AGENDA_LIMIT,
    );

    const [relations, contacts] = await Promise.all([
      this.relation.getRelationRefs(uniqueBigints(rows.map((row) => row.relation_id))),
      this.company.getContactRefs(uniqueBigints(rows.map((row) => row.contact_id))),
    ]);
    const relationNames = toNameMap(relations);
    const contactNames = toNameMap(contacts);

    return rows.map((row) => ({
      id: row.id,
      ref_type: row.ref_type,
      ref_id: row.ref_id,
      relation: relationRefOf(relationNames, row.relation_id),
      contact: refOf(contactNames, row.contact_id),
      reason: row.reason,
      priority: row.priority,
      action_hint: row.action_hint,
      status: row.status,
      snooze_count: row.snooze_count,
    }));
  }

  // ===== M4-11 建档事件（由 `engine-event.subscriber.ts` 调）=====

  /**
   * 落一条**建档**事件（→ 架构 §5.3：`RelationCreated` ＝ C 发 → D 落首条 `action_event`）。
   *
   * ★ **幂等**：事件总线是「至少一次」语义（将来换 MQ 更是），故用**确定性幂等键**
   *   `relation_created:<关系 id>` —— 重复到达时预检查到、DB 的 `uk_idem` 再兜一层，
   *   结果都是「只落一条」。撞键**不算错误**（这正是幂等的用处），故不外抛。
   *
   * ★ **不回写 `last_event_at`**（与 `recordEvent` 的关键差别）：建档是**系统动作**，
   *   不是「跟客户沟通过」；掉了海的关系被重新领取时若拿建档事件刷倒计时，
   *   等于给「点一下保号」开了后门（→ 需求 §6.3）。
   *   本方法因此**直接走仓储**，不复用 `recordEvent` 那套「有效沟通才回写」的编排。
   *
   * ★ **不查权限**：事件来自 C 域（关系刚被激活），此时没有「当前登录人」可言 ——
   *   `actorId` 由事件带来（架构 §5.3 基类字段）。
   */
  async recordRelationCreated(event: DomainEvent<RelationCreatedPayload>): Promise<void> {
    const relationId = event.aggregateId;
    if (relationId === undefined) return; // 事件没带对象 → 无处可落（宁可漏写，不猜是哪条关系）

    const idempotencyKey = `${RELATION_CREATED_KEY_PREFIX}:${relationId.toString()}`;
    const duplicated = await this.repository.findEventByIdempotencyKey(idempotencyKey);
    if (duplicated !== null) return;

    try {
      await this.repository.createEvent({
        relation_id: relationId,
        contact_id: null,
        actor_id: event.actorId,
        owner_snapshot: event.payload.ownerId ?? null,
        action_type: 'system',
        summary: RELATION_CREATED_SUMMARY,
        outcome: null,
        competition: null,
        competitor_id: null,
        competition_note: null,
        duration_min: null,
        source: 'system',
        visit_log_id: null,
        appointment_id: null,
        idempotency_key: idempotencyKey,
        event_at: event.occurredAt,
      });
    } catch (error) {
      // 并发下预检漏过 → `uk_idem` 兜底，同样视为「已经落过」
      if (mapPrismaError(error) === undefined) throw error;
    }
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

/** 仓储读出的承诺行（结构取自 `COMMITMENT_SELECT`，同上：不手抄字段） */
type CommitmentRow = NonNullable<Awaited<ReturnType<EngineRepository['findCommitmentById']>>>;

/** 跨域引用表（id 十进制串 → 名字） */
interface RefMaps {
  employees: Map<string, string>;
  contacts: Map<string, string>;
}

/**
 * 当前登录人（**只从令牌 / 上下文来**，不查库，→ 架构 §7.1）。
 * 用它取 `actor_id`；权限由 C 域出口判 —— 但**没有上下文就必须 401**（守卫没跑＝编程错误）。
 * ★ M5-07 起多带 `roleCodes`：`listEvents` 要按它判「是不是管理员」（查看留痕，→ 需求 §4.2 ★）。
 */
function requireViewer(): { employeeId: bigint; roleCodes: readonly string[] } {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'engine.no_context',
    });
  }
  return { employeeId: context.employeeId, roleCodes: context.roleCodes };
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

/** 可选时间的解析（DTO 已用 `IsDateString` 卡过，这里是**兜底 ＋ 类型收窄**） */
function parseOptionalDate(value: string | undefined, field: string): Date | null {
  if (value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ErrorCode.PARAM_INVALID, 400, `参数错误：${field} 不是合法时间`, {
      constraint: `commitment.${field}_invalid`,
    });
  }
  return parsed;
}

/**
 * 今天的**日历日**（`daily_agenda.biz_date` 是 `DATE` 列：只比日期，不带时刻）。
 *
 * ★ 由**本地**年月日拼 `YYYY-MM-DD`：`new Date('2026-09-15')` 按 UTC 零点解析，
 *   对 `DATE` 列取到的正是 `2026-09-15` 这一天；
 *   若直接把 `new Date()` 传下去，本地时区（+08:00）下会被折算成**前一天**的 UTC 时刻，
 *   跨天判断就会错（「今天该找谁」查不到今天）。
 */
function todayDateKey(now: Date): Date {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return new Date(`${now.getFullYear()}-${month}-${day}`);
}

/** 承诺行 → 出参（纯装配） */
function toCommitmentVo(row: CommitmentRow): CommitmentVo {
  return {
    id: row.id,
    relation_id: row.relation_id,
    party: row.party,
    ctype: row.ctype,
    content: row.content,
    due_at: row.due_at === null ? null : row.due_at.toISOString(),
    remind_at: row.remind_at === null ? null : row.remind_at.toISOString(),
    status: row.status,
    waive_reason: row.waive_reason,
    done_at: row.done_at === null ? null : row.done_at.toISOString(),
  };
}

/** 去重并滤掉可空 id（`daily_agenda` 的 `relation_id` / `contact_id` 都可空） */
function uniqueBigints(ids: readonly (bigint | null)[]): bigint[] {
  return [...new Set(ids.filter((id): id is bigint => id !== null))];
}

/**
 * 动线条目的关系引用（→ §5.7 `relation:{id,name}`）。
 * ★ 与 `refOf` 的差别：**取不到名字也给对象**（`name` 空串）—— 关系 id 是动线条目自己的字段，
 *   即便公司档案已被逻辑删（取不到名字），这条动线依然指向那条关系，不该整条变 `null`。
 */
function relationRefOf(
  names: Map<string, string>,
  id: bigint | null,
): { id: bigint; name: string } | null {
  if (id === null) return null;
  return { id, name: names.get(id.toString()) ?? '' };
}

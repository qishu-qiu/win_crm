// =============================================================================
// D 域服务用例（M4-07 ~ M4-11）—— **假数据，不连库**
//
// 为什么这样布局（`domain/**` 是纯规则，无框架 / ORM 依赖 → 假数据即可单测）：
//   · 判定类（有效沟通 / 回写 / 幂等键 / 承诺白名单）→ `domain/*.spec.ts`（**无 IO**）；
//   · 编排类（先权限、再参数、再幂等、最后落库；跨域谁调谁）→ 本文件。
//
// 判据逐字（《过程产出/开发计划-V1.md》）：
//   · M4-07：「`recordEvent`（事务：写事件 + 条件回写 `last_event_at`）」
//            → 单测：**有效 → 改；无效 → 不改**。
//   · M4-08：「关系时间线（`GET /relations/:id/events`）」→ 单测：**倒序**。
//   · M4-09：「承诺 建 / 列 / 改（三型 me / them / verdict 基础）」。
//   · M4-10：「今日概览（简版，直查 `daily_agenda`）」。
//   · M4-11：「订阅 `RelationCreated` → 落首条建档事件」。
// =============================================================================
import {
  AppError,
  type AuditLogInput,
  type AuditService,
  DomainEventName,
  ErrorCode,
  createDomainEvent,
  mapPrismaError,
  runWithContext,
  type RequestContext,
} from '../../kernel/index';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CompanyService } from '../company/company.service';
import type { OrgService } from '../org/org.service';
import type { RelationService } from '../relation/relation.service';
import { EngineRepository } from './engine.repository';
import { EngineService } from './engine.service';

const ME = 7n;
const OWNER = 7n;
const OTHER = 8n;
const CONTACT_ID = 5n;
const DEPT_ID = 2n;
const RELATION_ID = 11n;
const EVENT_ID = 101n;
const COMMITMENT_ID = 201n;
const AGENDA_ID = 301n;
const COMPANY_NAME = '合肥测试建材有限公司';

/** 造一条仓储读出的事件行（字段与 `EVENT_SELECT` 对齐） */
function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    relation_id: RELATION_ID,
    contact_id: CONTACT_ID,
    actor_id: ME,
    owner_snapshot: OWNER,
    action_type: 'phone',
    summary: '客户说下周一再谈',
    outcome: 'advanced',
    competition: 'none',
    competition_note: null,
    duration_min: 10,
    mentioned_user_ids: null,
    attachments: null,
    event_at: new Date('2026-09-15T10:00:00Z'),
    created_at: new Date('2026-09-15T10:00:00Z'),
    ...overrides,
  };
}

/** 造一条仓储读出的承诺行（字段与 `COMMITMENT_SELECT` 对齐） */
function commitmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMITMENT_ID,
    relation_id: RELATION_ID,
    contact_id: CONTACT_ID,
    owner_id: OWNER,
    party: 'me',
    ctype: 'deliver',
    content: '周三前把报价单发过去',
    due_at: new Date('2026-09-16T00:00:00Z'),
    remind_at: null,
    status: 'open',
    waive_reason: null,
    done_at: null,
    source_event_id: null,
    created_at: new Date('2026-09-15T10:00:00Z'),
    ...overrides,
  };
}

/** 造一条仓储读出的动线行（字段与 `AGENDA_SELECT` 对齐） */
function agendaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENDA_ID,
    ref_type: 'commitment',
    ref_id: COMMITMENT_ID,
    relation_id: RELATION_ID,
    contact_id: CONTACT_ID,
    reason: '今天到期：把报价单发过去',
    priority: 10,
    action_hint: '打个电话',
    status: 'open',
    snooze_count: 0,
    ...overrides,
  };
}

interface FakeOptions {
  /** 预检命中的同键事件（`null` ＝ 没撞） */
  duplicated?: Record<string, unknown> | null;
  /** `createEvent` 抛错（并发竞态用例用） */
  createError?: unknown;
  /** 时间线返回的行（**顺序即仓储返回顺序**，用来钉「倒序」） */
  rows?: Record<string, unknown>[];
  /** 联系人引用取不回（联系人被删 / 已合并） */
  contactMissing?: boolean;
  /** 关系不存在 / 越权 / 只读（C 域出口抛的错） */
  relationError?: AppError | null;
  /** `findCommitmentById` 返回的承诺行（**显式给 `null` ＝ 查不到**） */
  commitment?: Record<string, unknown> | null;
  /** 今日动线返回的行 */
  agenda?: Record<string, unknown>[];
  /** 关系引用（`getRelationRefs` 给什么名字）——默认给一条与 `RELATION_ID` 对应的公司名 */
  relationRefs?: { id: bigint; name: string }[];
  /** 关系的 owner（建承诺时要看「承诺跟关系走」，用 `null` 模拟已掉公海） */
  ownerId?: bigint | null;
  /** 「待关联」联系人的归属（P-03：快速标记的联系人侧要判「归不归我」）；不给＝默认都归我 */
  contactOwners?: { id: bigint; owner_id: bigint | null }[];
  /** 联系人**已挂过公司**（关联动线的前置校验应抛 409，→ M6-14） */
  contactLinked?: boolean;
  /** 关联动线：`createRelation` 抛的错（三元组重复 409 / 越权 403 / 只读 403） */
  createRelationError?: AppError | null;
  /** 关联动线：本次**搬运的孤儿跟单条数**（`updateMany` 的 `count`） */
  linkedEvents?: number;
  /** M7-01：领取公海时**转归属的 open 承诺条数**（`updateMany` 的 `count`） */
  reassignedCommitments?: number;
}

function createService(options: FakeOptions = {}) {
  const ownerId = options.ownerId === undefined ? OWNER : options.ownerId;
  const repository = {
    createEvent: jest.fn(async (data: Record<string, unknown>) => {
      if (options.createError !== undefined) throw options.createError;
      return eventRow(data);
    }),
    findEventByIdempotencyKey: jest.fn(async () => options.duplicated ?? null),
    listEventsByRelation: jest.fn(async () => options.rows ?? [eventRow()]),
    createCommitment: jest.fn(async (data: Record<string, unknown>) =>
      commitmentRow({ ...data, id: COMMITMENT_ID }),
    ),
    listCommitmentsByRelation: jest.fn(async () => []),
    findCommitmentById: jest.fn(async () =>
      options.commitment === undefined ? commitmentRow() : options.commitment,
    ),
    updateCommitment: jest.fn(async (id: bigint, data: Record<string, unknown>) =>
      commitmentRow({ ...data, id }),
    ),
    listAgendaOfUser: jest.fn(async () => options.agenda ?? []),
    // M6-14：把联系人名下**孤儿跟单**批量挂到新关系（`updateMany` 回 `{count}`）
    rehangOrphanEventsOfContact: jest.fn(async () => ({ count: options.linkedEvents ?? 0 })),
    // M7-01：领取公海 → 该关系 open 承诺整体转新 owner（`updateMany` 回 `{count}`）
    reassignOpenCommitments: jest.fn(async () => ({ count: options.reassignedCommitments ?? 0 })),
  };
  const relation = {
    // C 域跨域出口：**权限在这里判**（D 域不重复实现），单测只关心「它抛了 D 域就别往下走」
    requireWritableRelation: jest.fn(async () => {
      if (options.relationError !== null && options.relationError !== undefined) {
        throw options.relationError;
      }
      return { id: RELATION_ID, ownerId };
    }),
    touchLastEventAt: jest.fn(async () => undefined),
    getRelation: jest.fn(async () => ({
      id: RELATION_ID,
      owner: ownerId === null ? null : { id: ownerId, name: '王海涛' },
    })),
    getRelationRefs: jest.fn(async (ids: readonly bigint[]) =>
      (options.relationRefs ?? [{ id: RELATION_ID, name: COMPANY_NAME }]).filter((ref) =>
        ids.includes(ref.id),
      ),
    ),
    // M6-14：C 域出口「激活业务关系」（自带范围 / 存在性 / 活跃唯一键校验 ＋ 发建档事件）
    createRelation: jest.fn(async () => {
      if (options.createRelationError !== null && options.createRelationError !== undefined) {
        throw options.createRelationError;
      }
      return { id: RELATION_ID, company: { id: 3n, name: COMPANY_NAME }, owner: null };
    }),
  };
  const org = {
    getEmployeeRefs: jest.fn(async (ids: readonly bigint[]) =>
      [
        { id: ME, name: '王海涛' },
        { id: OTHER, name: '李强' },
      ].filter((ref) => ids.includes(ref.id)),
    ),
  };
  const company = {
    getContactRefs: jest.fn(async (ids: readonly bigint[]) =>
      options.contactMissing === true ? [] : [{ id: CONTACT_ID, name: '张总' }].filter((ref) => ids.includes(ref.id)),
    ),
    // P-03：快速标记的**联系人侧**要判「这条"待关联"线索归不归我」（B 域出口）
    getContactOwners: jest.fn(async (ids: readonly bigint[]) =>
      options.contactOwners === undefined
        ? ids.map((id) => ({ id, owner_id: ME }))
        : options.contactOwners,
    ),
    // M6-14：B 域出口「待关联」前置校验（判定与人话都在 B 域；这里只模拟它按规格抛）
    requireContactUnlinked: jest.fn(async (id: bigint) => {
      if (options.contactMissing === true) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：联系人不存在（或已删除 / 已合并）', {
          constraint: 'company.contact_missing',
        });
      }
      if (options.contactLinked === true) {
        throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '该联系人已挂过公司，不能重复关联', {
          constraint: 'company_contact.already_linked',
        });
      }
      return { id, name: '张总' };
    }),
    // M6-14：B 域出口「写就职关系」（收一个占位入参，用例要断言透传了什么）
    linkContactEmployment: jest.fn(async (input: Record<string, unknown>) => {
      void input;
      return undefined;
    }),
  };
  const prisma = { $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })) };
  /** 审计替身（M5-07）：只替掉落库动作 —— 供「管理员查看留痕」用例断言「记了什么 / 有没有记」 */
  const audit = {
    recordStandalone: jest.fn<Promise<boolean>, [AuditLogInput]>(async () => true),
  };

  const service = new EngineService(
    repository as unknown as EngineRepository,
    relation as unknown as RelationService,
    org as unknown as OrgService,
    company as unknown as CompanyService,
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  return { service, repository, relation, org, company, prisma, audit };
}

function contextOf(
  overrides: { type?: RequestContext['dataScope']['type']; roleCodes?: string[] } = {},
): RequestContext {
  return {
    employeeId: ME,
    deptIds: [DEPT_ID],
    roleCodes: overrides.roleCodes ?? ['sale'],
    dataScope: { type: overrides.type ?? 'self', deptIds: [] },
  };
}

/** 造一个 Prisma 唯一冲突错误（`mapPrismaError` 认的就是这个形状） */
function p2002(target: string): unknown {
  return { code: 'P2002', meta: { target } };
}

async function captureAppError(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('期望抛出 AppError，但调用成功返回了');
}

/** 有效沟通的最小入参（summary 必填，→ 需求 §10.2） */
const EFFECTIVE_DTO = {
  contact_id: CONTACT_ID.toString(),
  action_type: 'phone',
  outcome: 'advanced',
  summary: '客户说下周一再谈',
  duration_min: 10,
};

describe('EngineService（M4-07 写跟单 / M4-08 时间线）', () => {
  describe('recordEvent：落库字段（M4-02 / M4-07）', () => {
    it('写库时带上 actor / owner_snapshot / 幂等键，且**走本域事务**', async () => {
      const { service, repository, prisma } = createService();

      await runWithContext(contextOf(), () =>
        service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(data.actor_id).toBe(ME);
      // ★ `owner_snapshot` ＝ **写入那一刻**关系的 owner（→ D2：按轮次归组 ＋ 前主人标姓名）
      expect(data.owner_snapshot).toBe(OWNER);
      expect(data.relation_id).toBe(RELATION_ID);
      expect(data.contact_id).toBe(CONTACT_ID);
      expect(data.source).toBe('manual');
      expect(typeof data.idempotency_key).toBe('string');
      expect(data.idempotency_key).toHaveLength(64);
    });

    it('出参装配跨域引用：actor / owner_snapshot / contact 都有名字，且 `branch=main`', async () => {
      const { service, repository } = createService();

      const vo = await runWithContext(contextOf(), () =>
        service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
      );

      expect(vo.actor).toEqual({ id: ME, name: '王海涛' });
      expect(vo.owner_snapshot).toEqual({ id: OWNER, name: '王海涛' });
      expect(vo.contact).toEqual({ id: CONTACT_ID, name: '张总' });
      expect(vo.branch).toBe('main');
      // `event_at` ＝ 写进去的那个时间（`now` 由 service 取，故**回读写入值**比对，不用固定时钟）
      const written = repository.createEvent.mock.calls[0]?.[0] as { event_at: Date };
      expect(vo.event_at).toBe(written.event_at.toISOString());
    });
  });

  describe('recordEvent：条件回写 last_event_at（**M4-05 / M4-07 判据本体**）', () => {
    it('**有效沟通 → 回写**（回写的就是「写进去的事件时间」，不是 `now` 再取一次）', async () => {
      const { service, relation, repository } = createService();

      await runWithContext(contextOf(), () =>
        service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
      );

      const written = repository.createEvent.mock.calls[0]?.[0] as { event_at: Date };
      expect(relation.touchLastEventAt).toHaveBeenCalledTimes(1);
      expect(relation.touchLastEventAt).toHaveBeenCalledWith(RELATION_ID, written.event_at);
    });

    it('**空 outcome（中性）→ 也回写**（→ D2 只排除三型 quick_mark）', async () => {
      const { service, relation } = createService();

      await runWithContext(contextOf(), () =>
        service.recordEvent(RELATION_ID.toString(), {
          ...EFFECTIVE_DTO,
          outcome: undefined,
        }),
      );

      expect(relation.touchLastEventAt).toHaveBeenCalledTimes(1);
    });

    it.each(['not_contacted', 'no_answer', 'brief_hangup'])(
      '**快速标记 %s → 不回写**（点一下不重置掉海倒计时）',
      async (outcome) => {
        const { service, relation } = createService();

        await runWithContext(contextOf(), () =>
          service.recordEvent(RELATION_ID.toString(), { ...EFFECTIVE_DTO, outcome }),
        );

        expect(relation.touchLastEventAt).not.toHaveBeenCalled();
      },
    );
  });

  describe('recordEvent：一句话结果的必填性（→ 需求 §10.2）', () => {
    it('有效沟通没写 summary → **422 / 20403** `event.summary_required`，且不落库', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordEvent(RELATION_ID.toString(), { ...EFFECTIVE_DTO, summary: undefined }),
        ),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCode.REQUIRED_MISSING);
      expect(error.constraint).toBe('event.summary_required');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('**快速标记可以不写一个字**（连空白也不算）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf(), () =>
        service.recordEvent(RELATION_ID.toString(), {
          action_type: 'phone',
          outcome: 'no_answer',
        }),
      );

      expect(repository.createEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordEvent：幂等（M4-06 落点）', () => {
    it('预检命中同键 → **409** `uk_idem`，人话与 `mapPrismaError` **逐字一致**', async () => {
      const { service, repository } = createService({ duplicated: eventRow() });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.code).toBe(ErrorCode.UNIQUE_CONFLICT);
      expect(error.constraint).toBe('uk_idem');
      expect(error.message).toBe(mapPrismaError(p2002('uk_idem'))?.message);
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('**并发兜底**：预检漏过、DB 撞 `uk_idem` → 409，且**与预检同一句人话**', async () => {
      const { service } = createService({ createError: p2002('uk_idem') });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.constraint).toBe('uk_idem');
      expect(error.message).toBe(mapPrismaError(p2002('uk_idem'))?.message);
    });
  });

  describe('recordEvent：权限与存在性（**都由 C / B 域出口判**，D 域不自造）', () => {
    it('C 域出口拒了 → 直接透传，D 域**不写库、不重复判权限**', async () => {
      const { service, repository } = createService({
        relationError: new AppError(ErrorCode.FORBIDDEN, 403, '当前角色对业务关系只读', {
          constraint: 'relation.read_only',
        }),
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.read_only');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('contact_id 取不到引用 → **400** `event.contact_missing`，不落库（不留给外键报 500）', async () => {
      const { service, repository } = createService({ contactMissing: true });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('event.contact_missing');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('**没有请求上下文** → 401（守卫没跑＝编程错误，不许静默落库）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        service.recordEvent(RELATION_ID.toString(), EFFECTIVE_DTO),
      );

      expect(error.httpStatus).toBe(401);
      expect(repository.createEvent).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // M6-17「待关联」阶段记跟单（→ 接口 §5.7 第 4 行；D-45）
  //
  // 为什么这几条在 D 域单测：
  //   ① 「落库形态」（`relation_id` 空 / `owner_snapshot` 空）是**本域的表**的写法，D 域说了算；
  //   ② 「只有归属人能记」这一档**复用 B 域出口的判定**，D 域只负责「拒了就别往下走」——
  //      判定本身在 `company.service.spec.ts` 被钉住（同 quickMark 联系人侧的分工）。
  // ===========================================================================
  describe('recordContactEvent：待关联阶段记跟单（M6-17 · D-45）', () => {
    /** 最小有效入参（**不带 `contact_id`**：联系人由路径给，规格说「req 同关系侧、省 relation_id」） */
    const CONTACT_DTO = {
      action_type: 'phone',
      outcome: 'advanced',
      summary: '先加的微信，说有公司了再谈',
    };

    it('落库形态：`relation_id=null` ＋ `owner_snapshot=null`，且走本域事务', async () => {
      const { service, repository, prisma } = createService();

      await runWithContext(contextOf(), () =>
        service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      // ★ 本条就是「无关系」的正当形态（→ D2 的 CHECK：`relation_id` / `contact_id` 至少一非空）
      expect(data.relation_id).toBeNull();
      expect(data.contact_id).toBe(CONTACT_ID);
      // ★ `owner_snapshot` 的语义是「写入那一刻**该关系**的 owner」—— 没有关系 ⇒ 无从取，留 null
      expect(data.owner_snapshot).toBeNull();
      expect(data.actor_id).toBe(ME);
      expect(data.source).toBe('manual');
      expect(data.idempotency_key).toHaveLength(64);
    });

    it('**不碰 C 域出口**：不判关系可写、不回写 `last_event_at`（本条没有关系）', async () => {
      const { service, relation } = createService();

      await runWithContext(contextOf(), () =>
        service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
      );

      expect(relation.requireWritableRelation).not.toHaveBeenCalled();
      expect(relation.touchLastEventAt).not.toHaveBeenCalled();
    });

    it('出参：`contact` 有名字、`owner_snapshot=null`（无关系 ⇒ `branch=sub`，没有主线可比）', async () => {
      const { service } = createService();

      const vo = await runWithContext(contextOf(), () =>
        service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
      );

      expect(vo.contact).toEqual({ id: CONTACT_ID, name: '张总' });
      expect(vo.owner_snapshot).toBeNull();
      expect(vo.actor).toEqual({ id: ME, name: '王海涛' });
      expect(vo.branch).toBe('sub');
    });

    it('`contact_id` 与路径是**同一个人** → 放行（规格说 req 同关系侧，故允许带）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf(), () =>
        service.recordContactEvent(CONTACT_ID.toString(), {
          ...CONTACT_DTO,
          contact_id: CONTACT_ID.toString(),
        }),
      );

      expect(repository.createEvent).toHaveBeenCalledTimes(1);
    });

    it('`contact_id` 指向**别人** → 400 `event.contact_conflict`，不落库（静默忽略入参更糟）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordContactEvent(CONTACT_ID.toString(), {
            ...CONTACT_DTO,
            contact_id: '999',
          }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('event.contact_conflict');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('联系人取不到（已删 / 已合并）→ 400 `event.contact_missing`', async () => {
      const { service, repository } = createService({ contactOwners: [] });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('event.contact_missing');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('归属人是**别人** → 403 `contact_event.not_mine`，不落库（同 quickMark 联系人侧同判定）', async () => {
      const { service, repository } = createService({
        contactOwners: [{ id: CONTACT_ID, owner_id: OTHER }],
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('contact_event.not_mine');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('联系人**已挂公司**（`owner_id` 为 null）→ 同样是 403（那一列只有待关联的人有值，→ 需求 §6.1 ⑦）', async () => {
      const { service, repository } = createService({
        contactOwners: [{ id: CONTACT_ID, owner_id: null }],
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('contact_event.not_mine');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('有效沟通没写一句话结果 → 422 `event.summary_required`（与关系侧同一条规则）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordContactEvent(CONTACT_ID.toString(), {
            action_type: 'phone',
            outcome: 'advanced',
          }),
        ),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.constraint).toBe('event.summary_required');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('同内容重复提交 → 409（幂等键把 `relationId` 记为 null，同键判定照旧生效）', async () => {
      const { service, repository } = createService({ duplicated: eventRow({ relation_id: null }) });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.recordContactEvent(CONTACT_ID.toString(), CONTACT_DTO),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.constraint).toBe('uk_idem');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('quickMark：批量快速标记（M6-09）', () => {
    const QUICK_DTO = { relation_ids: ['11', '11', '12'], outcome: 'no_answer' };

    it('落库：`action_type=phone`、`summary=null`、**幂等键为空**（每次点击都该是一条独立记录）', async () => {
      const { service, repository, prisma } = createService();

      await runWithContext(contextOf(), () => service.quickMark(QUICK_DTO));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(data.action_type).toBe('phone');
      expect(data.summary).toBeNull();
      expect(data.outcome).toBe('no_answer');
      expect(data.owner_snapshot).toBe(OWNER);
      expect(data.source).toBe('manual');
      // ★ 关键：**不写幂等键** —— 若沿用写跟单那套「同内容同键」，
      //   第二天再打同一个号标记就会被判成 409「刚刚已经记过了」，统计直接失真
      expect(data.idempotency_key).toBeNull();
    });

    it('**不回写 `last_event_at`**（快速标记不算有效跟进，→ 需求 §6.3 / §十六 #44）', async () => {
      const { service, relation } = createService();

      await runWithContext(contextOf(), () => service.quickMark(QUICK_DTO));

      expect(relation.touchLastEventAt).not.toHaveBeenCalled();
    });

    it('批量：同一关系勾两次只落**一条**（去重）；条数如实返回', async () => {
      const { service, repository, relation } = createService();

      const result = await runWithContext(contextOf(), () => service.quickMark(QUICK_DTO));

      // 去重后是两条（11 / 12）→ 判两次可写、落两条
      expect(relation.requireWritableRelation).toHaveBeenCalledTimes(2);
      expect(repository.createEvent).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ marked: 2 });
    });

    it('参数：两组都空 → 400（`quick_mark.empty`）', async () => {
      const { service } = createService();

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() => service.quickMark({ outcome: 'no_answer' })),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('quick_mark.empty');
    });

    it('「待关联」联系人侧：**归我**的线索可标（`relation_id` 空、`owner_snapshot` 无可取故为 null）', async () => {
      const { service, repository } = createService();

      const result = await runWithContext(contextOf(), () =>
        service.quickMark({ contact_ids: ['7'], outcome: 'no_answer' }),
      );

      expect(result).toEqual({ marked: 1 });
      const data = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      // ★ 「待关联」阶段的正当形态：只绑联系人，`relation_id` 为空（→ 数据架构 D2）
      expect(data.relation_id).toBeNull();
      expect(data.contact_id).toBe(7n);
      expect(data.owner_snapshot).toBeNull();
      expect(data.idempotency_key).toBeNull();
    });

    it('「待关联」联系人侧：**不是我的**线索 → 403，整批不落库（→ 需求 §6.1 ⑦⑨「谁建的归谁」）', async () => {
      const { service, repository } = createService({
        contactOwners: [{ id: 7n, owner_id: OTHER }],
      });

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() => service.quickMark({ contact_ids: ['7'], outcome: 'no_answer' })),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('quick_mark.not_mine');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('「待关联」联系人侧：id 不存在 → 400（**不静默跳过**：否则「标了 9 条」却少一条）', async () => {
      const { service, repository } = createService({ contactOwners: [] });

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() => service.quickMark({ contact_ids: ['7'], outcome: 'no_answer' })),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('quick_mark.contact_missing');
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('越权 / 只读：C 域出口抛 403 → **整批不落库**（不做「跳过坏行、静默成功」）', async () => {
      const { service, repository } = createService({
        relationError: new AppError(ErrorCode.FORBIDDEN, 403, '无权操作该数据范围之外的业务关系', {
          constraint: 'out_of_scope',
        }),
      });

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() => service.quickMark(QUICK_DTO)),
      );

      expect(error.httpStatus).toBe(403);
      // ★ 判据：**先全判完再落库** —— 否则批量里混进一条别人的客户，会「标了一半才报错」
      expect(repository.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('activateContactRelation：关联公司并激活业务关系（M6-14 · D-29）', () => {
    const ACTIVATE_DTO = { company_id: '3', dept_id: '2', product_line_id: '1' };

    it('三件事都做：建关系（C）→ 写就职（B）→ 搬孤儿跟单（D）；出参＝关系项 ＋ `linked_events`', async () => {
      const { service, repository, relation, company } = createService({ linkedEvents: 2 });

      const result = await runWithContext(contextOf(), () =>
        service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
      );

      expect(relation.createRelation).toHaveBeenCalledWith({
        company_id: '3',
        dept_id: '2',
        product_line_id: '1',
      });
      expect(company.linkContactEmployment).toHaveBeenCalledWith({
        contactId: CONTACT_ID,
        companyId: 3n,
      });
      expect(repository.rehangOrphanEventsOfContact).toHaveBeenCalledWith(CONTACT_ID, RELATION_ID);
      expect(result).toMatchObject({ id: RELATION_ID, linked_events: 2 });
    });

    it('`position` 给了就透传（空串／不给＝不传这个键，交给 B 域按「没填职位」处理）', async () => {
      const given = createService();
      await runWithContext(contextOf(), () =>
        given.service.activateContactRelation(CONTACT_ID.toString(), {
          ...ACTIVATE_DTO,
          position: '采购经理',
        }),
      );
      expect(given.company.linkContactEmployment).toHaveBeenCalledWith({
        contactId: CONTACT_ID,
        companyId: 3n,
        position: '采购经理',
      });

      const omitted = createService();
      await runWithContext(contextOf(), () =>
        omitted.service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
      );
      expect(omitted.company.linkContactEmployment.mock.calls[0]?.[0]).not.toHaveProperty(
        'position',
      );
    });

    it('★ 顺序＝**先 C（建关系）后 B（写就职）**：反序会让 409 时的线索卡死（→ 方法头）', async () => {
      const { service, relation, company } = createService();

      await runWithContext(contextOf(), () =>
        service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
      );

      expect(relation.createRelation.mock.invocationCallOrder[0]).toBeLessThan(
        company.linkContactEmployment.mock.invocationCallOrder[0] as number,
      );
    });

    it('前置校验：「已挂过公司」（不是「待关联」）→ **409，且一行都不落**（防重复触发）', async () => {
      const { service, repository, relation, company } = createService({ contactLinked: true });

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() =>
          service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.constraint).toBe('company_contact.already_linked');
      // ★ 校验**在最前**：不建关系、不写就职、不搬跟单
      expect(relation.createRelation).not.toHaveBeenCalled();
      expect(company.linkContactEmployment).not.toHaveBeenCalled();
      expect(repository.rehangOrphanEventsOfContact).not.toHaveBeenCalled();
    });

    it('前置校验：联系人不存在 → **400，且一行都不落**', async () => {
      const { service, repository, relation } = createService({ contactMissing: true });

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() =>
          service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('company.contact_missing');
      expect(relation.createRelation).not.toHaveBeenCalled();
      expect(repository.rehangOrphanEventsOfContact).not.toHaveBeenCalled();
    });

    it('C 域抛 409（三元组已有活跃关系）→ **不写就职、不搬跟单**（这就是「先 C 后 B」的意义）', async () => {
      const { service, repository, company } = createService({
        createRelationError: new AppError(
          ErrorCode.RELATION_DUPLICATED,
          409,
          '该公司在该部门·产品线下已有归属，请走转交或协同',
          { constraint: 'uk_active_rel' },
        ),
      });

      const error = await runWithContext(contextOf(), () =>
        captureAppError(() =>
          service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.constraint).toBe('uk_active_rel');
      expect(company.linkContactEmployment).not.toHaveBeenCalled();
      expect(repository.rehangOrphanEventsOfContact).not.toHaveBeenCalled();
    });

    it('没有请求上下文 → 401（守卫没跑＝编程错误，不许静默写三张表）', async () => {
      const { service, relation } = createService();

      const error = await captureAppError(() =>
        service.activateContactRelation(CONTACT_ID.toString(), ACTIVATE_DTO),
      );

      expect(error.httpStatus).toBe(401);
      expect(relation.createRelation).not.toHaveBeenCalled();
    });
  });

  describe('listEvents：关系时间线（M4-08）', () => {
    it('**倒序**：出参顺序＝仓储返回顺序（倒序由仓储 `orderBy` 保证，service 不重排）', async () => {
      const rows = [
        eventRow({ id: 3n, event_at: new Date('2026-09-15T10:00:00Z') }),
        eventRow({ id: 2n, event_at: new Date('2026-09-14T10:00:00Z') }),
        eventRow({ id: 1n, event_at: new Date('2026-09-13T10:00:00Z') }),
      ];
      const { service } = createService({ rows });

      const result = await runWithContext(contextOf(), () =>
        service.listEvents(RELATION_ID.toString()),
      );

      expect(result.map((vo) => vo.id)).toEqual([3n, 2n, 1n]);
      expect(result.map((vo) => vo.event_at)).toEqual([
        new Date('2026-09-15T10:00:00Z').toISOString(),
        new Date('2026-09-14T10:00:00Z').toISOString(),
        new Date('2026-09-13T10:00:00Z').toISOString(),
      ]);
    });

    it('默认 `range=1m` → 只取近 30 天；`range=all` → 不带时间下界', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf(), () => service.listEvents(RELATION_ID.toString()));
      // ⚠ 假对象的 `jest.fn(async () => …)` 不声明形参，`.mock.calls[i]` 被推成 `[]` ——
      //   这里**显式断言**实参形状（顺手钉住「第 2 个参数就是时间下界」这个协议）
      const firstCall = repository.listEventsByRelation.mock.calls[0] as unknown as [
        bigint,
        Date | undefined,
        number,
      ];
      const since = firstCall[1];
      expect(since).toBeInstanceOf(Date);
      expect(Date.now() - (since as Date).getTime()).toBeGreaterThanOrEqual(29 * 24 * 3600 * 1000);

      await runWithContext(contextOf(), () => service.listEvents(RELATION_ID.toString(), 'all'));
      const secondCall = repository.listEventsByRelation.mock.calls[1] as unknown as [
        bigint,
        Date | undefined,
        number,
      ];
      expect(secondCall[1]).toBeUndefined();
    });

    it('**`branch` 以 owner 为界**（→ 决策 #30）：协同 / 他人写的都是 `sub`', async () => {
      const { service } = createService({ rows: [eventRow({ actor_id: OTHER })] });

      const [vo] = await runWithContext(contextOf(), () =>
        service.listEvents(RELATION_ID.toString()),
      );

      expect(vo?.branch).toBe('sub');
    });

    it('关系没有任何跟单 → 返回空数组，且**不去取跨域引用**（省一次往返）', async () => {
      const { service, org, company } = createService({ rows: [] });

      const result = await runWithContext(contextOf(), () =>
        service.listEvents(RELATION_ID.toString()),
      );

      expect(result).toEqual([]);
      expect(org.getEmployeeRefs).not.toHaveBeenCalled();
      expect(company.getContactRefs).not.toHaveBeenCalled();
    });

    it('引用取不到（员工停用 / 联系人已删）→ **`null`，不编名字**', async () => {
      const { service } = createService({
        rows: [eventRow({ actor_id: 999n, contact_id: 888n })],
      });

      const [vo] = await runWithContext(contextOf(), () =>
        service.listEvents(RELATION_ID.toString()),
      );

      expect(vo?.actor).toBeNull();
      expect(vo?.contact).toBeNull();
    });
  });

  // ===== M4-09 承诺（建 / 列 / 改）=====

  describe('createCommitment：建承诺（M4-09）', () => {
    const DTO = {
      party: 'me',
      ctype: 'deliver',
      content: '周三前把报价单发过去',
      due_at: '2026-09-16T00:00:00.000Z',
    };

    it('`owner_id` 取**关系的 owner**（承诺跟关系走，→ 需求 §5.2 / §8.1）', async () => {
      const { service, repository } = createService();

      const vo = await runWithContext(contextOf(), () =>
        service.createCommitment(RELATION_ID.toString(), DTO),
      );

      const written = repository.createCommitment.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written.owner_id).toBe(OWNER);
      expect(written.created_by).toBe(ME);
      expect(vo.party).toBe('me');
      expect(vo.due_at).toBe('2026-09-16T00:00:00.000Z');
    });

    it('关系**没有 owner**（已掉公海）→ 落到写它的这个人，不留空（`owner_id` 是必填列）', async () => {
      const { service, repository } = createService({ ownerId: null });

      await runWithContext(contextOf(), () => service.createCommitment(RELATION_ID.toString(), DTO));

      expect(repository.createCommitment.mock.calls[0]?.[0]).toMatchObject({ owner_id: ME });
    });

    it('关系不可写（C 域出口抛）→ 透传，**不落库、不自己再判一次权限**', async () => {
      const { service, repository } = createService({
        relationError: new AppError(ErrorCode.FORBIDDEN, 403, '无权限：他人私海'),
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.createCommitment(RELATION_ID.toString(), DTO)),
      );

      expect(error.httpStatus).toBe(403);
      expect(repository.createCommitment).not.toHaveBeenCalled();
    });

    it('`contact_id` 取不到引用 → **400** `commitment.contact_missing`，不落库', async () => {
      const { service, repository } = createService({ contactMissing: true });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.createCommitment(RELATION_ID.toString(), {
            ...DTO,
            contact_id: CONTACT_ID.toString(),
          }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('commitment.contact_missing');
      expect(repository.createCommitment).not.toHaveBeenCalled();
    });

    it('不给时间 → `due_at` / `remind_at` 落 `null`（服务端**不替销售定时间**）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf(), () =>
        service.createCommitment(RELATION_ID.toString(), {
          party: 'them',
          ctype: 'reply',
          content: '等他答复',
        }),
      );

      expect(repository.createCommitment.mock.calls[0]?.[0]).toMatchObject({
        due_at: null,
        remind_at: null,
      });
    });
  });

  describe('updateCommitment：兑现 / 取消 / 改期（M4-09）', () => {
    it('兑现 → `status=done` ＋ 写 `done_at` / `done_by`', async () => {
      const { service, repository } = createService();

      const vo = await runWithContext(contextOf(), () =>
        service.updateCommitment(RELATION_ID.toString(), {
          id: COMMITMENT_ID.toString(),
          status: 'done',
        }),
      );

      const written = repository.updateCommitment.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(written.status).toBe('done');
      expect(written.done_by).toBe(ME);
      expect(written.done_at).toBeInstanceOf(Date);
      expect(vo.status).toBe('done');
    });

    it('取消 → 只改状态，**不写兑现痕迹**（取消不是兑现）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf(), () =>
        service.updateCommitment(RELATION_ID.toString(), {
          id: COMMITMENT_ID.toString(),
          status: 'cancelled',
        }),
      );

      const written = repository.updateCommitment.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(written.status).toBe('cancelled');
      expect(written).not.toHaveProperty('done_at');
      // ★ 取消＝「录错了 / 不成立」（纠错）—— **不该带原因**（与豁免的分界，→ 需求 §10.1）
      expect(written).not.toHaveProperty('waive_reason');
    });

    it('豁免填了原因 → `status=waived` ＋ 落 `waive_reason`（首尾空白去掉）', async () => {
      const { service, repository } = createService();

      const vo = await runWithContext(contextOf(), () =>
        service.updateCommitment(RELATION_ID.toString(), {
          id: COMMITMENT_ID.toString(),
          status: 'waived',
          waive_reason: '  客户内部预算冻结，本季度不启动  ',
        }),
      );

      const written = repository.updateCommitment.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(written.status).toBe('waived');
      expect(written.waive_reason).toBe('客户内部预算冻结，本季度不启动');
      // 豁免不是兑现 —— 不留兑现痕迹
      expect(written).not.toHaveProperty('done_at');
      expect(vo.status).toBe('waived');
    });

    it('豁免**没填原因** → **422 / 20403**，不落库（→ 需求 §10.1「豁免必须填原因」）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.updateCommitment(RELATION_ID.toString(), {
            id: COMMITMENT_ID.toString(),
            status: 'waived',
          }),
        ),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCode.REQUIRED_MISSING);
      expect(error.constraint).toBe('commitment.waive_reason_required');
      expect(repository.updateCommitment).not.toHaveBeenCalled();
    });

    it('豁免只给**空白**原因 → 同样 422（空白不算「填了」）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.updateCommitment(RELATION_ID.toString(), {
            id: COMMITMENT_ID.toString(),
            status: 'waived',
            waive_reason: '   ',
          }),
        ),
      );

      expect(error.code).toBe(ErrorCode.REQUIRED_MISSING);
      expect(repository.updateCommitment).not.toHaveBeenCalled();
    });

    it('承诺**不属于**这条关系 → 400，不落库（不能拿 A 关系的入口改 B 的承诺）', async () => {
      const { service, repository } = createService({
        commitment: commitmentRow({ relation_id: 999n }),
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.updateCommitment(RELATION_ID.toString(), {
            id: COMMITMENT_ID.toString(),
            status: 'done',
          }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('commitment.not_found');
      expect(repository.updateCommitment).not.toHaveBeenCalled();
    });

    it('已兑现的承诺再改 → **422 / 20403**（防兑现记录被改回去）', async () => {
      const { service, repository } = createService({ commitment: commitmentRow({ status: 'done' }) });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.updateCommitment(RELATION_ID.toString(), {
            id: COMMITMENT_ID.toString(),
            status: 'cancelled',
          }),
        ),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCode.REQUIRED_MISSING);
      expect(repository.updateCommitment).not.toHaveBeenCalled();
    });

    it('改期 → 只动 `due_at`，**不动状态**', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf(), () =>
        service.updateCommitment(RELATION_ID.toString(), {
          id: COMMITMENT_ID.toString(),
          due_at: '2026-09-20T00:00:00.000Z',
        }),
      );

      const written = repository.updateCommitment.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(written.due_at).toEqual(new Date('2026-09-20T00:00:00.000Z'));
      expect(written).not.toHaveProperty('status');
    });
  });

  describe('listCommitments（M4-09）', () => {
    it('可见性走 C 域出口（`getRelation`），**D 域不自己算范围**', async () => {
      const { service, relation } = createService();

      await runWithContext(contextOf(), () => service.listCommitments(RELATION_ID.toString()));

      expect(relation.getRelation).toHaveBeenCalledWith(RELATION_ID.toString());
    });
  });

  // ===== M4-10 今日动线 =====

  describe('todayAgenda（M4-10）', () => {
    it('只查**本人**的当日条目，并把 `relation` / `contact` 引用装配出来', async () => {
      const { service, repository } = createService({ agenda: [agendaRow()] });

      const items = await runWithContext(contextOf(), () => service.todayAgenda());

      // 查的就是**本人**；日期按「今天」算（`biz_date` 是 DATE 列，只比日期）
      expect(repository.listAgendaOfUser).toHaveBeenCalledWith(ME, expect.any(Date), 100);
      expect(items).toHaveLength(1);
      expect(items[0]?.relation).toEqual({ id: RELATION_ID, name: COMPANY_NAME });
      expect(items[0]?.contact).toEqual({ id: CONTACT_ID, name: '张总' });
      expect(items[0]?.ref_type).toBe('commitment');
    });

    it('没有当日条目 → 空数组（本批**不实时组装**，也不假装有事）', async () => {
      const { service } = createService({ agenda: [] });

      expect(await runWithContext(contextOf(), () => service.todayAgenda())).toEqual([]);
    });

    it('「只有联系人、还没挂关系」的条目 → `relation` 为 `null`，**不编一个关系**', async () => {
      const { service } = createService({ agenda: [agendaRow({ relation_id: null })] });

      const [item] = await runWithContext(contextOf(), () => service.todayAgenda());

      expect(item?.relation).toBeNull();
      expect(item?.contact).toEqual({ id: CONTACT_ID, name: '张总' });
    });
  });

  // ===== M4-11 建档事件（C 域发 → D 域落首条事件）=====

  describe('recordRelationCreated（M4-11）', () => {
    const RELATION_CREATED = createDomainEvent({
      name: DomainEventName.RelationCreated,
      actorId: ME,
      aggregateId: RELATION_ID,
      payload: { ownerId: OWNER },
      occurredAt: new Date('2026-09-15T09:00:00Z'),
    });

    it('落一条 `system` 事件（带**确定性幂等键**与 `owner_snapshot`），且**不回写 `last_event_at`**', async () => {
      const { service, repository, relation } = createService();

      await service.recordRelationCreated(RELATION_CREATED);

      const written = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written).toMatchObject({
        relation_id: RELATION_ID,
        actor_id: ME,
        owner_snapshot: OWNER,
        action_type: 'system',
        source: 'system',
        idempotency_key: `relation_created:${RELATION_ID.toString()}`,
      });
      // ★ 建档是**系统动作**，不是「跟客户沟通过」——不许拿它刷掉海倒计时（→ 需求 §6.3）
      expect(relation.touchLastEventAt).not.toHaveBeenCalled();
    });

    it('同一条关系再投一次（至少一次投递）→ 预检命中即返回，**不重复落库**', async () => {
      const { service, repository } = createService({ duplicated: eventRow() });

      await service.recordRelationCreated(RELATION_CREATED);

      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('事件没带 `aggregateId` → **什么都不做**（不猜是哪条关系）', async () => {
      const { service, repository } = createService();

      await service.recordRelationCreated(
        createDomainEvent({ name: DomainEventName.RelationCreated, actorId: ME, payload: {} }),
      );

      expect(repository.createEvent).not.toHaveBeenCalled();
    });
  });

  // ===== M7-01 领取公海（F 域发 → D 域落事件 ＋ 转 open 承诺 owner）=====

  describe('recordRelationClaimed（M7-01）', () => {
    const CLAIMED_AT = new Date('2026-09-20T09:00:00Z');
    const CLAIMED = createDomainEvent({
      name: DomainEventName.RelationClaimed,
      // 领取人 ＝ 新 owner（承诺跟着他走，→ 需求 §8.1）
      actorId: OTHER,
      aggregateId: RELATION_ID,
      payload: { companyId: 3n, deptId: DEPT_ID, productLineId: 1n, prevOwnerId: ME },
      occurredAt: CLAIMED_AT,
    });

    it('落一条 `system` 事件（`owner_snapshot` ＝ **新 owner**）＋ **open 承诺全部转新 owner**，同一事务', async () => {
      const { service, repository, prisma, relation } = createService();

      await service.recordRelationClaimed(CLAIMED);

      const written = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written).toMatchObject({
        relation_id: RELATION_ID,
        actor_id: OTHER,
        owner_snapshot: OTHER,
        action_type: 'system',
        source: 'system',
        // ★ 幂等键**带发生时刻**：同一条关系反复「掉海 → 领回」是常态（→ 需求 §8.1）
        idempotency_key: `relation_claimed:${RELATION_ID.toString()}:${CLAIMED_AT.getTime()}`,
      });
      expect(repository.createEvent).toHaveBeenCalledWith(expect.anything(), { tx: true });
      // 承诺跟随关系走（接口 §5.6 尾）：一条 `updateMany` 全转，**同一事务**
      expect(repository.reassignOpenCommitments).toHaveBeenCalledWith(RELATION_ID, OTHER, {
        tx: true,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // 领取是**系统动作**，不是「跟客户沟通过」——不许拿它刷掉海倒计时（→ 需求 §6.3）
      expect(relation.touchLastEventAt).not.toHaveBeenCalled();
    });

    it('同一条事件再投一次（至少一次投递）→ 预检命中即返回，**事件与承诺都不再动**', async () => {
      const { service, repository } = createService({ duplicated: eventRow() });

      await service.recordRelationClaimed(CLAIMED);

      expect(repository.createEvent).not.toHaveBeenCalled();
      expect(repository.reassignOpenCommitments).not.toHaveBeenCalled();
    });

    it('**同一关系第二次领取**（时刻不同）→ 幂等键不同 ⇒ 照常落库（钉住「键带时刻」）', async () => {
      const { service, repository } = createService();

      await service.recordRelationClaimed(
        createDomainEvent({
          name: DomainEventName.RelationClaimed,
          actorId: OTHER,
          aggregateId: RELATION_ID,
          payload: {},
          occurredAt: new Date(CLAIMED_AT.getTime() + 1000),
        }),
      );

      const written = repository.createEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written['idempotency_key']).toBe(
        `relation_claimed:${RELATION_ID.toString()}:${CLAIMED_AT.getTime() + 1000}`,
      );
    });

    it('事件没带 `aggregateId` → **什么都不做**（不猜是哪条关系）', async () => {
      const { service, repository } = createService();

      await service.recordRelationClaimed(
        createDomainEvent({ name: DomainEventName.RelationClaimed, actorId: OTHER, payload: {} }),
      );

      expect(repository.createEvent).not.toHaveBeenCalled();
      expect(repository.reassignOpenCommitments).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// M5-07 管理员查看留痕（→ 需求 §4.2 ★ / §4.3 三：「管理员可查看业务数据，
//   但**每次查看写 `operation_log`**」）——走 `recordStandalone`（读路径无业务事务、best-effort）
// =============================================================================
describe('EngineService（M5-07 管理员查看留痕）', () => {
  it('管理员看跟单全文 → 写一条 `event.view`（谁 / 何时 / 看哪条关系）', async () => {
    const { service, audit } = createService();

    await runWithContext(contextOf({ type: 'all', roleCodes: ['admin'] }), () =>
      service.listEvents(RELATION_ID.toString()),
    );

    expect(audit.recordStandalone).toHaveBeenCalledTimes(1);
    expect(audit.recordStandalone.mock.calls[0]?.[0]).toMatchObject({
      action: 'event.view',
      target_type: 'business_relation',
      target_id: RELATION_ID,
    });
  });

  it('销售看自己的跟单 → **不留痕**（留痕是特权账号的护栏，不是全量访问日志）', async () => {
    const { service, audit } = createService();

    await runWithContext(contextOf({ type: 'self', roleCodes: ['sale'] }), () =>
      service.listEvents(RELATION_ID.toString()),
    );

    expect(audit.recordStandalone).not.toHaveBeenCalled();
  });

  it('留痕**不影响出参**：写了审计，跟单照常返回（读接口不被审计拖累）', async () => {
    const { service } = createService();

    const list = await runWithContext(contextOf({ type: 'all', roleCodes: ['admin'] }), () =>
      service.listEvents(RELATION_ID.toString()),
    );

    expect(list).toHaveLength(1);
  });
});

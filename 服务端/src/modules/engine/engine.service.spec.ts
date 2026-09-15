// =============================================================================
// D 域服务用例（M4-07 写跟单 / M4-08 关系时间线）—— **假数据，不连库**
//
// 为什么这样布局（`domain/**` 是纯规则，无框架 / ORM 依赖 → 假数据即可单测）：
//   · 判定类（有效沟通 / 回写 / 幂等键）→ `domain/*.spec.ts`（**无 IO**）；
//   · 编排类（先权限、再参数、再幂等、最后落库；跨域回写谁调）→ 本文件。
//
// 判据逐字（《过程产出/开发计划-V1.md》）：
//   · M4-07：「`recordEvent`（事务：写事件 + 条件回写 `last_event_at`）」
//            → 单测：**有效 → 改；无效 → 不改**。
//   · M4-08：「关系时间线（`GET /relations/:id/events`）」→ 单测：**倒序**。
// =============================================================================
import {
  AppError,
  ErrorCode,
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
}

function createService(options: FakeOptions = {}) {
  const repository = {
    createEvent: jest.fn(async (data: Record<string, unknown>) => {
      if (options.createError !== undefined) throw options.createError;
      return eventRow(data);
    }),
    findEventByIdempotencyKey: jest.fn(async () => options.duplicated ?? null),
    listEventsByRelation: jest.fn(async () => options.rows ?? [eventRow()]),
    createCommitment: jest.fn(async (data: Record<string, unknown>) => ({ id: 1n, ...data })),
    listCommitmentsByRelation: jest.fn(async () => []),
  };
  const relation = {
    // C 域跨域出口：**权限在这里判**（D 域不重复实现），单测只关心「它抛了 D 域就别往下走」
    requireWritableRelation: jest.fn(async () => {
      if (options.relationError !== null && options.relationError !== undefined) {
        throw options.relationError;
      }
      return { id: RELATION_ID, ownerId: OWNER };
    }),
    touchLastEventAt: jest.fn(async () => undefined),
    getRelation: jest.fn(async () => ({
      id: RELATION_ID,
      owner: { id: OWNER, name: '王海涛' },
    })),
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
  };
  const prisma = { $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })) };

  const service = new EngineService(
    repository as unknown as EngineRepository,
    relation as unknown as RelationService,
    org as unknown as OrgService,
    company as unknown as CompanyService,
    prisma as unknown as PrismaService,
  );

  return { service, repository, relation, org, company, prisma };
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
});

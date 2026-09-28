// =============================================================================
// 外出登记（visit）服务单测（M8-06 Phase 2-B）
//   · 用 **fake repository** 替换真实 Prisma（不连库，→ 架构 §5.4 分层纪律）
//   · 用 `runWithContext` 注入「我是谁」（→ kernel 横切层）
//   · 钉：建登落库 / 回来点一下（成功 / 404 / 已回 422）/ 列表（全部 / 某天）
// =============================================================================
import { runWithContext, type RequestContext } from '../../kernel/index';
import { AppError } from '../../kernel/index';
import { VisitService, type ListVisitQuery } from './visit.service';

const ME = 100n;
const DEPT_ID = 2n;

interface ContextOverride {
  roleCodes?: string[];
}

function contextOf(overrides: ContextOverride = {}): RequestContext {
  return {
    employeeId: ME,
    deptIds: [DEPT_ID],
    roleCodes: overrides.roleCodes ?? ['sales'],
    dataScope: { type: 'self', deptIds: [] },
  };
}

async function capture(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('期望抛 AppError，但调用成功返回了');
}

interface FakeOptions {
  visit?: Record<string, unknown> | null;
  visits?: Record<string, unknown>[];
}

function visitRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 11n,
    employee_id: ME,
    depart_at: new Date('2026-09-28T09:30:00Z'),
    reason: '拜访 A 客户',
    actual_return_at: null,
    relation_ids: null,
    created_at: new Date('2026-09-28T09:30:01Z'),
    ...over,
  };
}

function createService(options: FakeOptions = {}) {
  const repository = {
    createVisit: jest.fn(async (data: Record<string, unknown>) => visitRow({ ...data })),
    findById: jest.fn(async () => options.visit ?? null),
    returnVisit: jest.fn(async (id: bigint, at: Date, by: bigint) =>
      visitRow({ id, actual_return_at: at, updated_by: by }),
    ),
    listMyVisits: jest.fn(async () => options.visits ?? []),
  };
  const service = new VisitService(repository as never);
  return { service, repository };
}

describe('VisitService（M8-06 Phase 2-B）', () => {
  describe('createVisit（登记外出）', () => {
    it('正常：reason + relation_ids 落库，employee_id 取当前登录人', async () => {
      const { service, repository } = createService();

      const dto = await runWithContext(contextOf(), () =>
        service.createVisit({ depart_at: '2026-09-28T09:30:00', reason: '拜访 A 客户', relation_ids: [1001] }),
      );

      expect(repository.createVisit).toHaveBeenCalledWith({
        employee_id: ME,
        depart_at: expect.any(Date),
        reason: '拜访 A 客户',
        relation_ids: [1001],
      });
      expect(dto.id).toBe('11');
      expect(dto.employee_id).toBe('100');
      expect(dto.relation_ids).toEqual(['1001']);
      expect(dto.actual_return_at).toBeNull();
    });

    it('无 relation_ids → 归一成空数组（纯行踪登记）', async () => {
      const { service } = createService();

      const dto = await runWithContext(contextOf(), () =>
        service.createVisit({ depart_at: '2026-09-28T09:30:00', reason: '去工商局' }),
      );

      expect(dto.relation_ids).toEqual([]);
    });
  });

  describe('returnVisit（回来点一下）', () => {
    it('成功：写 actual_return_at（纯行政、不碰业务）', async () => {
      const { service, repository } = createService({ visit: visitRow({ actual_return_at: null }) });

      const dto = await runWithContext(contextOf(), () => service.returnVisit('11'));

      expect(repository.returnVisit).toHaveBeenCalledWith(11n, expect.any(Date));
      expect(dto.actual_return_at).not.toBeNull();
    });

    it('不是自己的 / 不存在 → 404', async () => {
      const { service, repository } = createService({ visit: null });

      const error = await capture(() => runWithContext(contextOf(), () => service.returnVisit('11')));
      expect(error.httpStatus).toBe(404);
      expect(error.constraint).toBe('visit.not_found');
      expect(repository.returnVisit).not.toHaveBeenCalled();
    });

    it('已回过的再点 → 422', async () => {
      const { service, repository } = createService({ visit: visitRow({ actual_return_at: new Date() }) });

      const error = await capture(() => runWithContext(contextOf(), () => service.returnVisit('11')));
      expect(error.httpStatus).toBe(422);
      expect(error.constraint).toBe('visit.already_returned');
      expect(repository.returnVisit).not.toHaveBeenCalled();
    });
  });

  describe('listMyVisits（我的外出记录）', () => {
    it('不传 date → 最近 50 条（不限定日期区间）', async () => {
      const { service, repository } = createService({ visits: [visitRow()] });

      const items = await runWithContext(contextOf(), () => service.listMyVisits({}));
      expect(repository.listMyVisits).toHaveBeenCalledWith(ME, undefined, undefined);
      expect(items).toHaveLength(1);
    });

    it('传 date → 转成本地日区间下传（YYYY-MM-DD 解析）', async () => {
      const { service, repository } = createService({ visits: [visitRow()] });

      await runWithContext(contextOf(), () => service.listMyVisits({ date: '2026-09-28' } as ListVisitQuery));
      expect(repository.listMyVisits).toHaveBeenCalledWith(ME, expect.any(Date), expect.any(Date));
    });

    it('date 格式非法 → 400', async () => {
      const { service } = createService();

      const error = await capture(() =>
        runWithContext(contextOf(), () => service.listMyVisits({ date: '09/28' } as ListVisitQuery)),
      );
      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('visit.date_format');
    });
  });
});

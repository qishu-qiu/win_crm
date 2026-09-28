// =============================================================================
// 报表/看板服务用例（M8-06 Phase 4 切片②）—— **假数据，不连库**
//
// 钉的是**编排**：权限（销售 403）、KPI 聚合、以及 `sea_todo` 复用 `SeaService.listManagerTodo()`
//（不重复实现规则解析）。5 个占位列表（pending_todo / warnings / dept_compare / top_sales /
// zombie_weekly）本版回 `[]`，形状待规格补全（→ 欠账 D-33 ⑤）。
// =============================================================================
import { AppError, type RequestContext, runWithContext } from '../../kernel/index';
import { type SeaManagerTodoResult, SeaService } from '../sea/sea.service';
import type { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

const DEPT_ID = 2n;
const RELATION_ID = 1n;

interface ServiceHarness {
  service: ReportService;
  repository: jest.Mocked<ReportRepository>;
  sea: jest.Mocked<SeaService>;
}

function createService(managerTodo?: SeaManagerTodoResult): ServiceHarness {
  const repository = {
    countTodayNew: jest.fn<Promise<number>, [readonly bigint[] | null, unknown]>(async () => 0),
    countTodayTodo: jest.fn<Promise<number>, [readonly bigint[] | null, unknown]>(async () => 0),
    sumMonthSigned: jest.fn<Promise<{ amount: number; chainRatio: number | null }>, [readonly bigint[] | null, unknown]>(
      async () => ({ amount: 0, chainRatio: null }),
    ),
  } as unknown as jest.Mocked<ReportRepository>;

  const sea = {
    listManagerTodo: jest.fn<Promise<SeaManagerTodoResult>, []>(async () => ({
      total: managerTodo?.total ?? 0,
      items: managerTodo?.items ?? [],
    })),
  } as unknown as jest.Mocked<SeaService>;

  return { service: new ReportService(repository, sea), repository, sea };
}

function managerContext(deptIds: bigint[] = [DEPT_ID]): RequestContext {
  return {
    userId: 7n,
    roles: ['dept_manager'],
    dataScope: { type: 'dept', deptIds },
    scopeNote: '',
  } as unknown as RequestContext;
}

function saleContext(): RequestContext {
  return { userId: 7n, roles: ['sale'], dataScope: { type: 'self' }, scopeNote: '' } as unknown as RequestContext;
}

describe('ReportService.getDashboard（M8-06 Phase 4 切片②）', () => {
  it('销售（self 范围）→ 403 / report.dashboard.forbidden，且不查库', async () => {
    const { service, repository, sea } = createService();

    const error = await runWithContext(saleContext(), async () => {
      try {
        await service.getDashboard();
        return null;
      } catch (e) {
        return e as AppError;
      }
    });

    expect((error as AppError | null)?.httpStatus).toBe(403);
    expect((error as AppError | null)?.constraint).toBe('report.dashboard.forbidden');
    expect(repository.countTodayNew).not.toHaveBeenCalled();
    expect(sea.listManagerTodo).not.toHaveBeenCalled();
  });

  it('经理 → 聚合 KPI ＋ 复用 sea_todo（占位列表回 `[]`）', async () => {
    const managerTodo: SeaManagerTodoResult = {
      total: 2,
      items: [
        {
          relation_id: RELATION_ID.toString(),
          company: null,
          dept: null,
          product_line: null,
          sea_entered_at: '2026-06-01T00:00:00.000Z',
          days_in_sea: 119,
          stay_days: 60,
          overdue_days: 59,
        },
      ],
    };
    const { service } = createService(managerTodo);

    const result = await runWithContext(managerContext([DEPT_ID]), () => service.getDashboard());

    expect(result.kpi).toBeDefined();
    expect(result.sea_todo.total).toBe(2);
    expect(result.pending_todo).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.dept_compare).toEqual([]);
    expect(result.top_sales).toEqual([]);
    expect(result.zombie_weekly).toEqual([]);
  });
});

// =============================================================================
// TargetService 单测（M8-06 Phase 4 切片 1）
//
// ⚠ 仓库层用 `$queryRaw`，这里用**假仓储**隔离（架构 §5.4：domain/编排层用假数据即可单测）。
// ★ 全工程 jest 受 **D-62（ESM）** 阻断暂跑不了；本文件先在位，待 D-62 修复后回归。
// =============================================================================
import { Prisma } from '../../generated/prisma/client';
import { runWithContext, type RequestContext } from '../../kernel/context/request-context';
import { TargetRepository } from './target.repository';
import { TargetService } from './target.service';

interface FakeOptions {
  targets?: { scope_type: string; scope_id: bigint; amount: Prisma.Decimal }[];
  amounts?: { signed: number; paid: number };
  name?: string;
}

function makeContext(over: Partial<RequestContext> = {}): RequestContext {
  return {
    employeeId: 1n,
    deptIds: [2n],
    roleCodes: ['manager'],
    dataScope: { type: 'dept', deptIds: [2n] },
    ...over,
  } as RequestContext;
}

function createService(opts: FakeOptions = {}) {
  const repository = {
    listTargetsByWhere: jest.fn(async () => opts.targets ?? []),
    sumContractAmountsByScope: jest.fn(async () => opts.amounts ?? { signed: 0, paid: 0 }),
    resolveScopeName: jest.fn(async () => opts.name ?? '部门2'),
  } as unknown as jest.Mocked<TargetRepository>;
  return { service: new TargetService(repository), repository };
}

describe('TargetService.getProgress（M8-06 Phase 4 切片 1）', () => {
  it('经理 → 返回管辖部门 + 本人员工目标进度（rate = paid / target）', async () => {
    const { service } = createService({
      targets: [{ scope_type: 'dept', scope_id: 2n, amount: new Prisma.Decimal(100) }],
      amounts: { signed: 80, paid: 60 },
      name: '华东区',
    });

    const result = await runWithContext(makeContext(), () => service.getProgress());

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      scope_type: 'dept',
      scope_id: '2',
      name: '华东区',
      target_amount: 100,
      paid_amount: 60,
      signed_amount: 80,
      rate: 0.6,
      diff_points: -40,
    });
    expect(result.stat_unit).toBe('company');
  });

  it('经理 → where 只含管辖部门 + 本人员工，不含他人', async () => {
    const { service, repository } = createService({
      targets: [{ scope_type: 'dept', scope_id: 2n, amount: new Prisma.Decimal(100) }],
    });

    await runWithContext(makeContext({ dataScope: { type: 'dept', deptIds: [2n, 3n] } }), () =>
      service.getProgress(),
    );

    const where = repository.listTargetsByWhere.mock.calls[0]?.[0] as {
      OR: { scope_type: string; scope_id: unknown }[];
    };
    expect(where.OR).toEqual([
      { scope_type: 'dept', scope_id: { in: [2n, 3n] } },
      { scope_type: 'employee', scope_id: 1n },
    ]);
  });

  it('老板/admin（all）→ where 含 company + 全部 dept 目标', async () => {
    const { service, repository } = createService();

    await runWithContext(makeContext({ dataScope: { type: 'all', deptIds: [] } }), () =>
      service.getProgress(),
    );

    const where = repository.listTargetsByWhere.mock.calls[0]?.[0] as {
      scope_type: { in: string[] };
      period: string;
    };
    expect(where.scope_type).toEqual({ in: ['company', 'dept'] });
  });

  it('销售（self 范围）→ 403 / target.progress.forbidden', async () => {
    const { service } = createService();

    const error = await runWithContext(makeContext({ dataScope: { type: 'self', deptIds: [] } }), () =>
      service.getProgress().then(
        () => null,
        (e) => e,
      ),
    );

    expect(error.httpStatus).toBe(403);
    expect(error.constraint).toBe('target.progress.forbidden');
  });
});

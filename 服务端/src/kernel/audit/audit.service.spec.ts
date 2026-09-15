import type { OperationLogUncheckedCreateInput } from '../../generated/prisma/models/OperationLog';
import type { PrismaService } from '../../prisma/prisma.service';
import { runWithContext, type RequestContext } from '../context/request-context';
import { ErrorCode } from '../errors/app-error';
import { AuditService } from './audit.service';
import { runInTransaction, type TransactionClient } from './transaction-context';

/**
 * `PrismaService` 假件：**只实现 `recordStandalone` 真正用到的那一个方法**
 * （`operationLog.create`）—— 假件按真实用到的形状造，多给字段只会让用例假绿（→ 铁律坑 16 / 21）。
 */
function standalonePrismaOf(
  create: (args: { data: OperationLogUncheckedCreateInput }) => Promise<unknown>,
): PrismaService {
  return { operationLog: { create } } as unknown as PrismaService;
}

/** 默认假件：写成功 */
const fakePrisma = standalonePrismaOf(() => Promise.resolve({ id: 1n }));

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeContext(employeeId = 1001n): RequestContext {
  return {
    employeeId,
    deptIds: [10n],
    roleCodes: ['sales'],
    dataScope: { type: 'self', deptIds: [10n] },
  };
}

/**
 * 假事务客户端：只实现审计真正用到的那一个方法。
 * `as unknown as TransactionClient` 是**刻意**的 —— 真实 `Prisma.TransactionClient` 带 46 张表的方法，
 * 测试不需要；而「真实客户端能不能喂给审计」已由生产代码本身卡住（`audit.service.ts` 里
 * `tx.operationLog.create({ data })` 直接对着真实 Prisma 类型编译）。
 */
function makeFakeTx(): { tx: TransactionClient; created: OperationLogUncheckedCreateInput[] } {
  const created: OperationLogUncheckedCreateInput[] = [];
  const tx = {
    operationLog: {
      create: (args: { data: OperationLogUncheckedCreateInput }): Promise<{ id: bigint }> => {
        created.push(args.data);
        return Promise.resolve({ id: BigInt(created.length) });
      },
    },
  } as unknown as TransactionClient;
  return { tx, created };
}

describe('M0-30 审计留痕（架构 §7.4 / CONSTRAINTS §二.4）', () => {
  it('计划判据：无事务上下文时抛错（500 / 20099，防审计逃逸）', async () => {
    const service = new AuditService(fakePrisma);
    await expect(service.record({ action: 'phone.unlock.view' })).rejects.toThrow(
      expect.objectContaining({
        httpStatus: 500,
        code: ErrorCode.INTERNAL,
        message: expect.stringContaining('事务'),
      }),
    );
  });

  it('有事务上下文：字段 1:1 写进 operation_log（Json / req_id / ip / ua 全透传）', async () => {
    const service = new AuditService(fakePrisma);
    const { tx, created } = makeFakeTx();
    const occurredAt = new Date('2026-09-14T10:00:00.000Z');

    await runWithContext(makeContext(), () =>
      runInTransaction(tx, async () => {
        await service.record({
          action: 'approval.approve',
          target_type: 'approval',
          target_id: 88n,
          before: { status: 'pending' },
          after: { status: 'approved' },
          detail: { comment: '同意' },
          operator_name: '张三',
          dept_id: 10n,
          product_line_id: 20n,
          req_id: 'req-1',
          ip: '127.0.0.1',
          user_agent: 'jest',
          occurred_at: occurredAt,
        });
      }),
    );

    expect(created).toEqual([
      {
        action: 'approval.approve',
        operator_id: 1001n, // 未显式传 → 取请求上下文
        operator_name: '张三',
        occurred_at: occurredAt,
        target_type: 'approval',
        target_id: 88n,
        before: { status: 'pending' },
        after: { status: 'approved' },
        detail: { comment: '同意' },
        dept_id: 10n,
        product_line_id: 20n,
        req_id: 'req-1',
        ip: '127.0.0.1',
        user_agent: 'jest',
      },
    ]);
  });

  it('未给的列不赋值（occurred_at 交给 DB 默认 now()，不自己造时间）', async () => {
    const service = new AuditService(fakePrisma);
    const { tx, created } = makeFakeTx();

    await runWithContext(makeContext(), () =>
      runInTransaction(tx, () => service.record({ action: 'org.login' })),
    );

    expect(created[0].occurred_at).toBeUndefined();
    expect(created[0].req_id).toBeUndefined();
    expect(created[0].target_id).toBeUndefined();
    expect(created[0].operator_id).toBe(1001n);
  });

  it('操作人：显式 operator_id 优先 —— 系统动作 0n 不会被记成当前登录用户', async () => {
    const service = new AuditService(fakePrisma);
    const { tx, created } = makeFakeTx();

    await runWithContext(makeContext(1001n), () =>
      runInTransaction(tx, () => service.record({ action: 'event.create', operator_id: 0n })),
    );

    expect(created[0].operator_id).toBe(0n);
  });

  it('系统动作合法路径：无请求上下文时显式传 0n 可以正常写（定时 / Worker 用）', async () => {
    const service = new AuditService(fakePrisma);
    const { tx, created } = makeFakeTx();

    await runInTransaction(tx, () => service.record({ action: 'sea.auto_release', operator_id: 0n }));

    expect(created).toHaveLength(1);
    expect(created[0].operator_id).toBe(0n);
  });

  it('无法确定操作人 → 抛错且**不写入**（不猜、不静默记成系统动作）', async () => {
    const service = new AuditService(fakePrisma);
    const { tx, created } = makeFakeTx();

    await expect(
      runInTransaction(tx, () => service.record({ action: 'event.create' })),
    ).rejects.toThrow(
      expect.objectContaining({
        httpStatus: 500,
        code: ErrorCode.INTERNAL,
        message: expect.stringContaining('operator_id'),
      }),
    );
    expect(created).toHaveLength(0);
  });

  it('两条并发事务互不串：各写各的 tx（审计用的是「当前事务」而非全局变量）', async () => {
    const service = new AuditService(fakePrisma);
    const first = makeFakeTx();
    const second = makeFakeTx();

    await Promise.all([
      runInTransaction(first.tx, async () => {
        await delay(5);
        await service.record({ action: 'sea.release', operator_id: 1n, detail: { tag: 'first' } });
      }),
      runInTransaction(second.tx, async () => {
        await delay(0);
        await service.record({ action: 'sea.release', operator_id: 2n, detail: { tag: 'second' } });
      }),
    ]);

    expect(first.created).toHaveLength(1);
    expect(first.created[0].operator_id).toBe(1n);
    expect(second.created).toHaveLength(1);
    expect(second.created[0].operator_id).toBe(2n);
  });

  it('审计写入失败 → 直接抛给调用方（业务事务一起回滚，不吞异常）', async () => {
    const service = new AuditService(fakePrisma);
    const failing = {
      operationLog: { create: () => Promise.reject(new Error('写审计失败')) },
    } as unknown as TransactionClient;

    await expect(
      runInTransaction(failing, () => service.record({ action: 'org.login', operator_id: 0n })),
    ).rejects.toThrow('写审计失败');
  });
});

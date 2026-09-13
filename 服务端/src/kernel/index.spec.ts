import * as kernel from '@/kernel';

describe('M0-31 kernel 汇总导出（架构 §5.2 / §5.4）', () => {
  it('计划判据：从 `@/kernel` 一个入口拿到全部内核能力（别名 + 汇总 + 各文件加载期都正常）', () => {
    // 异常与错误码
    expect(typeof kernel.AppError).toBe('function');
    expect(kernel.ErrorCode.INTERNAL).toBe(20099);
    // 通用工具
    expect(typeof kernel.resolvePagination).toBe('function');
    expect(typeof kernel.buildPageResult).toBe('function');
    expect(typeof kernel.bigintToJson).toBe('function');
    expect(typeof kernel.jsonToBigint).toBe('function');
    expect(typeof kernel.toJsonSafe).toBe('function');
    // 请求上下文
    expect(typeof kernel.runWithContext).toBe('function');
    expect(typeof kernel.requireRequestContext).toBe('function');
    expect(typeof kernel.ContextService).toBe('function');
    expect(kernel.ContextModule).toBeDefined();
    // 领域事件
    expect(kernel.DomainEventName.RelationCreated).toBe('RelationCreated');
    expect(typeof kernel.createDomainEvent).toBe('function');
    expect(typeof kernel.EventBus).toBe('function');
    // 审计与事务（Prisma 错误映射器亦随命名空间一并加载，加载期不抛）
    expect(typeof kernel.runInTransaction).toBe('function');
    expect(typeof kernel.requireTransactionClient).toBe('function');
    expect(typeof kernel.AuditService).toBe('function');
  });
});

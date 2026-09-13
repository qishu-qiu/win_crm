import { AppError, ErrorCode } from '../errors/app-error';
import {
  getRequestContext,
  requireRequestContext,
  runWithContext,
  setRequestContext,
  type DataScopeType,
  type RequestContext,
} from './request-context';

/** 造上下文：字段名照《架构设计说明》§7.1（不是计划行概写的 userId / roles / scope） */
function makeContext(employeeId = 1001n, scopeType: DataScopeType = 'self'): RequestContext {
  return {
    employeeId,
    deptIds: [10n, 20n],
    roleCodes: ['sales'],
    dataScope: { type: scopeType, deptIds: [10n, 20n] },
  };
}

/** 断言抛出的是 AppError 并把它取回来（避免 any / 类型断言） */
function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('期望抛 AppError，实际没抛');
}

describe('M0-26 请求上下文（架构 §7.1）', () => {
  it('计划判据：async 链内可读回（跨 await / 微任务 / 定时器回调）', async () => {
    const context = makeContext();
    const seen = await runWithContext(context, async () => {
      const before = getRequestContext();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return [before, getRequestContext()];
    });
    expect(seen[0]).toBe(context);
    expect(seen[1]).toBe(context);
  });

  it('requireRequestContext 有上下文时返回同一个对象', async () => {
    const context = makeContext(7n);
    const got = await runWithContext(context, async () => {
      await Promise.resolve();
      return requireRequestContext();
    });
    expect(got).toBe(context);
  });

  it('链外读不到：get 返回 undefined，require 抛 AppError（500 / 20099，不静默降级）', () => {
    expect(getRequestContext()).toBeUndefined();
    const error = catchAppError(() => requireRequestContext());
    expect(error.httpStatus).toBe(500);
    expect(error.code).toBe(ErrorCode.INTERNAL);
    expect(error.message).toContain('缺少请求上下文');
  });

  it('并发两条链互不串（各读回自己的上下文）', async () => {
    const first = makeContext(1n);
    const second = makeContext(2n, 'dept');
    const [idA, idB] = await Promise.all([
      runWithContext(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getRequestContext()?.employeeId;
      }),
      runWithContext(second, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getRequestContext()?.employeeId;
      }),
    ]);
    expect(idA).toBe(1n);
    expect(idB).toBe(2n);
  });

  it('嵌套 run：内层覆盖、外层不受影响', async () => {
    const outer = makeContext(1n);
    const inner = makeContext(2n, 'all');
    const result = await runWithContext(outer, async () => {
      const before = getRequestContext();
      const inside = await runWithContext(inner, async () => getRequestContext());
      return { before, inside, after: getRequestContext() };
    });
    expect(result.before).toBe(outer);
    expect(result.inside).toBe(inner);
    expect(result.after).toBe(outer);
  });

  it('守卫用法：setRequestContext（enterWith）后本链可读回（→ M0-32 解 JWT 后填上下文）', async () => {
    const context = makeContext(9527n, 'dept');
    setRequestContext(context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getRequestContext()).toBe(context);
    expect(requireRequestContext()).toBe(context);
  });
});

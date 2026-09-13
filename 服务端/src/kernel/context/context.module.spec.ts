import { NestFactory } from '@nestjs/core';

import { ErrorCode } from '../errors/app-error';
import { ContextModule, ContextService } from './context.module';
import { type RequestContext } from './request-context';

function makeContext(employeeId = 1001n): RequestContext {
  return {
    employeeId,
    deptIds: [10n],
    roleCodes: ['sales'],
    dataScope: { type: 'self', deptIds: [10n] },
  };
}

describe('M0-27 上下文模块（架构 §7.1 / §5.4）', () => {
  it('模块能真启动：ContextModule 解析出 ContextService（M0-49 的装配前置）', async () => {
    const app = await NestFactory.createApplicationContext(ContextModule, { logger: false });
    try {
      expect(app.get(ContextService)).toBeInstanceOf(ContextService);
    } finally {
      await app.close();
    }
  });

  it('ContextService 是薄适配：run 内读回同一上下文（逻辑唯一在 request-context.ts）', async () => {
    const service = new ContextService();
    const context = makeContext();
    const got = await service.run(context, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return service.get();
    });
    expect(got).toBe(context);
  });

  it('链外 get() 为 undefined；require() 抛 500 / 20099（不静默降级）', () => {
    const service = new ContextService();
    expect(service.get()).toBeUndefined();
    expect(() => service.require()).toThrow(
      expect.objectContaining({ httpStatus: 500, code: ErrorCode.INTERNAL }),
    );
  });

  it('set()（鉴权守卫用法，→ M0-32）后本链可读回', async () => {
    const service = new ContextService();
    const context = makeContext(9527n);
    service.set(context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.require()).toBe(context);
  });
});

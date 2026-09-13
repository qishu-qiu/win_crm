// =============================================================================
// 数据范围拦截器用例（M0-36，**占位版**）
// 判据：只读上下文打标；**mock Prisma 未被调用**。
//
// ★ 「不碰库」怎么证才硬（本文件的做法，含一次实测踩坑记录）：
//   曾试图把「库访问绊线 Proxy」放进容器，读它任何属性就抛 —— **行不通**：
//   Nest 的 `callModuleInitHook` 会对容器里**每一个 provider** 读 `onModuleInit` /
//   `onModuleDestroy` 等生命周期钩子（@nestjs/core/hooks/on-module-init.hook.js），
//   绊线会被框架自省误伤而炸，与「业务有没有查库」毫无关系。
//   改用两条**不受框架干扰**的证明：
//     ① 容器里**根本不放**任何库客户端也能装配成功 —— 若本类注入 PrismaService / repository，
//        Nest 此刻会直接报依赖解析失败；
//     ② 本类的构造依赖**只有一个**（ContextService）—— 谁给它加第二个依赖（如 PrismaService），
//        这里立刻变红。
//   这比「跑一遍看它碰没碰」更确定：它证明的是「**不可能**查库」，而不只是「这一次没查」。
//
// ⚠ 装配用 `NestFactory.createApplicationContext`（真启动 Nest 容器），**不用** `@nestjs/testing`：
//   实测该包未安装（M0-02 装了 Jest 但没装它）；装依赖要执行令，而 createApplicationContext
//   是 @nestjs/core 自带、零新依赖，且走的就是真实注册路径。
// =============================================================================
import { type CallHandler, type ExecutionContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { ContextModule, ContextService, type RequestContext } from '../../kernel/index';
import { DATA_SCOPE_REQUEST_KEY, DataScopeInterceptor, readDataScope } from './data-scope.interceptor';

const CONTEXT: RequestContext = {
  employeeId: 7n,
  deptIds: [1n, 2n],
  roleCodes: ['dept_manager'],
  dataScope: { type: 'dept', deptIds: [1n, 2n] },
};

/** 装配探针：只提供 ContextService ＋ 本拦截器（**没有任何库客户端**） */
@Module({ imports: [ContextModule], providers: [DataScopeInterceptor] })
class DataScopeProbeModule {}

function createHttpContext(): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers: {} };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const passthrough: CallHandler = { handle: () => of('handler-result') };

describe('数据范围拦截器（M0-36 占位版）', () => {
  it('存在请求上下文时：把数据范围原样打标到请求上，并放行 handler 结果', async () => {
    const contexts = new ContextService();
    const interceptor = new DataScopeInterceptor(contexts);
    const { context, request } = createHttpContext();

    const result = await contexts.run(CONTEXT, () => firstValueFrom(interceptor.intercept(context, passthrough)));

    expect(result).toBe('handler-result');
    expect(request[DATA_SCOPE_REQUEST_KEY]).toEqual({ type: 'dept', deptIds: [1n, 2n] });
    expect(readDataScope(request)).toEqual({ type: 'dept', deptIds: [1n, 2n] });
  });

  it('拿不到上下文时**不猜、不放行、不兜底**：不打标（宁可不返回，也不默认全量）', async () => {
    const contexts = new ContextService();
    jest.spyOn(contexts, 'get').mockReturnValue(undefined);
    const interceptor = new DataScopeInterceptor(contexts);
    const { context, request } = createHttpContext();

    await firstValueFrom(interceptor.intercept(context, passthrough));

    expect(request).not.toHaveProperty(DATA_SCOPE_REQUEST_KEY);
    expect(readDataScope(request)).toBeUndefined();
  });

  it('非 HTTP 上下文（Worker）：直接放行，不做任何打标', async () => {
    const interceptor = new DataScopeInterceptor(new ContextService());
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(firstValueFrom(interceptor.intercept(context, passthrough))).resolves.toBe('handler-result');
  });

  it('readDataScope 对脏值不认（请求被别的中间件塞了同名字段时不会误用）', () => {
    expect(readDataScope({ [DATA_SCOPE_REQUEST_KEY]: { type: 'company', deptIds: [] } })).toBeUndefined();
    expect(readDataScope({ [DATA_SCOPE_REQUEST_KEY]: 'dept' })).toBeUndefined();
    expect(readDataScope(undefined)).toBeUndefined();
  });

  describe('装配护栏：本类**不可能**查库（判据：mock Prisma 未被调用）', () => {
    it('容器里没有任何库客户端也能装配成功（若注入 PrismaService / repository，这里会报依赖解析失败）', async () => {
      const app = await NestFactory.createApplicationContext(DataScopeProbeModule, { logger: false });

      expect(app.get(DataScopeInterceptor)).toBeInstanceOf(DataScopeInterceptor);
      await app.close();
    });

    it('构造依赖恒为 1 个（只有 ContextService）：谁给它挂上第二个依赖，这里立刻变红', () => {
      // 用构造参数个数而非 design:paramtypes 元数据：不依赖 emitDecoratorMetadata，也不怕编译选项变动
      expect(DataScopeInterceptor.length).toBe(1);
    });
  });
});

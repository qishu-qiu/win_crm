// =============================================================================
// 脱敏拦截器用例（M0-37，**占位版**）
// 判据：出口统一处理的位置已就位；**mock Prisma 未被调用**。
// ★ 本套件刻意**不**断言任何脱敏规则 —— 规则还没设计（M5），现在编一条断言＝把猜测固化成契约。
//   这里只锁两件确定的事：① 占位版不改数据；② 它没有、也不该有库依赖。
//
// ★ 「不碰库」的证法与踩坑同 data-scope.interceptor.spec.ts 顶部说明：
//   不能把「库访问绊线 Proxy」放进容器（会被 Nest 的生命周期钩子自省误伤），
//   改用「容器里无库客户端也能装配」＋「构造依赖个数为 0」两条硬证。
// =============================================================================
import { type CallHandler, type ExecutionContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { DESENSITIZE_EXEMPT_KEY, DesensitizeInterceptor } from './desensitize.interceptor';

const PAYLOAD = { id: '1', phone: '13800001111', amount: '12345.67' };

/** 装配探针：本拦截器零依赖（容器里**没有任何库客户端**） */
@Module({ providers: [DesensitizeInterceptor] })
class DesensitizeProbeModule {}

const passthrough = (data: unknown): CallHandler => ({ handle: () => of(data) });

function createContext(type: 'http' | 'rpc' = 'http'): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

describe('脱敏拦截器（M0-37 占位版）', () => {
  it('占位版原样放行：不改数据、不换引用（M5 才会真正处理出口）', async () => {
    const interceptor = new DesensitizeInterceptor();

    const result = await firstValueFrom(interceptor.intercept(createContext(), passthrough(PAYLOAD)));

    expect(result).toBe(PAYLOAD);
    expect(result).toEqual({ id: '1', phone: '13800001111', amount: '12345.67' });
  });

  it('非 HTTP 上下文同样放行（Worker 出口不经此层）', async () => {
    const interceptor = new DesensitizeInterceptor();

    await expect(firstValueFrom(interceptor.intercept(createContext('rpc'), passthrough('x')))).resolves.toBe('x');
  });

  it('豁免标记的键名已固化（M5 的报表 / 看板出口按这个键豁免，→ 架构 §7.3）', () => {
    expect(DESENSITIZE_EXEMPT_KEY).toBe('desensitize:exempt');
  });

  describe('装配护栏：本类**不可能**查库（判据：mock Prisma 未被调用）', () => {
    it('容器里没有库客户端也能装配成功（若注入 PrismaService / repository，这里会报依赖解析失败）', async () => {
      const app = await NestFactory.createApplicationContext(DesensitizeProbeModule, { logger: false });

      expect(app.get(DesensitizeInterceptor)).toBeInstanceOf(DesensitizeInterceptor);
      await app.close();
    });

    it('构造依赖恒为 0 个：谁给它挂上任何依赖（如 PrismaService），这里立刻变红', () => {
      expect(DesensitizeInterceptor.length).toBe(0);
    });
  });
});

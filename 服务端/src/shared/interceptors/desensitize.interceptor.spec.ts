// =============================================================================
// 脱敏拦截器用例（M5-04 / M5-06 判据）
//
// 判据逐字（《开发计划-V1》）：
//   M5-04「填充 `desensitize.interceptor`：**详情给全号 / 列表·卡片给 `phone_masked` /
//          被 owner 上锁时给 `phone_locked`**」（→ 该判据的落点在**各域出口**，见下 ★）
//   M5-06「出口白名单：报表 / 看板 / 汇总**不脱敏**」（→ 本层读 `@DesensitizeExempt()` 标记）
//   M5-09「脱敏按部门判、**报表不脱敏** —— 单测红线通过」
//
// ★ 本套件**只锁拦截器真正负责的那两件事**：
//     ① 豁免路由 / 普通路由**都原样放行**（本层**不改数据、不换引用**）；
//     ② 豁免标记**打标到请求上**，且键名与读法只有一个落点（kernel）。
//   **不断言任何字段级脱敏规则** —— 那些规则不在本层（拦截器拿不到「记录属于谁」），
//   把它们写在这里＝**把猜测固化成契约**（M0-37 当初就是为此才刻意不猜）。
//   字段级证据在别处：`kernel/common/desensitize.spec.ts`（按部门判）＋
//   `modules/company/domain/contact-lock.spec.ts`（联系人「锁」）。
//
// ★ 「不碰库」的证法与踩坑同 `data-scope.interceptor.spec.ts` 顶部说明：
//   不能把「库访问绊线 Proxy」放进容器（会被 Nest 的生命周期钩子自省误伤），
//   改用「容器里无库客户端也能装配」＋「构造依赖个数为 0」两条硬证。
// ★ 假执行上下文按**真实形状**造（`getType` / `getHandler` / `getClass` / `switchToHttp` 一个不少）
//   —— 假件比真形状少字段＝假红（→ 踩坑 #16）。
// =============================================================================
import { type CallHandler, type ExecutionContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import {
  DESENSITIZE_EXEMPT_KEY,
  DESENSITIZE_EXEMPT_REQUEST_KEY,
  DesensitizeExempt,
  readDesensitizeExempt,
} from '../../kernel/index';
import { DesensitizeInterceptor } from './desensitize.interceptor';

const PAYLOAD = { id: '1', phone: '13800001111', amount: '12345.67' };

/** 装配探针：本拦截器零依赖（容器里**没有任何库客户端**） */
@Module({ providers: [DesensitizeInterceptor] })
class DesensitizeProbeModule {}

/** 真被装饰过的两个出口：一个标了豁免（报表），一个没标（列表） */
class ReportProbeController {
  @DesensitizeExempt()
  salesReport(): void {}

  listRelations(): void {}
}

const passthrough = (data: unknown): CallHandler => ({ handle: () => of(data) });

/** 假请求：`switchToHttp().getRequest()` 返回它，用来断言「打标」确实落在请求上 */
type FakeRequest = Record<string, unknown>;

function createContext(options: { type?: 'http' | 'rpc'; handler?: unknown; request?: FakeRequest } = {}): {
  context: ExecutionContext;
  request: FakeRequest;
} {
  const request: FakeRequest = options.request ?? {};
  const context = {
    getType: () => options.type ?? 'http',
    getHandler: () => options.handler,
    getClass: () => ReportProbeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('脱敏拦截器（M5-04 / M5-06）', () => {
  it('普通出口（未标豁免）原样放行：**不改数据、不换引用**（字段级脱敏在各域出口）', async () => {
    const interceptor = new DesensitizeInterceptor();
    const { context, request } = createContext({ handler: ReportProbeController.prototype.listRelations });

    const result = await firstValueFrom(interceptor.intercept(context, passthrough(PAYLOAD)));

    expect(result).toBe(PAYLOAD);
    expect(result).toEqual({ id: '1', phone: '13800001111', amount: '12345.67' });
    // 非豁免出口**不打标**（标记只表达「本出口不适用脱敏口径」）
    expect(request[DESENSITIZE_EXEMPT_REQUEST_KEY]).toBeUndefined();
  });

  it('★ M5-06 豁免出口（报表 / 看板 / 汇总）：原样放行 ＋ 豁免标记打标到请求上', async () => {
    const interceptor = new DesensitizeInterceptor();
    const { context, request } = createContext({ handler: ReportProbeController.prototype.salesReport });

    const result = await firstValueFrom(interceptor.intercept(context, passthrough(PAYLOAD)));

    expect(result).toBe(PAYLOAD);
    expect(readDesensitizeExempt(request)).toBe(true);
  });

  it('非 HTTP 上下文（Worker 出口不经此层）同样放行、不打标', async () => {
    const interceptor = new DesensitizeInterceptor();
    const { context, request } = createContext({
      type: 'rpc',
      handler: ReportProbeController.prototype.salesReport,
    });

    await expect(firstValueFrom(interceptor.intercept(context, passthrough('x')))).resolves.toBe('x');
    expect(readDesensitizeExempt(request)).toBe(false);
  });

  it('取不到 handler（异常上下文）→ 按**不豁免**处理，不抛错（白名单式：忘标＝按脱敏走）', async () => {
    const interceptor = new DesensitizeInterceptor();
    const { context, request } = createContext({ handler: undefined });

    await expect(firstValueFrom(interceptor.intercept(context, passthrough(PAYLOAD)))).resolves.toBe(PAYLOAD);
    expect(readDesensitizeExempt(request)).toBe(false);
  });

  it('键名已固化、且**只有一处落点**（kernel；横切层与出口侧读同一把键，→ 踩坑 #9）', () => {
    expect(DESENSITIZE_EXEMPT_KEY).toBe('desensitize:exempt');
    expect(DESENSITIZE_EXEMPT_REQUEST_KEY).toBe('desensitizeExempt');
    expect(readDesensitizeExempt(null)).toBe(false);
    expect(readDesensitizeExempt({ [DESENSITIZE_EXEMPT_REQUEST_KEY]: 'yes' })).toBe(false);
  });

  describe('装配护栏：本类**不可能**查库', () => {
    it('容器里没有库客户端也能装配成功（若注入 PrismaService / repository，这里会报依赖解析失败）', async () => {
      const app = await NestFactory.createApplicationContext(DesensitizeProbeModule, { logger: false });

      expect(app.get(DesensitizeInterceptor)).toBeInstanceOf(DesensitizeInterceptor);
      await app.close();
    });

    it('构造依赖恒为 0 个：谁给它挂上任何依赖（含 `Reflector`），这里立刻变红', () => {
      expect(DesensitizeInterceptor.length).toBe(0);
    });
  });
});

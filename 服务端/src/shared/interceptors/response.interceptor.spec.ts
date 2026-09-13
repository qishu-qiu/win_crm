// =============================================================================
// 统一响应拦截器用例（M0-33）
// 判据：输出字段与《接口API文档》§二 一致 —— 即**恰好** `{code, message, request_id, data}` 四个。
// =============================================================================
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { ResponseInterceptor, REQUEST_ID_HEADER, resolveRequestId, SUCCESS_MESSAGE } from './response.interceptor';

interface FakeResponse {
  readonly headers: Record<string, string>;
}

/** 造一个「HTTP 执行上下文」的最小替身：本拦截器只用到请求头与响应 setHeader */
function createHttpContext(requestHeaders: Record<string, unknown>): { context: ExecutionContext; response: FakeResponse } {
  const headers: Record<string, string> = {};
  const request = { headers: requestHeaders };
  const response = { headers, setHeader: (name: string, value: string) => void (headers[name] = value) };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { context, response };
}

function callHandlerReturning(data: unknown): CallHandler {
  return { handle: () => of(data) };
}

/** 造一个非 HTTP 上下文（Worker）：没有请求头可取 */
function createRpcContext(): ExecutionContext {
  return { getType: () => 'rpc' } as unknown as ExecutionContext;
}

describe('统一响应拦截器（M0-33）', () => {
  const interceptor = new ResponseInterceptor();

  it('成功响应恰好四个字段：code=0 / message=ok / request_id / data（→ §2.3）', async () => {
    const { context } = createHttpContext({});

    const envelope = await firstValueFrom(interceptor.intercept(context, callHandlerReturning({ id: '1' })));

    expect(Object.keys(envelope).sort()).toEqual(['code', 'data', 'message', 'request_id']);
    expect(envelope.code).toBe(0);
    expect(envelope.message).toBe(SUCCESS_MESSAGE);
    expect(envelope.data).toEqual({ id: '1' });
    expect(typeof envelope.request_id).toBe('string');
  });

  it('handler 返回 void 时 data 为 null —— 不能是 undefined（JSON 会整个丢掉该键，只剩三个字段）', async () => {
    const { context } = createHttpContext({});

    const envelope = await firstValueFrom(interceptor.intercept(context, callHandlerReturning(undefined)));

    expect(Object.keys(envelope).sort()).toEqual(['code', 'data', 'message', 'request_id']);
    expect(envelope.data).toBeNull();
    // 反证：真序列化一遍，确认四个键都还在（这才是前端实际收到的东西）
    expect(Object.keys(JSON.parse(JSON.stringify(envelope)) as object).sort()).toEqual([
      'code',
      'data',
      'message',
      'request_id',
    ]);
  });

  it('复用上游传来的 X-Request-Id，并回吐到响应头（同一条链路可追踪）', async () => {
    const { context, response } = createHttpContext({ [REQUEST_ID_HEADER]: 'gateway-trace-001' });

    const envelope = await firstValueFrom(interceptor.intercept(context, callHandlerReturning('ok')));

    expect(envelope.request_id).toBe('gateway-trace-001');
    expect(response.headers[REQUEST_ID_HEADER]).toBe('gateway-trace-001');
  });

  it('非 HTTP 上下文（Worker）不报错：没有请求头也照样能包', async () => {
    const envelope = await firstValueFrom(interceptor.intercept(createRpcContext(), callHandlerReturning(1)));

    expect(envelope.code).toBe(0);
    expect(envelope.request_id).toMatch(/^r-/);
  });

  // 本拦截器不依赖任何 DI（无 Prisma / 无 ContextService）；顺手证明它不会误读上下文
  it('不依赖 Reflector 等外部注入即可构造（构造签名只有零个参数）', () => {
    expect(new ResponseInterceptor()).toBeInstanceOf(ResponseInterceptor);
    expect(new Reflector()).toBeDefined();
  });

  describe('resolveRequestId 的取舍', () => {
    it('合规的上游 id 原样复用', () => {
      expect(resolveRequestId('abc-123_XY.Z')).toBe('abc-123_XY.Z');
    });

    it.each([
      ['空串', ''],
      ['纯空白', '   '],
      ['含空格', 'a b'],
      ['含换行（响应头注入面）', 'a\r\nX-Evil: 1'],
      ['超长', 'x'.repeat(129)],
      ['非字符串', 123],
    ])('%s → 丢弃并自生成 r- 前缀 id', (_name, raw) => {
      const generated = resolveRequestId(raw);

      expect(generated).toMatch(/^r-/);
      expect(generated).not.toBe(raw);
    });

    it('连续两次生成的 id 不重复', () => {
      expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
    });
  });
});

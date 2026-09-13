// =============================================================================
// 鉴权守卫用例（M0-32）
// 判据：无 token → 401；且「解 JWT → 填 context」真的把上下文塞进去了。
// ★ 这里用**真 JwtService 真签名真验签**（不 mock SDK）：mock 掉 JwtService 就只能证明
//   「我调用了它」，证明不了「签名与有效期真的被校验了」—— 后者才是守卫的价值。
// =============================================================================
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { AppError, ContextService, ErrorCode, toClaims, type RequestContext } from '../../kernel/index';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { extractBearerToken, JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'unit-test-secret-'.padEnd(48, 'x');
const OTHER_SECRET = 'another-secret-'.padEnd(48, 'y');

const CONTEXT: RequestContext = {
  employeeId: 7n,
  deptIds: [1n, 2n],
  roleCodes: ['sales'],
  dataScope: { type: 'dept', deptIds: [1n, 2n] },
};

/** 造一个 HTTP 执行上下文的最小替身（守卫只用得上 headers / getType / 元数据目标） */
function createHttpContext(
  headers: Record<string, unknown>,
  handler: (...args: unknown[]) => unknown = function probeHandler(): void {},
): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class ProbeController {},
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

/** 非 HTTP 上下文（Worker / 微服务）：**同样是完整形状**（真实 Nest 上下文一定有 getHandler / getClass） */
function createRpcContext(): ExecutionContext {
  return {
    getType: () => 'rpc',
    getHandler: () => function rpcHandler(): void {},
    getClass: () => class RpcController {},
  } as unknown as ExecutionContext;
}

describe('鉴权守卫（M0-32）', () => {
  let contexts: ContextService;
  let signer: JwtService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    contexts = new ContextService();
    signer = new JwtService({ secret: SECRET });
    guard = new JwtAuthGuard(new JwtService({ secret: SECRET }), contexts, new Reflector());
  });

  /** 判据本体：无 token → 401 / 20002 */
  it('没有 Authorization 头 → 401 / 20002，人话不泄露内部细节', () => {
    expect.assertions(3);
    try {
      guard.canActivate(createHttpContext({}));
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).httpStatus).toBe(401);
      expect((error as AppError).code).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });

  it.each([
    ['空字符串', ''],
    ['只有 Bearer', 'Bearer'],
    ['Bearer 后无内容', 'Bearer   '],
    ['用了 Basic 方案（不是我们的令牌）', 'Basic dXNlcjpwYXNz'],
    ['裸 token（漏了 Bearer 前缀）', 'a.b.c'],
  ])('Authorization 非法（%s）→ 401 / 20002', (_name, header) => {
    expect.assertions(2);
    try {
      guard.canActivate(createHttpContext({ authorization: header }));
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.UNAUTHENTICATED);
      expect((error as AppError).httpStatus).toBe(401);
    }
  });

  it('签名不符的令牌 → 401（验签真生效，不是只走了个过场）', () => {
    const forged = new JwtService({ secret: OTHER_SECRET }).sign(toClaims(CONTEXT));

    expect(() => guard.canActivate(createHttpContext({ authorization: `Bearer ${forged}` }))).toThrow(AppError);
  });

  it('已过期的令牌 → 401', () => {
    const expired = signer.sign(toClaims(CONTEXT), { expiresIn: '-1s' });

    expect(() => guard.canActivate(createHttpContext({ authorization: `Bearer ${expired}` }))).toThrow(AppError);
  });

  it('载荷形状不合法的令牌（自签但字段不对）→ 401，不是 500', () => {
    const malformed = signer.sign({ sub: 'not-a-number-here', dept_ids: [], roles: [] });

    expect.assertions(2);
    try {
      guard.canActivate(createHttpContext({ authorization: `Bearer ${malformed}` }));
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.UNAUTHENTICATED);
      expect((error as AppError).httpStatus).toBe(401);
    }
  });

  it('合法令牌 → 放行，且上下文被真正填满（判据「解 JWT → 填 context」）', () => {
    const token = signer.sign(toClaims(CONTEXT));

    const passed = guard.canActivate(createHttpContext({ authorization: `Bearer ${token}` }));

    expect(passed).toBe(true);
    // 真读回 ALS 里的上下文（不是断言「调用了 set」）—— 大整数 id 一位不差
    expect(contexts.get()).toEqual(CONTEXT);
    expect(contexts.get()?.employeeId).toBe(7n);
  });

  it('@Public 标记的路由免鉴权，且**不改动**上下文', () => {
    const publicHandler = function publicHandler(): void {};
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);
    const setSpy = jest.spyOn(contexts, 'set');

    expect(guard.canActivate(createHttpContext({}, publicHandler))).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('非 HTTP 上下文（Worker 定时任务）放行 —— 守卫不该拦死进程', () => {
    const setSpy = jest.spyOn(contexts, 'set');

    expect(guard.canActivate(createRpcContext())).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();
  });

  describe('extractBearerToken 的取舍', () => {
    it.each([
      ['Bearer abc', 'abc'],
      ['bearer abc', 'abc'],
      ['BEARER    abc', 'abc'],
      ['  Bearer abc  ', 'abc'],
    ])('%s → %s（大小写与空白容忍）', (header, expected) => {
      expect(extractBearerToken(header)).toBe(expected);
    });

    it.each([['Basic abc'], ['Bearer'], ['Bearer a b'], [undefined], [null], [123]])(
      '%s → undefined',
      (header) => {
        expect(extractBearerToken(header)).toBeUndefined();
      },
    );
  });
});

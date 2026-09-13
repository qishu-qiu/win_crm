// =============================================================================
// 全局异常过滤器用例（M0-34）
// 判据：AppError → 对应 status 与 code；且失败响应也必须符合 §2.3 的统一包（data 恒 null）。
// =============================================================================
import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import { AppError, ErrorCode } from '../../kernel/index';
import { REQUEST_ID_HEADER } from '../interceptors/response.interceptor';
import { AllExceptionsFilter, resolveException } from './all-exceptions.filter';

/** 造 P2002 假错误（鸭子类型即可，映射器刻意不依赖真实 Prisma 客户端） */
function fakeP2002(target: unknown): unknown {
  return { code: 'P2002', meta: { target }, name: 'PrismaClientKnownRequestError' };
}

interface CapturedResponse {
  status?: number;
  body?: unknown;
  readonly headers: Record<string, string>;
}

function createHttpHost(requestHeaders: Record<string, unknown> = {}): { host: ArgumentsHost; captured: CapturedResponse } {
  const captured: CapturedResponse = { headers: {} };
  const response = {
    status: (code: number) => {
      captured.status = code;
      return { json: (body: unknown) => void (captured.body = body) };
    },
    setHeader: (name: string, value: string) => void (captured.headers[name] = value),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers: requestHeaders, method: 'POST', url: '/probe/x' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('全局异常过滤器（M0-34）', () => {
  beforeEach(() => {
    // 静音日志：本套件会故意制造大量异常，别把测试输出淹掉（日志内容本身不是本轮判据）
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveException —— 判定顺序与码表（→ API §2.4）', () => {
    it('自造 AppError：status 与 code **各按自己的表**返回，不互相赋值', () => {
      const resolved = resolveException(new AppError(ErrorCode.OVER_LIMIT, 422, '标签最多 10 个'));

      expect(resolved).toEqual({ httpStatus: 422, code: 20402, message: '标签最多 10 个', logAsError: false });
    });

    it('AppError 500 走 error 级日志（要人看），4xx 走 warn（调用方的问题，不淹告警）', () => {
      expect(resolveException(new AppError(ErrorCode.INTERNAL, 500, 'x')).logAsError).toBe(true);
      expect(resolveException(new AppError(ErrorCode.FORBIDDEN, 403, 'x')).logAsError).toBe(false);
    });

    it('Prisma P2002 + 已登记约束 uk_active_rel → 409 / 20401（撞单，→ §7.5）', () => {
      const resolved = resolveException(fakeP2002(['uk_active_rel']));

      expect(resolved.httpStatus).toBe(409);
      expect(resolved.code).toBe(ErrorCode.RELATION_DUPLICATED);
      expect(resolved.message).toContain('已有归属');
      // 绝不把 DB 原话（Duplicate entry ...）丢给销售
      expect(resolved.message).not.toContain('Duplicate');
    });

    it('Prisma P2002 + 未登记约束 → 409 / 20004 兜底，且带上约束名可定位', () => {
      const resolved = resolveException(fakeP2002(['uk_something_new']));

      expect(resolved.httpStatus).toBe(409);
      expect(resolved.code).toBe(ErrorCode.UNIQUE_CONFLICT);
      expect(resolved.message).toContain('uk_something_new');
    });

    it('框架 404（路由不存在）→ 404 ＋ 兜底码 20099（规格表里没有 404 的业务码，就不硬凑）', () => {
      const resolved = resolveException(new NotFoundException('Cannot GET /nope'));

      expect(resolved.httpStatus).toBe(404);
      expect(resolved.code).toBe(ErrorCode.INTERNAL);
    });

    it('框架 400 → 400 / 20001，且**不回吐**框架自带文案（可能夹带内部信息）', () => {
      const resolved = resolveException(new BadRequestException('内部字段 abc_internal 不匹配'));

      expect(resolved.httpStatus).toBe(400);
      expect(resolved.code).toBe(ErrorCode.PARAM_INVALID);
      expect(resolved.message).toBe('请求参数有误');
      expect(resolved.message).not.toContain('abc_internal');
    });

    it('未预期错误（代码 bug）→ 500 / 20099 ＋ 人话兜底，绝不透出堆栈', () => {
      const resolved = resolveException(new Error('Cannot read properties of undefined (reading x)'));

      expect(resolved.httpStatus).toBe(500);
      expect(resolved.code).toBe(ErrorCode.INTERNAL);
      expect(resolved.message).not.toContain('undefined');
      expect(resolved.logAsError).toBe(true);
    });
  });

  describe('catch —— 失败响应也必须符合 §2.3 统一包', () => {
    const filter = new AllExceptionsFilter();

    it('失败包恰好四个字段，data 恒为 null，且回吐 request_id 响应头', () => {
      const { host, captured } = createHttpHost({ [REQUEST_ID_HEADER]: 'trace-abc' });

      filter.catch(new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '该手机号已存在'), host);

      expect(captured.status).toBe(409);
      expect(Object.keys(captured.body as object).sort()).toEqual(['code', 'data', 'message', 'request_id']);
      expect(captured.body).toEqual({
        code: ErrorCode.UNIQUE_CONFLICT,
        message: '该手机号已存在',
        request_id: 'trace-abc',
        data: null,
      });
      expect(captured.headers[REQUEST_ID_HEADER]).toBe('trace-abc');
    });

    it('调用方没带 X-Request-Id 时自生成（保证「排错必带」永远有值）', () => {
      const { host, captured } = createHttpHost();

      filter.catch(new Error('boom'), host);

      expect(String((captured.body as { request_id: string }).request_id)).toMatch(/^r-/);
    });

    it('非 HTTP 上下文（Worker）记日志后**原样抛出**，绝不吞异常', () => {
      const host = {
        getType: () => 'rpc',
        switchToHttp: () => {
          throw new Error('非 HTTP 上下文不该被切成 HTTP');
        },
      } as unknown as ArgumentsHost;
      const original = new Error('定时任务失败');

      expect(() => filter.catch(original, host)).toThrow(original);
    });
  });
});

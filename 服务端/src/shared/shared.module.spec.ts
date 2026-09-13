// =============================================================================
// 横切装配用例（M0-38）—— ★ 起一个**真 HTTP 服务**逐条打请求
//
// 为什么非得起真服务：本模块的全部价值就是「四件套全局生效」，而 `APP_GUARD` / `APP_FILTER` /
// `APP_PIPE` / `APP_INTERCEPTOR` 的生效方式**只有在真实请求管道里才能被证明** ——
// 手工 new 出来断言方法返回值，证明不了「全局注册上了」，也证明不了四者的协作顺序
// （例如「守卫抛的 401 会不会被过滤器包成统一包」—— 只有真请求能回答）。
//
// 判据覆盖：M0-38（全局生效）＋ M0-32（无 token 401）＋ M0-33（统一包）＋ M0-34（异常映射）
//          ＋ M0-35（坏 DTO → 400/20001）。
// ⚠ M0-38 判据原文写「/docs 响应符合统一包」：/docs 由 M0-48 的 Swagger 提供，且它是中间件直出
//   的 HTML、不经拦截器。本套件先证「统一包对**所有 API 处理器**生效」，/docs 到 M0-48 再核对。
// =============================================================================
import { Body, Controller, type INestApplication, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IsInt, IsString, Min } from 'class-validator';

import { ACCESS_TOKEN_TTL, AppError, ContextService, ErrorCode, Public, toClaims, type RequestContext } from '../kernel/index';
import { SharedModule } from './shared.module';

// 必须在建应用之前设好：SharedModule 的 JwtModule 工厂在 DI 初始化期读它（缺失会拒绝启动）
process.env.JWT_SECRET = 'unit-test-secret-for-shared-module'.padEnd(48, 'x');

const CONTEXT: RequestContext = {
  employeeId: 7n,
  deptIds: [1n, 2n],
  roleCodes: ['dept_manager'],
  dataScope: { type: 'dept', deptIds: [1n, 2n] },
};

/** 探针 DTO：验证全局管道真的在跑（M0-35） */
class ProbeDto {
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码至少为 1' })
  page!: number;

  @IsString({ message: '关键字必须是文本' })
  keyword!: string;
}

@Controller('probe')
class ProbeController {
  constructor(private readonly contexts: ContextService) {}

  /** 免鉴权出口（如登录口的口径） */
  @Public()
  @Get('open')
  open(): { hello: string } {
    return { hello: 'world' };
  }

  /** 返回 void：验证 data 被归一成 null（否则 JSON 会丢掉整个键，只剩三个字段） */
  @Public()
  @Get('void')
  voidRoute(): void {
    return undefined;
  }

  /** 需要登录：从中挑出「我是谁」，用于证明守卫→上下文真的通了 */
  @Get('secure')
  secure(): { employee_id: string; scope: string } {
    const context = this.contexts.require();
    return { employee_id: context.employeeId.toString(), scope: context.dataScope.type };
  }

  /** 坏 DTO 出口：管道不通过时根本到不了方法体，故返回值里带上入参只为「不浪费这个形参」 */
  @Public()
  @Post('bad')
  bad(@Body() dto: ProbeDto): string {
    return `不该走到这里：${String(dto.page)}`;
  }

  /** 业务异常出口（422 / 20402 → 超上限） */
  @Public()
  @Get('business-error')
  businessError(): never {
    throw new AppError(ErrorCode.OVER_LIMIT, 422, '标签最多 10 个');
  }

  /** 未预期异常出口：堆栈绝不能出接口 */
  @Public()
  @Get('unexpected')
  unexpected(): never {
    throw new Error('内部堆栈 Cannot read properties of undefined');
  }
}

@Module({ imports: [SharedModule], controllers: [ProbeController] })
class ProbeAppModule {}

interface ProbeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly requestId: string | null;
}

/** 用 Node 原生 fetch 打真请求（不引 supertest，少一个依赖） */
async function request(path: string, init?: Parameters<typeof fetch>[1]): Promise<ProbeResponse> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    requestId: response.headers.get('x-request-id'),
  };
}

let app: INestApplication;
let baseUrl = '';
let jwt: JwtService;

beforeAll(async () => {
  app = await NestFactory.create(ProbeAppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  jwt = app.get(JwtService);
});

afterAll(async () => {
  await app.close();
});

describe('横切装配（M0-38）—— 真 HTTP 服务上的逐条验收', () => {
  it('免鉴权出口：成功包恰好四个字段，且回吐 X-Request-Id', async () => {
    const response = await request('/probe/open');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['code', 'data', 'message', 'request_id']);
    expect(response.body).toEqual({
      code: 0,
      message: 'ok',
      request_id: expect.any(String) as unknown as string,
      data: { hello: 'world' },
    });
    expect(response.requestId).toBe(response.body.request_id);
  });

  it('返回 void 的接口：data 为 null，四字段仍在（真序列化过一遍）', async () => {
    const response = await request('/probe/void');

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(Object.keys(response.body).sort()).toEqual(['code', 'data', 'message', 'request_id']);
  });

  it('判据 M0-32：无 token 打受保护接口 → 401 / 20002，且失败包同样合规（data: null）', async () => {
    const response = await request('/probe/secure');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      code: ErrorCode.UNAUTHENTICATED,
      message: '未登录或登录已过期',
      request_id: expect.any(String) as unknown as string,
      data: null,
    });
  });

  it('坏 token → 401 / 20002（不是 500）', async () => {
    const response = await request('/probe/secure', { headers: { authorization: 'Bearer not-a-real-token' } });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('合法 token → 200，且守卫填的上下文在 controller 里真读得到（守卫→上下文打通）', async () => {
    const token = jwt.sign(toClaims(CONTEXT));

    const response = await request('/probe/secure', { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ employee_id: '7', scope: 'dept' });
  });

  it('令牌有效期按 API §2.2「建议 2h」签发（exp - iat = 7200s）', () => {
    const decoded = jwt.decode(jwt.sign(toClaims(CONTEXT))) as { iat: number; exp: number };

    expect(decoded.exp - decoded.iat).toBe(2 * 60 * 60);
    expect(ACCESS_TOKEN_TTL).toBe('2h');
  });

  it('判据 M0-35：坏 DTO → 400 / 20001，message 带字段级信息', async () => {
    const response = await request('/probe/bad', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: '不是数字', keyword: 123 }),
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(String(response.body.message)).toContain('page');
    expect(String(response.body.message)).toContain('keyword');
    expect(response.body.data).toBeNull();
  });

  it('判据 M0-34：业务异常 → 422 / 20402（status 与 code 各按自己的表）', async () => {
    const response = await request('/probe/business-error');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      code: ErrorCode.OVER_LIMIT,
      message: '标签最多 10 个',
      request_id: expect.any(String) as unknown as string,
      data: null,
    });
  });

  it('未预期异常 → 500 / 20099，且堆栈 / 内部文案绝不外泄', async () => {
    const response = await request('/probe/unexpected');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe(ErrorCode.INTERNAL);
    expect(String(response.body.message)).not.toContain('undefined');
    expect(String(response.body.message)).not.toContain('堆栈');
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });

  it('未知路由（框架 404）也被过滤器收成统一包 —— 「所有出口都收口」才算收口', async () => {
    const response = await request('/probe/does-not-exist');

    expect(response.status).toBe(404);
    expect(Object.keys(response.body).sort()).toEqual(['code', 'data', 'message', 'request_id']);
    expect(response.body.data).toBeNull();
  });
});

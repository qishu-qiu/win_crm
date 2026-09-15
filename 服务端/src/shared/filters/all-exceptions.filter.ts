// =============================================================================
// 全局异常过滤器（M0-34）—— **所有**异常出口都收成统一响应包
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §2.3：失败响应 `{ code, message, request_id, data: null }`
//     —— 注意 **data 恒为 null**（不是省略、不是空对象）；`message` 是**给销售看的人话**。
//   · 同 §2.4 错误码表：左列 HTTP 状态、右列业务 code，两套编号并存（`CODE_BY_HTTP_STATUS` 逐行转写）。
//   · 《销售CRM架构设计说明》V1.3 §7.5 异常映射：P2002 → 409（**不是** MySQL 1062），
//     映射与文案的唯一实现在 `kernel/errors/prisma-error.mapper.ts`，本文件只**调用**、不重写。
//   · 同 §5.4：`shared/**` 只依赖更低层 —— 本文件只 import `kernel` / `@nestjs/*`。
//
// ★ 为什么把「判定」抽成纯函数 `resolveException`：过滤器本体需要 `ArgumentsHost` + 真实响应对象，
//   难单测；抽出来后 M0-34 的判据（「AppError → 对应 status 与 code」）可以用一行假数据直接断言，
//   不必为每条分支起一个 HTTP 服务。
//
// ⚠ 与 M0-33 的分工：成功出参走**拦截器**（包装），失败出参走**过滤器**（本文件）。
//   两者共用 `ApiEnvelope` 与 `resolveRequestId`，保证成功 / 失败的包**长得完全一样**。
// =============================================================================
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';

import { AppError, ErrorCode, mapPrismaError } from '../../kernel/index';
import { type ApiEnvelope, REQUEST_ID_HEADER, resolveRequestId } from '../interceptors/response.interceptor';

/**
 * HTTP 状态 → 业务码（→ §2.4，**逐行转写**）。
 * ⚠ 只登记规格表里出现的状态：**表里没有的状态不给码**（不硬凑），一律走兜底 `20099`。
 *   例：422 的具名码是 `20401~20405`（撞单 / 超上限 / 必填未填…），需要业务语义才能定，
 *   故 422 由业务侧抛 `AppError` 自带正确码；Nest 内部抛出的 422 无从判断，归兜底。
 */
const CODE_BY_HTTP_STATUS: ReadonlyMap<number, number> = new Map<number, number>([
  [400, ErrorCode.PARAM_INVALID],
  [401, ErrorCode.UNAUTHENTICATED],
  [403, ErrorCode.FORBIDDEN],
  [409, ErrorCode.UNIQUE_CONFLICT],
  [429, ErrorCode.RATE_LIMITED],
  [500, ErrorCode.INTERNAL],
]);

/**
 * 状态 → 兜底人话（→ §2.3：给销售看的）。
 * ★ 刻意**不回吐** `HttpException` 自带的文案：那是框架 / 第三方写的，可能夹带内部字段名、
 *   SQL 片段、库版本等信息（§2.4 尾注要求不把内部原话丢给销售）。对外一律用本表的人话。
 */
const MESSAGE_BY_HTTP_STATUS: ReadonlyMap<number, string> = new Map<number, string>([
  [400, '请求参数有误'],
  [401, '未登录或登录已过期'],
  [403, '无权访问该数据'],
  [404, '接口不存在，请确认地址是否正确'],
  [409, '数据冲突，请刷新后重试'],
  [422, '当前操作不满足业务条件'],
  [429, '操作过于频繁，请稍后再试'],
]);

/** 兜底人话：未预期错误一律用它（对齐 §2.4 500 = 服务异常） */
const FALLBACK_MESSAGE = '系统开小差了，请稍后重试';

/** 判定结果（纯函数产物；`logAsError` 决定记 error 还是 warn） */
export interface ResolvedException {
  httpStatus: number;
  code: number;
  message: string;
  /**
   * 5xx → 记 `error`（带栈，要人看）；4xx → 记 `warn`（调用方的问题，**不该淹掉告警**）。
   */
  logAsError: boolean;
}

/**
 * 异常 → `{ httpStatus, code, message }`（判定顺序**不可调换**）：
 * ① 自造 `AppError`（业务异常，`code` / `httpStatus` 已自带）
 * ② Prisma `P2002`（→ §7.5，映射表在 kernel）
 * ③ 其他 Nest `HttpException`（框架内部：404 路由不存在等）
 * ④ 剩下的**全是未预期**（代码 bug / 连接挂掉）→ 500 / 20099
 */
export function resolveException(exception: unknown): ResolvedException {
  if (exception instanceof AppError) {
    return {
      httpStatus: exception.httpStatus,
      code: exception.code,
      message: exception.message,
      logAsError: exception.httpStatus >= 500,
    };
  }

  const fromPrisma = mapPrismaError(exception);
  if (fromPrisma !== null) {
    return {
      httpStatus: fromPrisma.httpStatus,
      code: fromPrisma.code,
      message: fromPrisma.message,
      logAsError: fromPrisma.httpStatus >= 500,
    };
  }

  if (exception instanceof HttpException) {
    const httpStatus = exception.getStatus();
    return {
      httpStatus,
      code: CODE_BY_HTTP_STATUS.get(httpStatus) ?? ErrorCode.INTERNAL,
      message: MESSAGE_BY_HTTP_STATUS.get(httpStatus) ?? FALLBACK_MESSAGE,
      logAsError: httpStatus >= 500,
    };
  }

  return { httpStatus: 500, code: ErrorCode.INTERNAL, message: FALLBACK_MESSAGE, logAsError: true };
}

/** 抛错时能取到的请求侧信息（只用于日志，**不出接口**） */
function describeRequest(exception: unknown): string {
  if (exception instanceof AppError && exception.constraint !== undefined) {
    return `constraint=${exception.constraint}`;
  }
  return '';
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const resolved = resolveException(exception);

    // 非 HTTP（Worker 定时任务 / 应用启动期）：没有响应对象可写。
    // ★ 记完日志**原样抛出**，绝不吞 —— 吞了就是「定时任务静默失效」，那是本系统最难查的一类事故。
    if (host.getType() !== 'http') {
      this.logger.error(`非 HTTP 上下文异常（已原样抛出）: ${resolved.message}`, exception);
      throw exception;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<{ headers?: Record<string, unknown>; method?: string; url?: string }>();
    const requestId = resolveRequestId(request.headers?.[REQUEST_ID_HEADER]);

    // 回吐链路 id：用户报错时报这个 id，就能在日志里精确定位这一次请求（§2.3「排错必带」）
    const response = http.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
      setHeader?: (name: string, value: string) => void;
    }>();
    response.setHeader?.(REQUEST_ID_HEADER, requestId);

    const trace = `[${requestId}] ${request.method ?? '?'} ${request.url ?? '?'} → ${resolved.httpStatus}/${resolved.code} ${resolved.message}`;

    if (resolved.logAsError) {
      // 内部细节（原始异常 / 约束名 / 堆栈）**只进日志**，不进响应（§2.4 尾注）
      this.logger.error(`${trace} ${describeRequest(exception)}`, exception);
    } else {
      this.logger.warn(`${trace} ${describeRequest(exception)}`);
    }

    const body: ApiEnvelope<null> = {
      code: resolved.code,
      message: resolved.message,
      request_id: requestId,
      data: null, // → §2.3 失败响应固定为 null
    };
    response.status(resolved.httpStatus).json(body);
  }
}

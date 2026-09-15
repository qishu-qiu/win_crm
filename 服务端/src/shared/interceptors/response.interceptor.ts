// =============================================================================
// 统一响应拦截器（M0-33）—— 所有成功出参包成 `{ code, message, request_id, data }`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §2.3 统一响应包（**逐字**）：
//       成功分页 `{ "code": 0, "message": "ok", "request_id": "r-xxxx",
//                   "data": { "list": [...], "total": 120, "page": 1, "page_size": 20 } }`
//       成功单对象 `{ "code": 0, "message": "ok", "request_id": "r-xxxx", "data": {...} }`
//       失败 `{ "code": 20402, "message": "...", "request_id": "r-xxxx", "data": null }`
//     `code = 0` 成功；`request_id` **全局追踪，排错必带**（→ 同 §7.4 审计也要 req_id）。
//
// 分层约束（架构 §5.4）：`shared/**` 只依赖更低层 —— 本文件只 import `kernel` / `rxjs` / `@nestjs/*`。
//
// 装配顺序（★ 别改，→ shared.module.ts）：本拦截器必须在**最外层**（注册顺序第一），
//   因为 Nest 的响应阶段是**倒序**执行 —— 先注册→最后包裹，才能保证「脱敏/数据范围处理完
//   的结果」被包进 data，而不是把拦截器自己的包装对象再拿去脱敏。
// =============================================================================
import { randomUUID } from 'node:crypto';

import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import { ErrorCode, toJsonSafe } from '../../kernel/index';

/** 统一响应包（→ §2.3）：**四个字段固定，多一个少一个都算违约**（T1-4 会逐个核对） */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  request_id: string;
  /** 成功＝业务数据；失败恒为 `null`（→ §2.3 失败示例），故类型上与成功共用本接口 */
  data: T;
}

/** 成功码（→ §2.3「code = 0 成功」）；走 ErrorCode.OK 而非字面量 0，避免与错误码表脱钩 */
export const SUCCESS_CODE = ErrorCode.OK;
/** 成功文案（→ §2.3 示例原文 `"ok"`，不改成中文） */
export const SUCCESS_MESSAGE = 'ok';
/** 链路 id 的响应头名：回吐给调用方，用户报错时能直接报这个 id（§2.3「排错必带」） */
export const REQUEST_ID_HEADER = 'x-request-id';

/** 自生成 id 的前缀（→ §2.3 示例 `r-xxxx`） */
const REQUEST_ID_PREFIX = 'r-';
/** 复用上游 id 的长度上限：超长值不回吐（也是响应头注入面的第一道闸） */
const REQUEST_ID_MAX_LENGTH = 128;
/** 允许复用的上游 id 形状：字母数字与 `-_.:`（网关 / 前端的常见 trace id 都落在这套字符里） */
const REQUEST_ID_PATTERN = /^[\w.:-]+$/;

/**
 * 解析请求链路 id：**优先复用**上游传入的 `X-Request-Id`（前端 / 网关已生成时保持同一条链路），
 * 否则生成 `r-<uuid>`。
 * ⚠ 只复用「长度合规 + 字符集合规」的值：把上游的任意字符串原样塞进响应头 = 响应头注入面。
 */
export function resolveRequestId(headerValue: unknown): string {
  if (typeof headerValue === 'string') {
    const trimmed = headerValue.trim();
    if (trimmed !== '' && trimmed.length <= REQUEST_ID_MAX_LENGTH && REQUEST_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  return `${REQUEST_ID_PREFIX}${randomUUID()}`;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(executionContext: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    const requestId = this.resolveAndEcho(executionContext);
    return next.handle().pipe(
      map((data) => ({
        code: SUCCESS_CODE,
        message: SUCCESS_MESSAGE,
        request_id: requestId,
        // ⚠ `undefined` 必须归一成 `null`：JSON.stringify 会**整个丢掉** undefined 的键，
        //    那样响应就只剩三个字段，直接违反 §2.3 的固定四字段（如 handler 返回 void 的接口）。
        // ⚠ 再过一遍 `toJsonSafe`（M1 补漏 · M0-33 只验了字段个数，漏了这一环）：
        //    主键是 `BigInt @db.UnsignedBigInt`（46 张表一致），而 `JSON.stringify(1n)` **直接抛错**
        //    → 任何返回 id 的接口都会 500。这里**唯一一处收口**，各接口不必逐个手转 id（逐个手转必漏）。
        //    依据＝`kernel/common/bigint.ts` 顶部已写明的设计意图「M0-33 统一响应包对出参过一遍它」。
        data: (data === undefined ? null : toJsonSafe(data)) as T,
      })),
    );
  }

  /** 取（或生成）链路 id，并回吐到响应头 */
  private resolveAndEcho(executionContext: ExecutionContext): string {
    if (executionContext.getType() !== 'http') {
      return resolveRequestId(undefined);
    }
    const request = executionContext.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const requestId = resolveRequestId(request.headers?.[REQUEST_ID_HEADER]);
    const response = executionContext.switchToHttp().getResponse<{
      setHeader?: (name: string, value: string) => void;
    }>();
    response.setHeader?.(REQUEST_ID_HEADER, requestId);
    return requestId;
  }
}

// =============================================================================
// 统一业务异常基类（M0-22）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.14 §2.3 统一响应包：`{ code, message, request_id, data }`
//     —— `code = 0` 成功、非 0 = 业务错误；`message` 是**给销售看的人话**。
//   · 同 §2.4 错误码表：HTTP 状态与 `code` **各成一套**（如 409 ↔ 20004 / 204xx），不可混用。
//   · 《销售CRM架构设计说明》V1.3 §7.5 异常映射：P2002 → 409，**不把 DB 原话丢给销售**。
//
// 分层约束（架构 §5.4）：kernel 零业务、谁都能用 —— 本文件**不许 import `modules/*`**。
// =============================================================================

/**
 * 错误码表（→《接口API文档》V1.14 §2.4，**逐行转写**；新增码必须先在规格里出现，不得自造）
 */
export const ErrorCode = {
  /** 成功（→ §2.3） */
  OK: 0,
  /** 400 · 参数错误：字段缺失 / 类型错 / 枚举非法 */
  PARAM_INVALID: 20001,
  /** 401 · 未认证 / token 失效 */
  UNAUTHENTICATED: 20002,
  /** 403 · 无权限（数据权限越界） */
  FORBIDDEN: 20003,
  /** 409 · 唯一冲突 / 竞态（**未细化到具体业务码时的兜底**，→ §2.4 409 行） */
  UNIQUE_CONFLICT: 20004,
  /** 429 · 限流（**幂等键重复不算限流**，见 §2.5） */
  RATE_LIMITED: 20005,
  /** 500 · 服务异常（未预期错误） */
  INTERNAL: 20099,
  /** 409 · 撞单已存在（`uk_active_rel`，→ §2.4 / §4.4 / §六.1） */
  RELATION_DUPLICATED: 20401,
  /** 422 · 超过上限（标签 / 谈判特质，→ §2.4 / §4.3） */
  OVER_LIMIT: 20402,
  /** 422 · 必填未填（死因 / 开发价值 / 签约校验清单，→ §2.4 / §4.3） */
  REQUIRED_MISSING: 20403,
  /** 422 · 预约未完成禁止（→ §2.4 / §4.3） */
  APPOINTMENT_UNFINISHED: 20404,
  /** 422 · 解锁申请已存在（→ §2.4 / §4.3） */
  UNLOCK_REQUEST_EXISTS: 20405,
  /** 409 · 关系已激活（重复激活，→ §2.4 409 行场景） */
  RELATION_ACTIVATED: 20406,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppErrorOptions {
  /**
   * 内部定位信息（如命中的唯一约束名 `uk_active_rel`）：
   * **只进日志与审计，不出接口** —— 规格要求不把 DB 原话 / 内部约束名丢给销售（§2.4 尾注）。
   */
  constraint?: string;
  /** 原始异常（如 Prisma 的 P2002 对象），只进日志便于排查；同样不出接口 */
  cause?: unknown;
}

/**
 * 业务异常基类：`code` ＋ `httpStatus` ＋ `message` 三要素（M0-22 判据：构造后能读到 status）。
 */
export class AppError extends Error {
  /** 业务错误码（→ §2.4 错误码表） */
  readonly code: number;
  /** HTTP 状态码（→ §2.4 左列）；与 `code` 是两套编号，**不要互相赋值** */
  readonly httpStatus: number;
  /** 内部定位信息：命中的约束名等（可选） */
  readonly constraint?: string;

  constructor(code: number, httpStatus: number, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (options.constraint !== undefined) {
      this.constraint = options.constraint;
    }
  }
}

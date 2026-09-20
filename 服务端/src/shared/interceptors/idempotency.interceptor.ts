// =============================================================================
// 幂等切面（D-06 · 2026-09-20 七叔拍板落地）—— 横切第 5 件
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§2.5：写操作带 `Idempotency-Key`，**重复同 key → 返回首次结果、不重复执行**；
//     §2.4 错误码表 429 行：**幂等键重复不算限流**（不是 429）。
//   · 2026-09-20 拍板五条（逐条 → `prisma/migrations/0010_idempotency_key` 头注释）：
//     ① 不带头的写请求**放行**；② 作用域＝**登录人 × 端点 × key**；③ TTL **24h**；
//     ④ 同 key 但入参不同 → **409 / 20004**；⑤ 存储走 **MySQL 表**（零新依赖）。
//
// ★ 三条设计要点（改之前先读完）：
//   ① **只认"带了头"的写请求**（拍板①）：不带 `Idempotency-Key` 一律原样放行 ——
//      前端现有 12+ 写端点都没带，一律拒＝前端得同批全改才敢发版；过渡期"带了才校验"。
//   ② **命中且入参一致 → 直接返回首次结果、不执行 handler**（`of(...)` 短路）；
//      命中但**入参指纹不同 → 409**（拍板④）—— 静默返回旧结果会让人以为这次写成功了。
//   ③ **业务成功后才落库**（不是先占位）：失败请求不占 key；代价是并发同 key 可能各执行一次，
//      取舍见 `IdempotencyService.save` 注释（防并发双写靠各域的条件 UPDATE，不靠本表）。
//
// ⚠ **注册顺序**（→ shared.module.ts）：紧跟在 `ResponseInterceptor` **之后** ——
//   请求阶段它**早于**业务跑（命中即可短路，不白干活）；响应阶段它**晚于** Response，
//   于是「短路返回的那个对象」仍会被 Response 包成统一响应包（`{code,message,request_id,data}`）。
//   若注册到 Response 之前，重放会绕过统一包 → 前端拿到的形状与首次不一致。
//
// ⚠ 出参缓存前过一遍 `toJsonSafe`：出参里有 `bigint`（id），不过就会在 JSON 列写入时炸；
//   转成字符串后与**首次经 ResponseInterceptor 下发**的形状一致（重放拿到的就是同一份 data）。
// =============================================================================
import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { concatMap, of, type Observable } from 'rxjs';

import { AppError, ErrorCode, getRequestContext, toJsonSafe } from '../../kernel';
import {
  IdempotencyService,
  type IdempotencyScope,
} from '../../kernel/idempotency/idempotency.service';

/** 要过幂等的 HTTP 方法（**增删改**；GET 天然幂等，不管） */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 幂等头名（→ §2.5，逐字） */
const IDEMPOTENCY_HEADER = 'idempotency-key';

/** 幂等键长度上限（＝库列 `idem_key VARCHAR(64)`）：超了 **400**，**不静默截断**（截断会把两把不同的钥匙变成同一把） */
const IDEMPOTENCY_KEY_MAX_LENGTH = 64;

/** 首次结果的成功码：§2.3「成功响应一律 200」（留列是为了将来出现 201/204 时能正确重放） */
const SUCCESS_STATUS = 200;

const KEY_TOO_LONG_MESSAGE = `幂等键（Idempotency-Key）最长 ${IDEMPOTENCY_KEY_MAX_LENGTH} 个字符`;
const KEY_REUSED_MESSAGE =
  '同一个幂等键（Idempotency-Key）已经用在另一次不同的提交上，请换一把新钥匙重发';

/** 本类只读请求的这几个字段（`Express` 的 Request 子集，避免把整个类型拖进来） */
interface HttpRequestLike {
  method?: string;
  body?: unknown;
  baseUrl?: string;
  path?: string;
  route?: { path?: unknown };
  headers?: Record<string, unknown>;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly store: IdempotencyService) {}

  async intercept(executionContext: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    // 非 HTTP（Worker）：不经横切层（与 `data-scope` / `desensitize` / `audit-log` 同口径）
    if (executionContext.getType() !== 'http') return next.handle();

    const request = executionContext.switchToHttp().getRequest<HttpRequestLike>();
    const method = (request.method ?? '').toUpperCase();
    if (!WRITE_METHODS.has(method)) return next.handle();

    // 拍板①：不带幂等头 → 放行（**不是** 400：过渡期口径，见文件头 ★①）
    const idemKey = headerOf(request, IDEMPOTENCY_HEADER);
    if (idemKey === undefined) return next.handle();

    if (idemKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, KEY_TOO_LONG_MESSAGE, {
        constraint: 'idempotency.key_too_long',
      });
    }

    // 未登录（如 `POST /account/login`）→ 没有「谁」，不在幂等范围
    const employeeId = getRequestContext()?.employeeId;
    if (employeeId === undefined) return next.handle();

    const endpoint = endpointOf(request, method);
    if (endpoint === '') return next.handle();

    const scope: IdempotencyScope = { employeeId, endpoint, idemKey };
    const requestHash = hashOf(request.body);

    const hit = await this.store.find(scope);
    if (hit !== null) {
      if (hit.requestHash !== requestHash) {
        throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, KEY_REUSED_MESSAGE, {
          constraint: 'uk_idem_scope',
        });
      }
      // ★ 短路：不执行 handler，直接把首次结果交回管道（由 ResponseInterceptor 包壳）
      return of(hit.responseBody);
    }

    // ★ **必须等落库完成再放响应**（不能用 `tap` 里 fire-and-forget）——
    //   2026-09-20 真库实测抓到：响应先回、键后落，客户端"紧接着重试"会**漏过幂等**、
    //   直接撞业务唯一冲突（实测重放返回的是「该手机号已存在」而不是首次结果）。
    //   落库失败仍是 best-effort（记日志、不冒泡），但**不省掉等待**。
    return next.handle().pipe(
      concatMap(async (data: unknown) => {
        try {
          await this.store.save(scope, requestHash, SUCCESS_STATUS, toJsonSafe(data) ?? null);
        } catch (error) {
          this.logger.warn(`幂等键落库失败（不影响本次业务）：${endpoint} / ${String(error)}`);
        }
        return data;
      }),
    );
  }
}

/** 取请求头（空 / 非字符串 → `undefined`） */
function headerOf(request: HttpRequestLike, name: string): string | undefined {
  const value = request.headers?.[name];
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

/**
 * 端点标识 ＝ `METHOD /路由模板`。
 * ★ **取路由模板而不是实际路径**（`POST /relations`，不是 `POST /relations/5`）：
 *   否则每个 id 都会新占一行，`uk_idem_scope` 形同虚设。
 * ⚠ 兜底：`route.path` 缺失时（不该发生，如 404 未匹配路由）退回 `path` —— 此时请求本就不会进业务，
 *   退回只为不抛异常。
 */
function endpointOf(request: HttpRequestLike, method: string): string {
  const routePath = request.route?.path;
  const base = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  const path =
    typeof routePath === 'string'
      ? routePath
      : typeof request.path === 'string'
        ? request.path
        : '';
  return path === '' ? '' : `${method} ${base}${path}`;
}

/**
 * 入参指纹 ＝ `SHA-256(规范化 JSON(body))` 的 hex。
 * ★ 只比对 **body**（不比对 header / query）：重试时网络层可能换 header，而 body 才是业务意图。
 * ⚠ 顶层键**排序后**再序列化：同一次提交若客户端重建对象导致键顺序不同，
 *   不该被误判成"改了参数"（那会给出一个莫名其妙的 409）。
 */
function hashOf(body: unknown): string {
  return createHash('sha256').update(stabilize(body)).digest('hex');
}

function stabilize(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return JSON.stringify(value ?? null) ?? 'null';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return JSON.stringify(Object.fromEntries(entries));
}

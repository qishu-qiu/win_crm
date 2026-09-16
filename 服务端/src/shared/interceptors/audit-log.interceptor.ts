// =============================================================================
// 写操作审计切面（M5-07 · 2026-09-15）—— **增删改一处收口留痕**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§7.4：**所有增删改**都要写 `operation_log`
//     （2026-09-15 七叔口径：「**符合等保标准，所有的增删改都有迹可查**」）。
//     §7.4 括号里的动作（登录 / 改手机号 / 审批 / 公海 / 金额）是**举例，不是穷尽清单** ——
//     早期 `company.service.ts` / `relation.service.ts` 文件头把它当穷尽读、写下「不写审计」，
//     那两句已按本口径修正。
//   · 《销售CRM数据架构文档》A10：`action` ＝ `模块.动词`、`target_type/target_id` 记对象、
//     写入「由应用层**统一审计切面**在业务事务内写入」—— 本类即该切面；**敏感动作的 before/after**
//     仍由各域 service 在业务事务内调 `AuditService.record()`（本类拿不到改前值）。
//   · 《销售CRM业务需求文档》§4.2 ★ ＋ §4.3 三：管理员**每次查看**写 `operation_log` ——
//     查看是 **GET**，**不在本切面范围**（本类只认 POST/PUT/PATCH/DELETE），由 D 域出口单独写。
//
// ★ 三条设计要点（改之前先读完）：
//   ① **白名单式覆盖**：写方法**默认留痕**；动作名由 `@Audit('模块.动词')` 给，
//      没标就用兜底名 `http.<method>`（**漏标 = 记录难看，不会漏审计**）。
//      语义上是读的 POST（撞库查重）与已有专门审计的端点（登录）标 `@AuditSkip()`。
//   ② **只在成功时写**：`tap` 只在 `next.handle()` **未抛异常**时触发 ⇒ 「业务成功才有 log、
//      业务失败（4xx/5xx）不留脏审计」，与 M5-07 判据「业务失败回滚后无 log」一致。
//      安全类失败（登录失败）由 `org.service.ts` 单独记 —— 那属于**另一条口径**，别混。
//   ③ **best-effort**：走 `AuditService.recordStandalone()`（独立写入、失败只记日志、绝不冒泡）
//      —— 审计写失败**不能让业务请求失败**。⚠ 代价是可能丢记录，取舍见 §7.4。
//
// ★ 为什么在**请求阶段**就把 `operator/req_id/ip/ua` 取完：响应阶段可能已离开原始 async 上下文
//   （AsyncLocalStorage 不保证跨 Observable 回调存活），届时再读上下文会拿到 `undefined`。
//   取完存进闭包变量，响应阶段只读变量、不读上下文 —— 这是本类唯一容易写错的地方。
//
// 装配顺序（→ shared.module.ts）：注册在**最后**（响应阶段最先执行）⇒ 拿到的 `data` 是 handler
//   的原始返回值（还没被 ResponseInterceptor 包成 `{code,message,request_id,data}`），
//   故 `pickTargetId` 能直接取出参的 `id`。
// =============================================================================
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';

import {
  AuditService,
  type AuditAction,
  getRequestContext,
  isAuditSkipped,
  readAuditMeta,
} from '../../kernel/index';

/** 要留痕的 HTTP 方法（**增删改**；GET 是查看，走 D 域出口单独写） */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 链路 id 头名（与 `ResponseInterceptor` 同一个头，两处必须一致） */
const REQUEST_ID_HEADER = 'x-request-id';
/** 客户端标识头名（→ A10 `user_agent`） */
const USER_AGENT_HEADER = 'user-agent';

/** 本类只读请求的这几个字段（`Express` 的 Request 子集，避免把整个类型拖进来） */
interface HttpRequestLike {
  method?: string;
  ip?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 非 HTTP（Worker）：不经横切层（与 `data-scope` / `desensitize` 同口径）
    if (executionContext.getType() !== 'http') return next.handle();

    const request = executionContext.switchToHttp().getRequest<HttpRequestLike>();
    const method = (request.method ?? '').toUpperCase();
    if (!WRITE_METHODS.has(method)) return next.handle();
    if (isAuditSkipped(executionContext.getHandler())) return next.handle();

    const meta = readAuditMeta(executionContext.getHandler());
    // 兜底名（`http.post`）：动作名是检索键，兜底也要能查出「谁在何时调了这个端点」。
    // ⚠ cast：兜底名同样满足 A10 的 `模块.动词` 形状，只是 TS 无法静态证明字符串模板成立
    const action = (meta?.action ?? `http.${method.toLowerCase()}`) as AuditAction;
    const targetType = meta?.targetType;

    // ★ 请求阶段取值（见文件头 ★ 第 4 段）
    const operatorId = getRequestContext()?.employeeId;
    const reqId = headerOf(request, REQUEST_ID_HEADER);
    const ip = typeof request.ip === 'string' && request.ip !== '' ? request.ip : undefined;
    const userAgent = headerOf(request, USER_AGENT_HEADER);
    const paramId = toBigintId(request.params?.['id']);

    return next.handle().pipe(
      tap((data: unknown) => {
        // 对象 id：路由参数优先（改 / 加成员类），否则取出参里的 `id`（新建类）
        const targetId = paramId ?? pickTargetId(data);
        void this.audit.recordStandalone({
          action,
          ...(targetType === undefined ? {} : { target_type: targetType }),
          ...(targetId === undefined ? {} : { target_id: targetId }),
          ...(operatorId === undefined ? {} : { operator_id: operatorId }),
          ...(reqId === undefined ? {} : { req_id: reqId }),
          ...(ip === undefined ? {} : { ip }),
          ...(userAgent === undefined ? {} : { user_agent: userAgent }),
        });
      }),
    );
  }
}

/** 取请求头（空 / 非字符串 → `undefined`，**不写空串**，与 `AuditLogInput` 的「缺省＝不写该列」一致） */
function headerOf(request: HttpRequestLike, name: string): string | undefined {
  const value = request.headers?.[name];
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

/** 路由参数 → bigint（A10 主键是 `UnsignedBigInt`；非纯十进制数字串一律不猜） */
function toBigintId(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

/** 从出参浅取对象 id（`{id}` / `{data:{id}}`；数组与其他形状 → `undefined`，**不深挖**） */
function pickTargetId(data: unknown): bigint | undefined {
  const direct = idOf(data);
  if (direct !== undefined) return direct;
  if (typeof data === 'object' && data !== null && 'data' in data) {
    return idOf((data as { data?: unknown }).data);
  }
  return undefined;
}

function idOf(value: unknown): bigint | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'bigint' ? id : undefined;
}

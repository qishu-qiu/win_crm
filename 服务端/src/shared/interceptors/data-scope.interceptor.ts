// =============================================================================
// 数据范围拦截器（M0-36）—— ★★ 本批次**只做占位**，真实注入在 M5 ★★
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §7.2 数据范围注入（**四档**）：
//       销售 `self` ＝ 本人 ∪ 有效协同人 ∪ 公海；**交付·客服 `serving` ＝ 仅「服务中」客户**
//       （＝在合同服务期内，只读、**不进公海**）；经理 `dept` ＝ 管辖部门；总经理 / 管理员 `all` ＝ 不过滤；
//       ★「所有列表查询**必须**经过拦截器」；★「**禁止**在 repository 手写 `where owner_id = ...`」。
//   · 同 §7.1：横切层**只读上下文、不查数据库**。
//
// ★ 本文件现在**故意什么都不做**，理由（这是技术债的诚实登记，不是偷懒）：
//   真实注入需要「在查询上叠加 where 条件」的机制，而那机制要与 M0-46（Prisma 接入）、
//   C/E 域的真实列表查询一起设计才定得下来（是 `$extends` 中间件？是基类 repository 拼 where？
//   还是把范围塞进 `Prisma.sql` 片段？）—— 此刻没有一条真查询可跑，**先写等于凭空造机制**，
//   必与后面真实查询的形状打架、返工。
//   故本文件只做**能验证且不会返工**的那一小半：把上下文里的数据范围**打标到请求上**，
//   供 M5 的注入逻辑与 M1 起的调试直接取用；并**立下三条不许破的约束**（见下）。
//
// ★ 三条硬约束（写在文件里，比写在文档里更难被绕过）：
//   ① 本文件**永不注入 Prisma / repository** —— `shared/**` 只依赖更低层，且横切层不查库（§7.1）；
//   ② 拿不到上下文时**不猜、不放行**：不做「默认全量」的兜底（默认全量＝越权读全公司数据）；
//   ③ 真正的注入必须在**所有列表查询上强制生效**（M5 验收点），本占位不得成为最终形态。
// =============================================================================
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Observable } from 'rxjs';

import { ContextService, type DataScope } from '../../kernel/index';

/** 数据范围在请求对象上的挂载键（M5 的注入逻辑与调试都从这里读，**别在别处另起键名**） */
export const DATA_SCOPE_REQUEST_KEY = 'dataScope';

/** 从请求上取回已解析的数据范围（取不到＝本次请求没有上下文，如 @Public 路由） */
export function readDataScope(request: unknown): DataScope | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }
  const attached: unknown = (request as Record<string, unknown>)[DATA_SCOPE_REQUEST_KEY];
  if (typeof attached !== 'object' || attached === null) {
    return undefined;
  }
  const candidate = attached as { type?: unknown; deptIds?: unknown };
  // 四档白名单（→ 架构 §7.2；与 `kernel/context/request-context.ts` 的 `DataScopeType` 同集合）
  if (
    candidate.type !== 'self' &&
    candidate.type !== 'serving' &&
    candidate.type !== 'dept' &&
    candidate.type !== 'all'
  ) {
    return undefined;
  }
  return {
    type: candidate.type,
    deptIds: Array.isArray(candidate.deptIds) ? (candidate.deptIds as bigint[]) : [],
  };
}

@Injectable()
export class DataScopeInterceptor implements NestInterceptor {
  constructor(private readonly contexts: ContextService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 非 HTTP（Worker）：没有「列表查询的调用方」可约束，直接放行（Worker 的越界风险在任务自身）
    if (executionContext.getType() !== 'http') {
      return next.handle();
    }

    const context = this.contexts.get();
    if (context === undefined) {
      // ★ 约束 ②：没有上下文就**不打标、不放行、不兜底**。到 M5，缺上下文＝注入逻辑无法判定范围，
      //   必须抛 403/20003 明确拒绝（宁可不返回数据，也不返回全公司数据）。
      //   此刻不抛：M0 阶段还没有任何列表接口，抛了只是把「无接口」变成「报错」。
      return next.handle();
    }

    // 判据（M0-36）：只读上下文并打标 —— **本类不注入 Prisma**，故不可能碰到库（见 spec 里的 tripwire 断言）
    const request = executionContext.switchToHttp().getRequest<Record<string, unknown>>();
    request[DATA_SCOPE_REQUEST_KEY] = context.dataScope;
    return next.handle();
  }
}

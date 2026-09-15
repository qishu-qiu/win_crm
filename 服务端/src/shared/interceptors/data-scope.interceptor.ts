// =============================================================================
// 数据范围拦截器（M0-36 立 · **M5-01 起职责定稿**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §7.2 数据范围注入（**四档**）：
//       销售 `self` ＝ 本人 ∪ 有效协同人 ∪ 公海；**交付·客服 `serving` ＝ 仅「服务中」客户**
//       （＝在合同服务期内，只读、**不进公海**）；经理 `dept` ＝ 管辖部门；总经理 / 管理员 `all` ＝ 不过滤；
//       ★「所有列表查询**必须**经过它」；★「**禁止**在 repository 手写 `where owner_id = ...`」。
//   · 同 §7.1：横切层**只读上下文、不查数据库**。
//
// ★ **本类不是「把范围注入到查询条件」的地方** —— 这是 M5 开工时定的口径（2026-09-15）：
//   本类挂在 Nest 的**响应式管道**上，只看得见请求与最终的 Observable，
//   **改不了 service 内部的 Prisma 查询**（那发生在 handler 里，本类够不着）。
//   真正的收口点是另外两处（→《开发计划-V1》M5-01/02/03）：
//     ① **唯一判定** ＝ `kernel/data-scope/data-scope-target.ts`：四档 → 范围描述（`mode`）；
//     ② **各域 repository** 拿范围描述拼自己的 where（按表语义翻译）。
//   ⚠ 旧注释里「真实注入在 M5 / 拦截器是执行者」的说法**已作废**，别再照它盖楼。
//
// ★ 故本类只做**能验证且不会返工**的那一小半：把上下文里的数据范围**打标到请求上**，
//   供调试 / 出口标记 / 排查直接取用；并**立下三条不许破的约束**（见下）。
//
// ★ 三条硬约束（写在文件里，比写在文档里更难被绕过）：
//   ① 本文件**永不注入 Prisma / repository** —— `shared/**` 只依赖更低层，且横切层不查库（§7.1）；
//   ② 拿不到上下文时**不猜、不放行**：不做「默认全量」的兜底（默认全量＝越权读全公司数据）；
//   ③ 本文件**不得出现任何档位判断**（`scope.type === ...`）—— 那会造出第二处判定源，
//      正是「散在 ~80 个接口里各写一遍」的老路（判定只许在 ① 那一处）。
// =============================================================================
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Observable } from 'rxjs';

import { ContextService, type DataScope } from '../../kernel/index';

/** 数据范围在请求对象上的挂载键（调试 / 出口标记从这里读，**别在别处另起键名**） */
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
      // ★ 约束 ②：没有上下文就**不打标、不放行、不兜底**（默认全量＝越权读全公司）。
      //   ⚠ M5 定稿：**这里不抛错** —— `@Public` 路由（登录 / 刷新）本就没有上下文，抛了会挂掉它们。
      //   「要范围却没有上下文」由**真正要用范围的出口**自己拒：service 的 `requireViewer()` → 401 / 20002。
      return next.handle();
    }

    // 判据（M0-36）：只读上下文并打标 —— **本类不注入 Prisma**，故不可能碰到库（见 spec 里的 tripwire 断言）
    const request = executionContext.switchToHttp().getRequest<Record<string, unknown>>();
    request[DATA_SCOPE_REQUEST_KEY] = context.dataScope;
    return next.handle();
  }
}

// =============================================================================
// 上下文模块（M0-27）—— 上下文层的**装配点**与**注入入口**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§7.1：请求上下文「一次解析、全程可用」；
//     横切层**只读这个上下文、不查数据库**（避免「A 域调权限、权限查 A 域」的循环依赖）。
//   · 同 §5.2 / §5.3：上下文是**跨域共享的横切设施**，故声明 `@Global()`，七域不必逐个 import。
//   · M0-27 判据：`tsc --noEmit` 通过，且**不依赖任何模块域** —— 本文件只 import `kernel/context/*`。
//
// 设计取舍（2026-09-14，属技术决策，理由如下）：
//   · `AsyncLocalStorage` 存的是**进程内隐式链路**，本身不需要 DI 装配 —— 故本模块**不复制任何逻辑**：
//     `ContextService` 只是 `request-context.ts` 的**薄适配（注入入口）**，真相源唯一留在那一处。
//   · **本模块刻意不做**「每个 HTTP 请求建立 ALS 作用域」的中间件：按计划那一环归
//     M0-32（鉴权守卫填上下文）/ M0-38（`main.ts` 全局注册）；此刻还没有可跑的 HTTP 应用，
//     写不可验证的代码＝技术债。此处只留指针，不抢活。
// =============================================================================
import { Global, Injectable, Module } from '@nestjs/common';

import {
  getRequestContext,
  requireRequestContext,
  runWithContext,
  setRequestContext,
  type RequestContext,
} from './request-context';

/** 请求上下文的注入入口（薄适配：逻辑唯一在 `request-context.ts`，本类不含任何新规则） */
@Injectable()
export class ContextService {
  /** 只读当前请求上下文；不在请求链上（如 Worker 定时任务）＝ `undefined` */
  get(): RequestContext | undefined {
    return getRequestContext();
  }

  /** 取当前请求上下文，取不到即抛（写操作 / 审计等「一定要有人」的场景用） */
  require(): RequestContext {
    return requireRequestContext();
  }

  /** 鉴权守卫解析完 JWT 后调用（→ M0-32） */
  set(context: RequestContext): void {
    setRequestContext(context);
  }

  /** 包裹执行：链内（含 await / 定时器回调）都能读回同一个上下文（单测 / 定时任务用） */
  run<T>(context: RequestContext, fn: () => T): T {
    return runWithContext(context, fn);
  }
}

/** 上下文模块：`@Global()` 全局可见；真正的装配发生在 M0-49（`app.module.ts` 组装 kernel） */
@Global()
@Module({ providers: [ContextService], exports: [ContextService] })
export class ContextModule {}

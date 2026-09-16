// =============================================================================
// 横切装配模块（M0-38）—— 守卫 / 拦截器 / 过滤器 / 管道**一处可见**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.2：`shared/` ＝ 横切装配（guards / interceptors / filters / pipes）；
//     §5.4：`shared/**` 只依赖更低层（kernel）。
//   · §7.1 ~ §7.5 定义四件套各自的职责（上下文只读 / 数据范围注入 / 脱敏渲染 / 审计 / 异常映射）。
//
// ★ 为什么用 `APP_*` 令牌注册，而不是在 main.ts 里 `app.useGlobalXxx()`：
//   ① 走 DI：守卫 / 拦截器要注入 `JwtService`、`ContextService`、`Reflector` —— `useGlobalXxx` 只能传裸实例，
//      得手工 new 并自己接依赖，等于把装配知识复制到 main.ts；
//   ② **可测**：`Test.createTestingModule({ imports: [SharedModule] })` 就能验证「全局生效」，
//      不必起真进程（见 shared.module.spec.ts）；
//   ③ 一处可见：四件套的**生效顺序**是本文件最要紧的信息，散在 main.ts 里没人看得出顺序。
//
// ★ 拦截器注册顺序（**别改**）：Nest 响应阶段是**倒序**执行的 ——
//   ResponseInterceptor 注册在最前 → 它在出口**最后**包裹，于是它包住的是
//   「已脱敏、已按数据范围处理」的 data。若顺序反过来，脱敏逻辑就会拿到 `{code,message,...}` 这层壳去处理，
//   既找不到业务字段（白干），又会把壳本身当成数据（错得很难发现）。
//
// ⚠ M0-38 判据原文是「起服后 /docs 响应符合统一包」：`/docs` 由 M0-48 的 Swagger 提供，
//   且它是**中间件直出的 HTML**、不经拦截器 —— 故「统一包」真正适用于 **API 处理器**。
//   本批次先证「全局四件套真的生效」（spec 里起真 HTTP 服务逐条断言），`/docs` 到 M0-48 再核对。
// =============================================================================
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { ACCESS_TOKEN_TTL, ContextModule, requireJwtSecret } from '../kernel/index';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { DataScopeInterceptor } from './interceptors/data-scope.interceptor';
import { DesensitizeInterceptor } from './interceptors/desensitize.interceptor';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { AppValidationPipe } from './pipes/validation.pipe';

// ⚠ 密钥口径 `requireJwtSecret` 已于 M1-01 **上移进 kernel**（`kernel/context/jwt-settings.ts`）：
//   登录签发（`modules/org`）也要签 `JwtService` 令牌，而业务域**不许 import 本文件**（M0-44c 硬卡），
//   若在此处留一份、在 org 再抄一份，就成了「密钥强度」的第二真相源。故**唯一一份**放在第 0 层 kernel。

@Module({
  imports: [
    // 上下文模块是 @Global()，此处显式 import 是为了让 SharedModule **自给自足**
    // （spec 里单独 createTestingModule 也能解析出 ContextService，不依赖 app.module）
    ContextModule,
    // registerAsync（而非 register）：register 在**模块加载期**求值，那时 main.ts 还没 loadEnvFile，
    // 会读到 undefined；registerAsync 的工厂在**DI 初始化期**执行，.env 已就位。
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret(),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL },
      }),
    }),
  ],
  providers: [
    // ① 鉴权：解 JWT → 填上下文；无 token → 401 / 20002（M0-32）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // ② 统一响应包：**必须第一个注册**（响应阶段倒序执行，它才能在最外层包裹）
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // ③ 数据范围：只把范围**打标到请求上**（M0-36）。★ 判定与注入**不在本拦截器**：
    //     唯一判定＝`kernel/data-scope/data-scope-target.ts`（M5-02），各域 repository 拼 where（M5-03）
    { provide: APP_INTERCEPTOR, useClass: DataScopeInterceptor },
    // ④ 脱敏：**只做出口豁免标记**（M5-06）—— 字段级渲染在各域出口组装出参时完成，
    //     本层**不逐字段改写**（M5-04 定稿，见 desensitize.interceptor.ts 文件头 ★ 段）
    { provide: APP_INTERCEPTOR, useClass: DesensitizeInterceptor },
    // ⑤ 写操作留痕（M5-07）：**增删改一处收口** —— 所有 POST/PUT/PATCH/DELETE 成功后写 `operation_log`
    //     （2026-09-15 七叔口径「符合等保：所有增删改都有迹可查」→ 架构 §7.4）。
    //     ★ 必须**最后注册**：响应阶段倒序执行 ⇒ 它最先跑，拿到的 `data` 是 handler 原始返回值
    //       （还没被 ② 包成 `{code,message,request_id,data}`），才能取出参里的 `id` 当 `target_id`。
    //     ⚠ 只写库、**不改出参**；动作名由域 controller 的 `@Audit('模块.动词')` 给（→ kernel/audit/audit.decorator.ts）。
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    // ⑥ 异常映射：所有失败出口收成统一包（M0-34）
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // ⑦ 入参校验：坏 DTO → 400 / 20001 ＋ 字段级人话（M0-35）
    { provide: APP_PIPE, useClass: AppValidationPipe },
  ],
})
export class SharedModule {}

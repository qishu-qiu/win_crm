// =============================================================================
// kernel 汇总导出（M0-31）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.2 / §5.4：`src/kernel/` ＝ 第 0 层内核（零业务、谁都能用）；
//     七域与 `shared/` 都只依赖它，**它不依赖任何人**。
//   · 《开发计划-V1》M0-31 判据：`tsc --noEmit` 通过。
//
// 用法（各域 / 横切层一律走这里，★ 不要深挖到具体文件）：
//   import { AppError, ErrorCode, resolvePagination, bigintToJson } from '@/kernel';
// 好处＝**换实现不动调用方**：文件挪位 / 拆分只改本文件一处，
// 而不是让几十个文件各写一条深路径（那是「改一处漏两处」的温床）。
//
// ⚠ **`@/` 别名只能用在测试里**（2026-09-14 实测）：`tsconfig.json` 的 `paths` 是**编译期**映射，
//   `tsc` **不会**把产物里的 `@/kernel` 改写成相对路径 —— 源码里一旦这么写，`node dist/main.js`
//   到运行时才报「Cannot find module '@/kernel'」（还能骗过 `tsc --noEmit` 与 jest，因为 jest 有
//   `moduleNameMapper`）。故 **src 内一律相对路径**（如 `../../kernel`），别名留给 spec。
// =============================================================================
export * from './errors/app-error';
export * from './errors/prisma-error.mapper';
export * from './common/bigint';
export * from './common/masking';
// M5-05：跨业务线脱敏判定（「按部门比」的**唯一入口**）＋ 打码形态常量
export * from './common/desensitize';
export * from './common/pagination';
// M6-15：JSON 列拉直（`nav_open` / `tags` 等）—— 原先在 A 域仓储里，B 域要用时
// **跨域 import 对方的 repository 被 ESLint 硬卡**（§5.4），故按「通用能力上收 kernel」合并成一份
export * from './common/json';
export * from './context/request-context';
export * from './context/jwt-claims';
export * from './context/jwt-settings';
export * from './context/public.decorator';
// M5-06：出口豁免脱敏标记（报表 / 看板 / 汇总）—— 要写在**域 controller** 上，故与 `@Public()` 同居 kernel/context
export * from './context/desensitize-exempt.decorator';
export * from './context/context.module';
// M5-02：数据范围判定（「我能看到谁」的**唯一入口**）—— 各域一律调它，**别自己判 `scope.type`**。
// ⚠ `domain/**` 例外：只能用深路径 `kernel/data-scope/data-scope-target` —— 本桶文件会连带
//   import `@nestjs/*`（audit 等），而 `domain/**` 的硬约束是**零框架依赖**（架构 §5.4）。
export * from './data-scope/data-scope-target';
// 2026-09-15：可写角色的**唯一判定点**（`admin` / 交付 · 客服只读；多角色取「能写」）——
// 各域写入口一律调它，**别在域内各写一份角色数组**。
export * from './data-scope/write-role';
export * from './events/domain-event';
export * from './events/event-bus';
// M4-11：总线的 DI 装配点（`@Global()`），调用方只 import 令牌 `EventBus`
export * from './events/event-bus.module';
export * from './audit/transaction-context';
export * from './audit/audit.service';
export * from './audit/audit.module';
// M5-07：写操作留痕标记（`@Audit('模块.动词')` / `@AuditSkip()`）—— 要写在**域 controller** 上，
// 故与 `@Public()` / `@DesensitizeExempt()` 同居 kernel（域不许直连 shared，→ §5.4）。
export * from './audit/audit.decorator';
// D-06（2026-09-20 拍板）：幂等键存取 —— 只在**横切层**用（`shared/interceptors/idempotency.interceptor.ts`）；
// 业务域不直接碰它（幂等是横切能力，不是业务规则）
export * from './idempotency/idempotency.service';

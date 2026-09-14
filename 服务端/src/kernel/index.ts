// =============================================================================
// kernel 汇总导出（M0-31）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §5.2 / §5.4：`src/kernel/` ＝ 第 0 层内核（零业务、谁都能用）；
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
export * from './common/pagination';
export * from './context/request-context';
export * from './context/jwt-claims';
export * from './context/jwt-settings';
export * from './context/public.decorator';
export * from './context/context.module';
export * from './events/domain-event';
export * from './events/event-bus';
export * from './audit/transaction-context';
export * from './audit/audit.service';
export * from './audit/audit.module';

// =============================================================================
// 审计模块（M1 补齐 —— M0-30 只落了 `AuditService`，没落它的**装配点**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §5.2 / §5.4：`kernel/**` ＝ 第 0 层内核（零业务、谁都能用），
//     七域与 `shared/` 都只依赖它。审计正是「谁都要用」的内核设施（§7.4 敏感动作一律留痕）。
//   · 同 §5.2 / §5.3 的既有做法：内核设施模块声明 `@Global()`（对照 `context.module.ts` /
//     `prisma.module.ts`），七域不必逐个 import，且**全应用共用同一个实例**。
//
// ★ 为什么必须补这一层（不是顺手加的）：
//   M1-15 判据要求「登录成功 / 失败写 `operation_log`（**事务内**）」，而 `OrgService` 要注入
//   `AuditService`。若让每个域各自 `providers: [AuditService]`：
//     ① 每个域各造一个实例 —— 将来审计若要带进程内状态（如批量缓冲），立刻出现「谁的实例算数」的问题；
//     ② 「审计是内核设施」这条结构事实会被 30 处 `providers` 数组摊平，没人看得出它归谁管。
//   ⚠ 分层上**只能**这么放：业务域不许 import `shared/**`（M0-44c 硬卡），
//     所以「装配点」必须落在 `kernel/`（域唯一被允许依赖的层）。
//
// ⚠ 诚实标注：本文件**不是**《开发计划》里的既有编号任务（M0-30 只写 `audit.service.ts`），
//   属 M1 动工中发现的装配缺口，已记入 M1 完成报告；判据仍取 M1-15（审计真落库、事务内）。
// =============================================================================
import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

/**
 * 审计模块：`@Global()` 全局可见，`AuditService` **全应用唯一一份**。
 * 真正的装配发生在 `app.module.ts`（组装 kernel 那一层，装配知识一处可见）。
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

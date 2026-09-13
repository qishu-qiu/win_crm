// =============================================================================
// Prisma 模块（M0-47）—— `@Global` 导出 PrismaService
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M0-47：`prisma.module.ts`（`@Global` 导出 PrismaService）；
//     判据逐字＝「任意处注入可用」。
//
// ★ 为什么用 `@Global()`：业务域按架构 §5.4 只许依赖更低层，而「数据库」不是某一域的私有物 ——
//   若每个域各 import 一次 PrismaModule，等于把「连接池只该有一份」这件事交给几十处自觉。
//   `@Global` 下全应用共用**同一个** PrismaService 实例（＝同一个连接池），注入处无需写 imports。
//   ⚠ 注意边界：**能被注入 ≠ 能随便用**。`domain/**` 与业务域不许碰 Prisma 仍由 ESLint 硬卡，
//     `@Global` 只解决「装配」问题，不放松「分层」纪律。
//
// ★ 为什么这里没有 `imports`：本模块只包一个自有 provider，不依赖任何别的模块。
//   它在 `app.module.ts` 被显式 import（装配知识一处可见），故无需 @Global 之外的任何开关。
// =============================================================================
import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

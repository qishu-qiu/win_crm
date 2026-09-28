// =============================================================================
// 外出登记（visit）模块 —— 纯行政考勤域（→ 需求 §7.5 / 架构 C6）
//
// ★ 本模块**不依赖任何业务域**（不 import 其他 `modules/*` 内部文件，ESLint 硬卡）：
//   只管 `visit_log` 自己的增 / 查 / 回；不产业务事件、不写跨域字段。
//   全局依赖（kernel 上下文 / Prisma / 审计）由根模块 `@Global` 注入，这里不重复 import。
// =============================================================================
import { Module } from '@nestjs/common';
import { VisitController } from './visit.controller';
import { VisitService } from './visit.service';
import { VisitRepository } from './visit.repository';

@Module({
  controllers: [VisitController],
  providers: [VisitService, VisitRepository],
  exports: [VisitService],
})
export class VisitModule {}

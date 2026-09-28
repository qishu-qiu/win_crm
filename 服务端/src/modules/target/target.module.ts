// =============================================================================
// 目标模块（M8-06 Phase 4 切片 1）
//
// 架构定位：报表/目标域（非七业务域之一，属「聚合/报表」类模块，→ 接口 §5.13）。
// 本模块只读 `target` + `contract` + `business_relation` + `department`/`employee`（均为 Prisma 直读，
// 不经过其它域 service，**不违反模块边界**），不做写操作、不发布领域事件。
// =============================================================================
import { Module } from '@nestjs/common';
import { TargetController } from './target.controller';
import { TargetRepository } from './target.repository';
import { TargetService } from './target.service';

@Module({
  controllers: [TargetController],
  providers: [TargetService, TargetRepository],
})
export class TargetModule {}

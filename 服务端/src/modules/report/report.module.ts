// =============================================================================
// 报表/看板模块（M8-06 Phase 4 切片②）
//
// 架构定位：报表/目标类模块（非七业务域之一，→ 接口 §5.13）。
// 口径来源：看板 KPI 只读 `business_relation` / `commitment` / `contract`（Prisma 直读，不绕业务域），
// `sea_todo` 复用 `SeaService`（跨域走"调对方 exports 的 service"，→ 架构 §5.2 路之①）。
// 本模块只读、不写、不发领域事件。
// =============================================================================
import { Module } from '@nestjs/common';

import { SeaModule } from '../sea/sea.module';
import { ReportController } from './report.controller';
import { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

@Module({
  imports: [SeaModule],
  controllers: [ReportController],
  providers: [ReportService, ReportRepository],
})
export class ReportModule {}

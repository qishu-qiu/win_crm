// =============================================================================
// E 域模块（M9-E / B2）—— 交易与服务（合同）第一层
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》§六 E 域（首域，解锁 D-01/D-02/D-10/D-61）。
//   · 《销售CRM架构设计说明》§5.1 分层：E 域（L4）**可以** import A/B/C 域（严格更低的层），
//     **不许** import D~G（同层 / 更高层），由 ESLint `no-restricted-imports` 硬卡。
//   · 跨域取引用走对方 **exports 的 service**（本文件 `imports` 只列
//     `OrgModule` / `CompanyModule` / `RelationModule`，**绝不**碰对方的 repository）。
//   · 同 §5.2：导出 `TradeService` 供聚合层 / 其他域（如 report）消费，
//     **不导出 repository**（导出了就等于允许别人绕过本域规则直接写表）。
// =============================================================================
import { Module } from '@nestjs/common';

import { CompanyModule } from '../company/company.module';
import { OrgModule } from '../org/org.module';
import { RelationModule } from '../relation/relation.module';
import { TradeController } from './trade.controller';
import { TradeRepository } from './trade.repository';
import { TradeService } from './trade.service';

@Module({
  imports: [OrgModule, CompanyModule, RelationModule],
  controllers: [TradeController],
  providers: [TradeRepository, TradeService],
  exports: [TradeService],
})
export class TradeModule {}

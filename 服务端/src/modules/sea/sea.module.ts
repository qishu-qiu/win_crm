// =============================================================================
// F 域模块（F-01）—— 公海（第 4 层，与 D / E / G **同层**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.1 分层：`L3 relation(C) ＜ L4 engine(D) / trade(E) / sea(F) / approval(G)`
//     —— 本模块**可以** import C 域（严格更低的层），但**不许** import D / E / G
//     （同层 / 更高层），由 ESLint `no-restricted-imports` 硬卡（M0-44 系列）。
//   · 同 §5.2 跨域三条路之①：认领本体要 C 域的表 → 调**它 exports 的 service**
//     —— 故 `imports` 里只出现 `RelationModule`（**绝不**碰对方的 repository）。
//
// ★ 为什么 `exports` 为空：目前没有别的域要问「公海」什么
//   （D 域那条「将来问多少天没有效沟通」的注记是 M7 后续片的事，用时再加，
//     **不预先导出没人用的东西**）。
// =============================================================================
import { Module } from '@nestjs/common';

import { RelationModule } from '../relation/relation.module';
import { SeaController } from './sea.controller';
import { SeaRepository } from './sea.repository';
import { SeaService } from './sea.service';

@Module({
  imports: [RelationModule],
  controllers: [SeaController],
  providers: [SeaRepository, SeaService],
})
export class SeaModule {}

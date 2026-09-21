// =============================================================================
// F 域模块（F-01）—— 公海（第 4 层，与 D / E / G **同层**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.1 分层：`L3 relation(C) ＜ L4 engine(D) / trade(E) / sea(F) / approval(G)`
//     —— 本模块**可以** import C 域（严格更低的层），但**不许** import D / E / G
//     （同层 / 更高层），由 ESLint `no-restricted-imports` 硬卡（M0-44 系列）。
//   · 同 §5.2 跨域三条路之①：认领本体要 C 域的表 → 调**它 exports 的 service**
//     —— 故 `imports` 里只出现 `RelationModule`（**绝不**碰对方的 repository）；
//     ★ M9-F 规则配置片再加 `OrgModule`（L1，**可以**依赖）：规则出参要把 `dept_id` /
//       `product_line_id` 翻成名字（`department` / `product_line` 是 A 域的表，跨域不许查）。
//
// ★ 为什么 `exports: [SeaService]`（M7-03 补）：**Worker 的掉海预警任务**要调
//   `SeaService.scanSeaWarning`（`jobs/` 不是业务域，是"用这个域的人"，→ `jobs.module.ts`）。
//   ⚠ 导出的是 **service 不是 repository**：调用方只能走本域编排，不能绕过规则直接碰表
//   （同 C 域 `exports: [RelationService]` 的口径）。
//   ⓘ 本域**不导出给任何业务域**（F 域仍无人被别域依赖）；这条出口的服务对象是 jobs。
// =============================================================================
import { Module } from '@nestjs/common';

import { OrgModule } from '../org/org.module';
import { RelationModule } from '../relation/relation.module';
import { SeaController } from './sea.controller';
import { SeaRepository } from './sea.repository';
import { SeaService } from './sea.service';

@Module({
  imports: [OrgModule, RelationModule],
  controllers: [SeaController],
  providers: [SeaRepository, SeaService],
  exports: [SeaService],
})
export class SeaModule {}

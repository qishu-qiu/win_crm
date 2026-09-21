// =============================================================================
// 公司详情聚合层（D-61 桥③ · 2026-09-21）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《欠账登记表》D-61（已拍板 2026-09-21）：`GET /companies/:id` 的跨域字段
//     `relations_summary` / `event_count_30d` 需查 C / D / E 域，而 B(L2) 禁止依赖 C(L3)、
//     C 禁止依赖 D/E（架构 §3 层级硬卡）。⇒ 落点＝**本聚合层**（编排层，高于全部业务域），
//     同时合法 import CompanyModule(B) ＋ RelationModule(C)。
//   · ★ 为什么独立成模块（而非塞进 company/relation）：保持 B / C 各自纯净、不破 §3 层级；
//     以后补 `event_count_30d`（D 域）/ `sign_date`/`amount`（E 域）时，只在**本层**加 import ＋
//     拼装，业务域零改动 —— 桥③ 的长期价值（→ 案例库坑 39 / 通例）。
//
// ★ 范围沿革：
//   · 本期（2026-09-21 桥落成）：搭桥 ＋ 迁端点 ＋ 出 **C 域能真实给的** `relations_summary`
//     业务线部分（dept / product_line）。
//   · **2026-09-21 续**：补 `event_count_30d` —— 本层加 import `EngineModule`(D)，D 域出口
//     `countCompanyEvents30d` 再往下调 C 域可见性出口；**B / C / D 三个业务域一行未改**。
//     ✅ 这正是桥③ 的长期价值兑现（加跨域字段只动装配层）。
//   · 仍欠：`sign_date` / `amount`（E 域合同，module 未建）⇒ 暂不出、不编假值（→ D-61 后续）。
// =============================================================================
import { Module } from '@nestjs/common';

import { CompanyModule } from '../company/company.module';
import { EngineModule } from '../engine/engine.module';
import { RelationModule } from '../relation/relation.module';
import { CompanyAggregateController } from './company-aggregate.controller';
import { CompanyAggregateService } from './company-aggregate.service';

@Module({
  imports: [CompanyModule, RelationModule, EngineModule],
  controllers: [CompanyAggregateController],
  providers: [CompanyAggregateService],
})
export class CompanyAggregateModule {}

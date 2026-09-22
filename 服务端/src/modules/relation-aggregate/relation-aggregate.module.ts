// =============================================================================
// 业务关系列表聚合层（D-10 桥③ · 2026-09-22）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《欠账登记表》**D-10**（2026-09-21 七叔定）：C 域列表项缺的 `drop_in_x_days` 改
//     「**访问时实时派生**」（**不进表、不进 `daily_agenda`**）；⚠ 落点卡在层级 ——
//     **C(L3) 读不到 F(L4) 的 `sea_rule`**（架构 §3：只能高层依赖低层）⇒ 归**聚合层编排（桥③）**。
//   · 《销售CRM接口API文档》§4.4 / §5.6：列表项含 `drop_in_x_days`（**派生字段、库不存**）；
//     ⚠ 天数口径（按自然日 / 三档）唯一落点＝需求 §6.3（＋ F 域 `domain/sea-warning.ts` 实现）。
//
// ★ 为什么独立成模块（而不是塞进 `relation/` 或 `sea/`）：
//   ① C 域**不许** import F 域（层级相反）；F 域也不该反向依赖 C 域的列表出参形状；
//   ② 装配只允许发生在**高于全部业务域**的编排层 —— 与 `company-aggregate`（D-61）**同一姿势**：
//      两个业务域各自只多**一个**出口（C 给"锚点"、F 算"天数"），谁都不破 §3 层级。
//   ⓘ 本次 C / F 两域**没有为对方改动任何既有行为**：C 域只多了 `getSeaWarningAnchors`（读），
//     F 域只多了 `listDropCountdown`（读）—— 新增出口不改老出口，是桥③ 能"零风险加字段"的原因。
//   ⇒ 以后关系列表再要带别的域字段（`overdue`(D) / `amount`(E) / `old_customer`(E)…），
//     只需在本层加一个 import ＋ 一段拼装（桥③ 的长期价值，→ 案例库坑 39）。
//
// ★ 本层**不写任何规则**：页签 / 数据范围 / 筛选 / 排序 / 分页全在 C 域 service；
//   "还剩几天掉海"全在 F 域 domain。本层只做一件事 —— **把两个域各自算出的东西拼成接口要的形状**。
// =============================================================================
import { Module } from '@nestjs/common';

import { RelationModule } from '../relation/relation.module';
import { SeaModule } from '../sea/sea.module';
import { RelationAggregateController } from './relation-aggregate.controller';
import { RelationAggregateService } from './relation-aggregate.service';

@Module({
  imports: [RelationModule, SeaModule],
  controllers: [RelationAggregateController],
  providers: [RelationAggregateService],
})
export class RelationAggregateModule {}

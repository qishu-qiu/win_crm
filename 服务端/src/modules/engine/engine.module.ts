// =============================================================================
// D 域模块（M4-01）—— 跟单引擎（第 4 层，只依赖更低的 A / B / C 域 ＋ kernel）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M4-01 判据：建 `modules/engine/` 四层
//     （controller / service / domain / repository）＋ `engine.module.ts`，
//     **`app.module` import 后起服正常**。
//   · 《销售CRM架构设计说明》V1.3 §5.1 分层：第 1 层 org(A) ＜ 第 2 层 company(B)
//     ＜ 第 3 层 relation(C) ＜ **第 4 层 engine(D)** —— 故本模块**可以** import A / B / C 域
//     （严格更低的层），但**不许** import 同层的 `trade(E)` / `sea(F)` / `approval(G)`，
//     由 ESLint `no-restricted-imports` 硬卡（M0-44 系列）。
//   · 同 §5.2 跨域三条路之①：要别人的数据 → 同步调**对方 exports 的 service**
//     —— 故 `imports` 里只出现 `OrgModule` / `CompanyModule` / `RelationModule`
//     （**绝不**碰对方的 repository，跨域直连仓储被 ESLint 拦死）。
//
// ⚠ **本批（M4-01～M4-08）没有 controller**：`POST /relations/:id/events` /
//   `GET /relations/:id/events` 属 M4-12，与「承诺 / 工作台」一起交付（届时才好真库 curl 验证）。
//   故 `controllers: []` 是**有意为之**，不是漏写 —— 起服正常即本条判据达成。
//
// ★ 为什么 `exports: [EngineService]`：F 域（公海）将来要问「多少天没有效沟通」
//   （→ 需求 §6.3 掉海倒计时），那是本域的跨域出口；**不导出 repository**（理由同 C 域）。
// =============================================================================
import { Module } from '@nestjs/common';

import { CompanyModule } from '../company/company.module';
import { OrgModule } from '../org/org.module';
import { RelationModule } from '../relation/relation.module';
import { EngineRepository } from './engine.repository';
import { EngineService } from './engine.service';

@Module({
  imports: [OrgModule, CompanyModule, RelationModule],
  controllers: [],
  providers: [EngineRepository, EngineService],
  exports: [EngineService],
})
export class EngineModule {}

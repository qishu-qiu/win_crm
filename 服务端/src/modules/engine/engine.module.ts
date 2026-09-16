// =============================================================================
// D 域模块（M4-01）—— 跟单引擎（第 4 层，只依赖更低的 A / B / C 域 ＋ kernel）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M4-01 判据：建 `modules/engine/` 四层
//     （controller / service / domain / repository）＋ `engine.module.ts`，
//     **`app.module` import 后起服正常**。
//   · 《销售CRM架构设计说明》§5.1 分层：第 1 层 org(A) ＜ 第 2 层 company(B)
//     ＜ 第 3 层 relation(C) ＜ **第 4 层 engine(D)** —— 故本模块**可以** import A / B / C 域
//     （严格更低的层），但**不许** import 同层的 `trade(E)` / `sea(F)` / `approval(G)`，
//     由 ESLint `no-restricted-imports` 硬卡（M0-44 系列）。
//   · 同 §5.2 跨域三条路之①：要别人的数据 → 同步调**对方 exports 的 service**
//     —— 故 `imports` 里只出现 `OrgModule` / `CompanyModule` / `RelationModule`
//     （**绝不**碰对方的 repository，跨域直连仓储被 ESLint 拦死）。
//
// ★ M4-12～M4-14 起本模块**有 controller**（`engine.controller.ts`）：跟单 / 承诺 / 今日概览
//   三个端点（→ 接口 §5.7）。M4-01 时 `controllers: []` 是「先立骨架」的有意为之，现已补齐。
// ★ 同时挂上**事件订阅者**（`engine-event.subscriber.ts`，M4-11）：订阅属**装配行为**
//   （`onModuleInit` 注册 / `onModuleDestroy` 退订），故放在模块里注册，不塞进 service。
//
// ★ 为什么 `exports: [EngineService]`：F 域（公海）将来要问「多少天没有效沟通」
//   （→ 需求 §6.3 掉海倒计时），那是本域的跨域出口；**不导出 repository**（理由同 C 域）。
// =============================================================================
import { Module } from '@nestjs/common';

import { CompanyModule } from '../company/company.module';
import { OrgModule } from '../org/org.module';
import { RelationModule } from '../relation/relation.module';
import { EngineController } from './engine.controller';
import { EngineEventSubscriber } from './engine-event.subscriber';
import { EngineRepository } from './engine.repository';
import { EngineService } from './engine.service';

@Module({
  imports: [OrgModule, CompanyModule, RelationModule],
  controllers: [EngineController],
  providers: [EngineRepository, EngineService, EngineEventSubscriber],
  exports: [EngineService],
})
export class EngineModule {}

// =============================================================================
// C 域模块（M3-01）—— 业务关系（第 3 层，只依赖更低的 A / B 域 ＋ kernel）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M3-01 判据：建 `modules/relation/` 四层
//     （controller / service / domain / repository）＋ `relation.module.ts`，
//     **`app.module` import 后起服正常**。
//   · 《销售CRM架构设计说明》V1.3 §5.1 分层：第 1 层 org(A) ＜ 第 2 层 company(B)
//     ＜ 第 3 层 relation(C) —— 故本模块**可以** import A / B 域（严格更低的层），
//     但**不许** import D~G（同层 / 更高层），由 ESLint `no-restricted-imports` 硬卡（M0-44 系列）。
//   · 同 §5.2 跨域三条路之①：要别人的数据 → 同步调**对方 exports 的 service**
//     —— 故 `imports` 里只出现 `OrgModule` / `CompanyModule`（**绝不**碰对方的 repository，
//     跨域直连仓储被 ESLint 拦死）。
//
// ★ 为什么 `exports: [RelationService]`：D 域（跟单 / 承诺 / 工作台）要用
//   「这条关系在不在、归谁、什么阶段」—— 那是它的跨域出口；**不导出 repository**
//   （导出了就等于允许别人绕过本域规则直接写表）。
// =============================================================================
import { Module } from '@nestjs/common';

import { CompanyModule } from '../company/company.module';
import { OrgModule } from '../org/org.module';
import { RelationController } from './relation.controller';
import { RelationRepository } from './relation.repository';
import { RelationService } from './relation.service';

@Module({
  imports: [OrgModule, CompanyModule],
  controllers: [RelationController],
  providers: [RelationRepository, RelationService],
  exports: [RelationService],
})
export class RelationModule {}

import { Module } from '@nestjs/common';
import { BusinessRelationModule } from './modules/business-relation/business-relation.module.js';
import { SeaModule } from './modules/sea/sea.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { CompanyModule } from './modules/company/company.module.js';
import { ContactModule } from './modules/contact/contact.module.js';
import { FollowUpModule } from './modules/follow-up/follow-up.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { LedgerFieldTemplateModule } from './modules/ledger-field-template/ledger-field-template.module.js';
import { ApprovalModule } from './modules/approval/approval.module.js';

@Module({
  imports: [
    BusinessRelationModule, // 业务关系激活（铁律：唯一性兜底）✅ 完整
    SeaModule,               // 公海掉落（铁律：时间逻辑）✅ 完整
    AuthModule,
    OrganizationModule,
    CompanyModule,
    ContactModule,
    FollowUpModule,
    NotificationModule,
    LedgerFieldTemplateModule,
    ApprovalModule,
  ],
})
export class AppModule {}

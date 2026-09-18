// =============================================================================
// B 域模块（M2-01 骨架 / M2-11~14 接口）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《开发计划-V1》M2-01 判据：建 `modules/company/` 四层（controller / service / domain /
//     repository）＋ `company.module.ts`，**`app.module` import 后起服正常**。
//   · 《销售CRM架构设计说明》§5.2：`company (B)` 是**第 2 层**，**只能依赖更低的层**
//     —— 即 `kernel` ＋ `org(A)`；不许 import C / D 及更高的任何业务域，也不许 import `shared/**`。
//     ★ M6-15 起 `imports: [OrgModule]`：联系人详情要 **字典文案**（`dict_item`）与
//       **落锁人姓名**（`employee`）—— 这两张表都属 A 域，跨域**不许直查**（§5.2 路之①），
//       故只走 `OrgService` 的出口方法。
//
// ★ 为什么 `exports: [CompanyService]`：架构 §5.2 跨域三条路之①「马上要用结果 → 同步调对方
//   **exports 出来的 service**（禁止查对方的表）」—— M3 建业务关系时要校验公司存在，
//   走的就是这条路；**不导出 repository**（导出了就等于允许别人绕过业务规则写表）。
// =============================================================================
import { Module } from '@nestjs/common';

import { OrgModule } from '../org/org.module';
import { CompanyController } from './company.controller';
import { CompanyRepository } from './company.repository';
import { CompanyService } from './company.service';

@Module({
  imports: [OrgModule],
  controllers: [CompanyController],
  providers: [CompanyRepository, CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}

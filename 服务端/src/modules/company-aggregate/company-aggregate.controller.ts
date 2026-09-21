// =============================================================================
// 公司详情聚合控制器（D-61 桥③）
//
// 分层约束（架构 §5.4）：controller 只解析请求、调一个 service、返回。
// ★ 路由 `GET /companies/:id` 从 B 域 `company.controller` **迁移**至此（桥③ 落点）；
//   B 域不再注册该路由（避免冲突，且 B 不许依赖 C）。
// =============================================================================
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  CompanyDetailVoDto,
  ContactDetailVoDto,
  ContactPageVoDto,
} from '../company/dto/company-response.dto';
import { ListContactsQueryDto } from '../company/dto/company-request.dto';
import { CompanyAggregateService } from './company-aggregate.service';

@ApiTags('公司 / 联系人（聚合）')
@Controller()
export class CompanyAggregateController {
  constructor(private readonly aggregate: CompanyAggregateService) {}

  @Get('companies/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '公司详情（桥③ 聚合层）',
    description:
      '基本档案 ＋ 完善度 ＋ 档案标签 ＋ 联系人简卡 ＋ **业务线列表**（`relations_summary`）＋ ' +
      '**近 30 天跟单计数**（`event_count_30d`）—— 后两者由 D-61 桥③ 聚合层拼装。' +
      '★ 落点：原 B 域 `GET /companies/:id` 于 2026-09-21 迁至本聚合层（B 禁止依赖 C、C 禁止依赖 D/E，' +
      '跨域拼装只能发生在更高编排层）。' +
      '★ `event_count_30d`：**近 30 个自然日**该公司各关系下的跟单条数合计（**派生、不落列**）；' +
      '**只计当前查看者可见的关系**（＝私海那四档范围），**不计系统事件**（建档 / 领取）。' +
      '⚠ 故同一家公司，不同的人看到的这个数字**可以不同**（各自的可见范围不同）—— 这是口径，不是 bug。' +
      '★ `relations_summary` 本期**仅含业务线**（dept / product_line）；`sign_date`/`amount`（E 域合同）待补，' +
      '**不编假值**。★ **公司档案本身是全公司共享资料层，不做数据范围过滤。**',
  })
  @ApiParam({ name: 'id', description: '公司 id（十进制字符串）' })
  @ApiOkResponse({ type: CompanyDetailVoDto })
  getCompany(@Param('id') id: string) {
    return this.aggregate.getCompanyDetail(id);
  }

  // ===== 联系人列表 / 详情（D-28：跨域收敛落在本层）=====

  @Get('contacts')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '联系人列表（桥③ 聚合层）',
    description:
      '**列表出参一律 `phone_masked`**（→ §2.8，出参形态而非权限）。入参 `only_unlinked` ＝只看「**未关联公司**」的待跟进（→ 需求 §6.1 ③）；' +
      '`page`（默认 1）/ `page_size`（默认 20、最大 100），出参 ＝ §2.3 分页形态。' +
      '★ **可见范围（→ 需求 §6.1 ⑪）**：**自己的待关联线索**（归属人＝建档录入人）＋ **自己关系下公司的联系人**（＝我可见关系所对应的公司）；' +
      '`all` 档（总经理 / 管理员，→ 需求 §4.2）不套过滤。⚠ **不再有"全公司裸奔"**。' +
      '★ 落点：本端点 2026-09-21 由 B 域 `company.controller` 迁至本聚合层 —— 「我可见的公司」只有 C 域算得出，' +
      '而 B(L2) 不许依赖 C(L3)，跨域装配只能发生在更高编排层（→《欠账登记表》**D-28** / D-61 桥③）。',
  })
  @ApiOkResponse({ type: ContactPageVoDto })
  listContacts(@Query() query: ListContactsQueryDto) {
    return this.aggregate.listContacts({
      onlyUnlinked: query.only_unlinked === 'true',
      page: query.page,
      pageSize: query.page_size,
    });
  }

  @Get('contacts/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '联系人详情（桥③ 聚合层）',
    description:
      '**详情出参一律给全号 `phone`**（→ §2.8：这是**出参形态、不是权限**）；唯一例外＝被上锁且查看者不是落锁人（`phone` 与 `extra_phones` 两个键都不出现）。' +
      '含**就职 / 跳槽历史**（在职在前）与**谈判特质**。' +
      '★ **可见性**与列表**同一套**（→ 需求 §6.1 ⑪）：待关联线索只给归属人；已挂公司的人须有一条就职记录落在「我可见的公司」里 —— 否则 **403**（不许出现"列表看不到、详情能打开"或反过来）。' +
      '⚠ `unlocked_until`（解锁后 24h 内可见）依赖审批域，本批**不返回**（→ D-04）。',
  })
  @ApiParam({ name: 'id', description: '联系人 id（十进制字符串）' })
  @ApiOkResponse({ type: ContactDetailVoDto })
  getContact(@Param('id') id: string) {
    return this.aggregate.getContact(id);
  }
}

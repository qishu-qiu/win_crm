// =============================================================================
// 公司详情聚合控制器（D-61 桥③）
//
// 分层约束（架构 §5.4）：controller 只解析请求、调一个 service、返回。
// ★ 路由 `GET /companies/:id` 从 B 域 `company.controller` **迁移**至此（桥③ 落点）；
//   B 域不再注册该路由（避免冲突，且 B 不许依赖 C）。
// =============================================================================
import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CompanyDetailVoDto } from '../company/dto/company-response.dto';
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
}

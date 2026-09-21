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
      '基本档案 ＋ 完善度 ＋ 档案标签 ＋ 联系人简卡 ＋ **业务线列表**（`relations_summary`，D-61 桥③ 拼装）。' +
      '★ 落点：原 B 域 `GET /companies/:id` 于 2026-09-21 迁至本聚合层（B 禁止依赖 C，故跨域拼装发生在更高层）。' +
      '★ `relations_summary` 本期**仅含业务线**（dept / product_line）；`sign_date`/`amount`（E 域合同）与' +
      '`event_count_30d`（D 域跟单计数）待对应域就绪后补，**不编假值**。**公司档案是全公司共享资料层，本端点不做数据范围过滤**。',
  })
  @ApiParam({ name: 'id', description: '公司 id（十进制字符串）' })
  @ApiOkResponse({ type: CompanyDetailVoDto })
  getCompany(@Param('id') id: string) {
    return this.aggregate.getCompanyDetail(id);
  }
}

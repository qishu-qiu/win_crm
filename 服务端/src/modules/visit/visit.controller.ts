// =============================================================================
// 外出登记（visit）控制器 —— 只解析请求 → 调 1 个 service → 返回（架构 §2 / §5.4）
//   ★ 不写判断、不碰 Prisma；增删改一律 @Audit 留痕（等保，→ 架构 §7.4）
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Audit } from '../../kernel/index';
import { CreateVisitDto } from './dto/visit-request.dto';
import { VisitLogDto } from './dto/visit-response.dto';
import { VISIT_AUDIT_ACTIONS, VisitService } from './visit.service';

@ApiTags('外出登记 visit')
@Controller('visits')
export class VisitController {
  constructor(private readonly visit: VisitService) {}

  // ===== M8-06 Phase 2-B 外出登记（纯行政考勤，→ 需求 §7.5 / 接口 §4.7·§5.8）=====

  @Audit(VISIT_AUDIT_ACTIONS.create, 'visit_log')
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '登记外出（出去点一下）',
    description:
      '就三样：`depart_at`（出去时间）/ `reason`（去干什么一句话）/ `relation_ids?`（去了哪些客户）。' +
      '★ 纯行政考勤：**不产生业务事件、不关联报销**（→ 需求 §7.5 / §14.2）。`employee_id` 取当前登录人',
  })
  @ApiOkResponse({ type: VisitLogDto })
  createVisit(@Body() body: CreateVisitDto): Promise<VisitLogDto> {
    return this.visit.createVisit(body);
  }

  @Audit(VISIT_AUDIT_ACTIONS.return, 'visit_log')
  @Post(':id/return')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '回来点一下',
    description: '只写 `actual_return_at`（纯行政）。已回过的再点 → **422**；不是自己的 → **404**',
  })
  @ApiParam({ name: 'id', description: '外出登记 id（十进制字符串）' })
  @ApiOkResponse({ type: VisitLogDto })
  returnVisit(@Param('id') id: string): Promise<VisitLogDto> {
    return this.visit.returnVisit(id);
  }

  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '我的外出记录',
    description:
      '按 `depart_at` 倒序、最近 50 条；可选 `?date=YYYY-MM-DD` 只看某天（本地日）。`employee_id` 取当前登录人',
  })
  @ApiOkResponse({ type: [VisitLogDto] })
  listMyVisits(@Query('date') date?: string): Promise<VisitLogDto[]> {
    return this.visit.listMyVisits({ date });
  }
}

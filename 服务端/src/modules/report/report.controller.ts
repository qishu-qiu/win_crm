import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DashboardResultDto } from './dto/report-response.dto';
import { type DashboardResult, ReportService } from './report.service';

@ApiTags('report')
@Controller('reports')
@ApiBearerAuth('bearer')
export class ReportController {
  constructor(private readonly report: ReportService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: '经营看板',
    description:
      '**部门经理 / 总经理 / 管理员可见**（销售 / 交付·客服 403）。KPI：今日新增、今日待跟进、本月签约额（环比上月）。' +
      '`sea_todo` 复用 `GET /sea/manager-todo`（公海停留超期待决策）。' +
      '5 个列表分区均已落真实数据：`pending_todo`（承诺到期/逾期未办明细）、`warnings`（签约到期/新商机/掉公海 3 卡）、' +
      '`dept_compare`（部门当月签约额对比）、`top_sales`（销冠榜）、`zombie_weekly`（周重点僵尸榜，→ 需求 §8.2）；形状见接口 §5.13。' +
      '⚠ 报表/看板**不脱敏**（§2.4）返回真实金额。',
  })
  @ApiOkResponse({ type: DashboardResultDto })
  getDashboard(): Promise<DashboardResult> {
    return this.report.getDashboard();
  }
}

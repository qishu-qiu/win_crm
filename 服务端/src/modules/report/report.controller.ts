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
      '`sea_todo` 复用 `GET /sea/manager-todo`（公海停留超期待决策）。`pending_todo` / `warnings` / `dept_compare` / ' +
      '`top_sales` / `zombie_weekly` 在接口 §5.13 仍为占位、形状待定（→ 欠账 D-33 ⑤），本版回 `[]`。' +
      '⚠ 报表/看板**不脱敏**（§2.4）返回真实金额。',
  })
  @ApiOkResponse({ type: DashboardResultDto })
  getDashboard(): Promise<DashboardResult> {
    return this.report.getDashboard();
  }
}

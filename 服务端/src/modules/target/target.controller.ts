// =============================================================================
// 目标控制器（M8-06 Phase 4 切片 1）
//
// 分层约束（架构 §5.4）：只解析请求、调一个 service、返回；不写判断、不碰 Prisma。
// 口径来源（★ 真相源）：《销售CRM接口API文档》§二/§5.13 `GET /targets/progress`。
// =============================================================================
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TargetProgressResultDto } from './dto/target-response.dto';
import { TargetService, type TargetProgressResult } from './target.service';

@ApiTags('目标')
@Controller()
export class TargetController {
  constructor(private readonly target: TargetService) {}

  @Get('targets/progress')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '目标进度（回款完成率 vs 时间进度）',
    description:
      '**老板/经理可见**（销售 → 403）。返回**当前月(period)**可见 scope（company/dept/employee）的目标进度条：' +
      '`rate`＝回款额/目标额；`time_rate`＝当月已过时间占比；`diff_points`＝回款额−目标额；' +
      '`signed_amount`＝当月签约额。★ 报表/看板**不脱敏**（接口 §2.4）：本接口返回真实金额。' +
      '口径：签约/回款额＝`Contract.sign_date` 落在当月的合计（→ 数据架构 E1）。',
  })
  @ApiOkResponse({ type: TargetProgressResultDto })
  getProgress(): Promise<TargetProgressResult> {
    return this.target.getProgress();
  }
}

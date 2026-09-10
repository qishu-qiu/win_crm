import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SeaEvaluation, SeaService } from './sea.service.js';
import { SeaEvaluateDto } from './sea.dto.js';

@ApiTags('公海')
@Controller('sea')
export class SeaController {
  constructor(private readonly svc: SeaService) {}

  @Post('evaluate')
  @HttpCode(200)
  @ApiOperation({ summary: '公海掉落判定（铁律：时间逻辑 + 客服岗不掉落）' })
  evaluate(@Body() body: SeaEvaluateDto): SeaEvaluation {
    return this.svc.evaluate(
      {
        maintainerRole: body.maintainerRole,
        lastFollowUpAt: body.lastFollowUpAt,
        createdAt: body.createdAt,
        now: body.now,
      },
      { noFollowUpDays: body.noFollowUpDays },
    );
  }
}

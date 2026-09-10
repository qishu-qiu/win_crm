import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivateRelationDto } from './business-relation.dto.js';
import { BusinessRelation } from './business-relation.repository.js';
import { BusinessRelationService } from './business-relation.service.js';

@ApiTags('业务关系')
@Controller('relations')
export class BusinessRelationController {
  constructor(private readonly svc: BusinessRelationService) {}

  @Post('activate')
  @ApiOperation({
    summary: '业务关系激活（铁律：企业×部门×产品线唯一，撞单返409带归属人）',
  })
  activate(@Body() dto: ActivateRelationDto): Promise<BusinessRelation> {
    return this.svc.activate(dto);
  }
}

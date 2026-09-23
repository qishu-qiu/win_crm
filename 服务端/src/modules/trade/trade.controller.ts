// =============================================================================
// E 域控制器（M9-E / B2）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事**——解析请求、调**一个** service 方法、
// 返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§三 / §4.8 / §5.9：`/contracts`（G/P）·`/contracts/:id`（G/U）。
//   · 同 §2.2：一律带 `Authorization: Bearer <access_token>`（本域无 `@Public()`）。
//   · 同 §2.3：成功响应 HTTP 状态码一律 200（2026-09-15 定）⇒ 两个写 POST/PUT 显式 `@HttpCode(200)`；
//     §2.4：400 / 401 / 403 / 409 / 422 由横切层统一出口，**controller 不自己拼错误响应**。
//   · 同 §7.4：写动作标 `@Audit('模块.动词', 'contract')`，统一切面写 `operation_log`；
//     GET 不标（读不审计，管理员查看留痕由 C 域口径单列，本期沿用切面兜底名）。
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Audit, type PageResult } from '../../kernel/index';
import { CreateContractDto, ListContractQueryDto, UpdateContractDto } from './dto/contract-request.dto';
import { ContractPageResultDto, ContractVoDto } from './dto/contract-response.dto';
import { TRADE_AUDIT_ACTIONS, TradeService, type ContractVo } from './trade.service';

@ApiTags('合同')
@Controller()
export class TradeController {
  constructor(private readonly trade: TradeService) {}

  // ===== 创建 =====

  @Audit(TRADE_AUDIT_ACTIONS.create, 'contract')
  @Post('contracts')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '创建合同',
    description:
      '挂在某条业务关系上；`contract_no` 由服务端生成（唯一）。' +
      '可见性走底层关系（跨域 C 域 service）；金额须 > 0；撞号 → **409**。',
  })
  @ApiOkResponse({ type: ContractVoDto })
  createContract(@Body() body: CreateContractDto): Promise<ContractVo> {
    return this.trade.createContract(body);
  }

  // ===== 列表 =====

  @Get('contracts')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '合同列表（按数据范围四档收敛）',
    description:
      '`all`＝全公司；`dept`＝管辖部门；`self`＝我签 / 我 owner 的关系；`serving`＝服务期内（只读）。',
  })
  @ApiOkResponse({ type: ContractPageResultDto })
  listContracts(@Query() query: ListContractQueryDto): Promise<PageResult<ContractVo>> {
    return this.trade.listContracts(query);
  }

  // ===== 详情 =====

  @Get('contracts/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: '合同详情', description: '可见性同底层关系；不存在 → 400' })
  @ApiParam({ name: 'id', description: '合同 id（十进制字符串）' })
  @ApiOkResponse({ type: ContractVoDto })
  getContract(@Param('id') id: string): Promise<ContractVo> {
    return this.trade.getContract(id);
  }

  // ===== 更新 =====

  @Audit(TRADE_AUDIT_ACTIONS.update, 'contract')
  @Put('contracts/:id')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '更新合同',
    description:
      '可改收款方式 / 状态 / 续约 / 服务期 / 附件（只传给了值的字段）。' +
      '交付 / 客服只读 → **403**；其余可写角色须能看到底层关系。',
  })
  @ApiParam({ name: 'id', description: '合同 id（十进制字符串）' })
  @ApiOkResponse({ type: ContractVoDto })
  updateContract(@Param('id') id: string, @Body() body: UpdateContractDto): Promise<ContractVo> {
    return this.trade.updateContract(id, body);
  }
}

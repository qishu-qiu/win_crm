// =============================================================================
// C 域控制器（M3-09 / M3-10 / M3-11）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §三 接口总览：`/relations`（G/P）·`/relations/:id`（G/U）
//     ·`/relations/:id/members`（G/P/U/D）。
//     ⚠ 本批只做 **G/P（列表 / 激活 / 详情 / 改属性 / 成员 G/P）**：
//       `/relations/:id/stage`（推进阶段）·`/labels`·`/transfer`·`/competition`·`/rounds`
//       属后续里程碑（M4 起），**不在本批谎报**。
//   · 同 §2.2：除登录 / 刷新外**一律带** `Authorization: Bearer <access_token>`（本域无 `@Public()`）。
//   · 同 §2.3：**成功响应 HTTP 状态码一律 200**（2026-09-15 定）⇒ 两个 POST 显式 `@HttpCode(200)`；
//     §2.4：400 / 401 / 403 / 409 / 422 由横切层统一出口，**controller 不自己拼错误响应**。
//   · 同 §2.5：非幂等写操作应带 `Idempotency-Key`；该横切能力**尚未实现**（M2 起同一现状），
//     已记入交接说明 §五 —— 本批按现状不额外要求请求头，免得写了不校验（假契约）。
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../kernel/index';
import type { RelationListTab } from './domain/relation-scope';
import {
  AddRelationMemberDto,
  CreateRelationDto,
  ListRelationQueryDto,
  UpdateRelationDto,
} from './dto/relation-request.dto';
import {
  RelationDetailVoDto,
  RelationMemberVoDto,
  RelationVoDto,
} from './dto/relation-response.dto';
import {
  RELATION_AUDIT_ACTIONS,
  RelationService,
  type RelationDetailVo,
  type RelationMemberVo,
  type RelationVo,
} from './relation.service';

@ApiTags('业务关系')
@Controller()
export class RelationController {
  constructor(private readonly relation: RelationService) {}

  // ===== M3-09 列表 / 激活 =====

  @Get('relations')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '业务关系列表',
    description:
      '`tab=private`（默认）＝私海；`tab=sea`＝公海（＝无 owner 的关系）。' +
      '**服务端按数据范围收敛**（→ §2.2）：销售＝我参与的关系 ＋ **我所属部门**的公海；' +
      '经理＝管辖部门；总经理 / 管理员＝全部；**交付 / 客服看公海 → 403**（「不进公海」）。' +
      '⚠ 规格 §5.6 列表项里 `drop_in_x_days` / `overdue` / `amount` / `old_customer` / `is_weekly`' +
      ' 属其它域（M4/M7/E），本批**不返回**（不填假值）；分页属 M6',
  })
  @ApiOkResponse({ type: [RelationVoDto] })
  listRelations(@Query() query: ListRelationQueryDto): Promise<RelationVo[]> {
    return this.relation.listRelations(query.tab === 'sea' ? 'sea' : ('private' as RelationListTab));
  }

  @Audit(RELATION_AUDIT_ACTIONS.activate, 'business_relation')
  @Post('relations')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '激活业务关系',
    description:
      '`{company_id, dept_id, product_line_id}` → 归属**发起人自己**（换人走 `transfer` 审批）。' +
      '同 公司 × 部门 × 产品线 已有活跃关系 → **409 / 20401**（撞单）；' +
      '`dept_id` 必须落在我可建范围内（销售＝我所属部门含兼职；经理＝管辖部门），否则 403',
  })
  @ApiOkResponse({ type: RelationVoDto })
  createRelation(@Body() body: CreateRelationDto): Promise<RelationVo> {
    return this.relation.createRelation(body);
  }

  // ===== M3-10 详情 / 改属性 =====

  @Get('relations/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '业务关系详情',
    description:
      '列表项 ＋ `members`（本批范围；`stage_logs` / `labels` / `competitors` / `rounds` 属后续里程碑）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: RelationDetailVoDto })
  getRelation(@Param('id') id: string): Promise<RelationDetailVo> {
    return this.relation.getRelation(id);
  }

  @Audit(RELATION_AUDIT_ACTIONS.update, 'business_relation')
  @Put('relations/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '改关系属性',
    description:
      '`{urgency?, value_tier?, next_action_hint?, competition?, competitor_id?}`。' +
      '⚠ **非灰度关系必标开发价值**（未标 / 仅 `pending` → **422 / 20403**，→ 数据架构 C1）。' +
      '⚠ 规格 §5.6 是 **`PUT`**（计划行写 PATCH，按铁律以规格为准）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: RelationVoDto })
  updateRelation(@Param('id') id: string, @Body() body: UpdateRelationDto): Promise<RelationVo> {
    return this.relation.updateRelation(id, body);
  }

  // ===== M3-11 成员 =====

  @Get('relations/:id/members')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: '关系成员', description: '含**已撤销**的留痕行（→ C2）' })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: [RelationMemberVoDto] })
  listMembers(@Param('id') id: string): Promise<RelationMemberVo[]> {
    return this.relation.listMembers(id);
  }

  @Audit(RELATION_AUDIT_ACTIONS.addMember, 'business_relation')
  @Post('relations/:id/members')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '加关系成员',
    description:
      '`{employee_id, member_type, source?, valid_until?}`。`owner` **一关系仅一人**（第二位 → 409）；' +
      '`collaborator` 的 `source` 必填：`ask_help`（@求助）**限同部门**（跨部门 403，走正式协同审批），' +
      '未给 `valid_until` 时默认 **7 天**。出参＝**加完之后的成员列表**',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: [RelationMemberVoDto] })
  addMember(@Param('id') id: string, @Body() body: AddRelationMemberDto): Promise<RelationMemberVo[]> {
    return this.relation.addMember(id, body);
  }
}

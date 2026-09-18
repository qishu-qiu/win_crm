// =============================================================================
// C 域控制器（M3-09 / M3-10 / M3-11）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§三 接口总览：`/relations`（G/P）·`/relations/:id`（G/U）
//     ·`/relations/:id/members`（G/P/U/D）。
//     ⚠ 本批只做 **G/P（列表 / 激活 / 详情 / 改属性 / 成员 G/P）**：
//       `/relations/:id/stage`（推进阶段）·`/labels`·`/transfer`·`/competition`·`/rounds`
//       属后续里程碑（M4 起），**不在本批谎报**。
//   · 同 §2.2：除登录 / 刷新外**一律带** `Authorization: Bearer <access_token>`（本域无 `@Public()`）。
//   · 同 §2.3：**成功响应 HTTP 状态码一律 200**（2026-09-15 定）⇒ 两个 POST 显式 `@HttpCode(200)`；
//     §2.4：400 / 401 / 403 / 409 / 422 由横切层统一出口，**controller 不自己拼错误响应**。
//   · 同 §2.5：非幂等写操作应带 `Idempotency-Key`；该横切能力**尚未实现**（M2 起同一现状），
//     已记入《欠账登记表》D-06 —— 本批按现状不额外要求请求头，免得写了不校验（假契约）。
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Audit, type PageResult } from '../../kernel/index';
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
  RelationPageVoDto,
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
      '**M6-07 起分页**：`page`（默认 1）/ `page_size`（默认 20、最大 100），出参＝' +
      ' §2.3 分页形态 `{list,total,page,page_size}`（**不再是裸数组**）；' +
      '**筛选**：`view`（视图：`all` / `following` / `cooperated` / `churned`）＋ `urgency`' +
      '（紧迫档**多选**、逗号分隔）—— `total` 数的是**筛完之后**的总数。' +
      '排序恒 `id desc`（`order_by` / `keyword` 等属后续）。' +
      '⚠ 规格 §5.6 列表项里 `drop_in_x_days` / `overdue` / `amount` / `old_customer` / `is_weekly`' +
      ' 属其它域（M4/M7/E），本批**不返回**（不填假值）',
  })
  @ApiOkResponse({ type: RelationPageVoDto })
  listRelations(@Query() query: ListRelationQueryDto): Promise<PageResult<RelationVo>> {
    return this.relation.listRelations(query.tab === 'sea' ? 'sea' : ('private' as RelationListTab), {
      page: query.page,
      pageSize: query.page_size,
      view: query.view,
      urgencies: query.urgency,
    });
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
      '列表项 ＋ `members`（本批范围；`stage_logs` / `labels` / `competitors` / `rounds` 属后续里程碑）。' +
      '**公海（无主）关系可读**（2026-09-18 定）：按**所属部门**开放 —— 销售＝本部门、经理＝管辖部门、' +
      '总经理 / 管理员＝全部；**别部门 → 403**；**交付 / 客服不进公海**（→ §2.2）',
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
      '⚠ **非灰度关系必标开发价值**：「已标」＝**有值且合法即可，`pending` 也算标过**（2026-09-15 拍板）；' +
      '**完全没标**的非灰度关系 → **422 / 20403**（→ 数据架构 C1）。' +
      '★ **公海（无主）关系的唯一写口**（2026-09-18 定）：**只传 `value_tier`** 时放行' +
      '（开发价值＝**部门共同维护**，**销售也能标**；判定＝在本人读范围内 ＋ 可写角色，**不看 owner**）；' +
      '**再带任何一个别的字段**（含空 body）→ **422 / `20408`**。' +
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
      '未给 `valid_until` 时默认 **7 天**。出参＝**加完之后的成员列表**。' +
      '★ **公海（无主）关系 → 422 / `20408`**（未领取不加成员；2026-09-18 定）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: [RelationMemberVoDto] })
  addMember(@Param('id') id: string, @Body() body: AddRelationMemberDto): Promise<RelationMemberVo[]> {
    return this.relation.addMember(id, body);
  }
}

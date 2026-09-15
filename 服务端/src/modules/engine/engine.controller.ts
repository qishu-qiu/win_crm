// =============================================================================
// D 域控制器（M4-12 / M4-13 / M4-14）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §5.7：`G/P /relations/:id/events`、
//     `G/P/U /relations/:id/commitments`、`G /today-agenda`；§三 总览同。
//     ⚠ 「承诺的 U」规格只给了这一行端点，**没给入参形状** —— 本批按
//       「`id` 指认目标承诺 ＋ 要改的字段」实现，欠账已登记（→ 交接说明 §五）。
//   · 同 §2.2：除登录 / 刷新外一律带 `Authorization: Bearer <access_token>`。
//   · 同 §2.3：**成功响应 HTTP 状态码一律 200**（2026-09-15 定）⇒ 写操作显式 `@HttpCode(200)`；
//     §2.4：400 / 401 / 403 / 409 / 422 由横切层统一出口，**controller 不自己拼错误响应**。
//   · 同 §2.5：非幂等写操作应带 `Idempotency-Key`；该横切能力**尚未实现**（M2 起同一现状），
//     已记入交接说明 —— 本批按现状不额外要求请求头，免得写了不校验（假契约）。
//     ⚠ 跟单的**内容幂等**（同内容重复提交 → 409）本批已生效（→ `domain/event-idempotency.ts`），
//     那是另一回事，不依赖 `Idempotency-Key` 头。
//
// ★ 路由前缀：本文件用 `@Controller()`（无前缀）＋ 全路径写在方法上 ——
//   `/relations/:id/events` 与 C 域 `/relations/:id` **同前缀不同路径**，不冲突；
//   写成 `@Controller('relations/:id/events')` 反而要额外处理 `:id` 的归属。
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  CreateCommitmentDto,
  CreateEventDto,
  ListEventQueryDto,
  UpdateCommitmentDto,
} from './dto/engine-request.dto';
import { ActionEventVoDto, AgendaItemVoDto, CommitmentVoDto } from './dto/engine-response.dto';
import {
  EngineService,
  type ActionEventVo,
  type AgendaItemVo,
  type CommitmentVo,
  type EventRange,
} from './engine.service';

@ApiTags('行动引擎')
@Controller()
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  // ===== M4-12 事件（时间线 / 写跟单）=====

  @Get('relations/:id/events')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '关系时间线（跟单事件）',
    description:
      '**按事件时间倒序**；默认近 1 个月（`range=1m`），`range=all` 取全部。' +
      '可见性**继承业务关系权限**（→ 需求 §10.2）：他人私海 **403**；' +
      '`branch` 的分界基准是**该关系的 owner**（不是当前登录人，→ 决策 #30）。' +
      '⚠ 规格 §5.7 的 `pain_point` / `round_no` 本批**不返回**（卡点字典未接 / 轮次来源未落库）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: [ActionEventVoDto] })
  listEvents(@Param('id') id: string, @Query() query: ListEventQueryDto): Promise<ActionEventVo[]> {
    return this.engine.listEvents(id, query.range === 'all' ? 'all' : ('1m' as EventRange));
  }

  @Post('relations/:id/events')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '记一条跟单',
    description:
      '`{contact_id?,action_type,summary?,outcome?,competition?,competition_note?,duration_min?,' +
      'mentioned_user_ids?}`。' +
      '**有效沟通必须写一句话结果**；快速标记三型（未联系 / 未接 / 说两句挂了）**点一下即可**（→ 需求 §10.2）。' +
      '重复提交（同内容）→ **409**；快速标记**不重置**掉海倒计时（→ 数据架构 D2）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: ActionEventVoDto })
  recordEvent(@Param('id') id: string, @Body() body: CreateEventDto): Promise<ActionEventVo> {
    return this.engine.recordEvent(id, body);
  }

  // ===== M4-13 承诺（建 / 列 / 改）=====

  @Get('relations/:id/commitments')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '某关系的承诺列表',
    description: '可见性同时间线（**继承业务关系权限**）；本批**不分页**（→ 接口 §2.7，M6）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: [CommitmentVoDto] })
  listCommitments(@Param('id') id: string): Promise<CommitmentVo[]> {
    return this.engine.listCommitments(id);
  }

  @Post('relations/:id/commitments')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '建一条承诺',
    description:
      '`{contact_id?,party,ctype,content,due_at?,remind_at?,source_event_id?}`。' +
      '`party`：`me` 我答应客户（催自己）/ `them` 客户答应我（催客户）/ `verdict` 给结论（→ 需求 §10.1）；' +
      '`due_at` 不给＝**未定**（「三快选默认明天」由前端给，服务端不替销售定时间）',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: CommitmentVoDto })
  createCommitment(
    @Param('id') id: string,
    @Body() body: CreateCommitmentDto,
  ): Promise<CommitmentVo> {
    return this.engine.createCommitment(id, body);
  }

  @Put('relations/:id/commitments')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '改承诺（兑现 / 取消 / 豁免 / 改期）',
    description:
      '`{id,status?,waive_reason?,due_at?,remind_at?}`，`status` ∈ `done` 兑现 / `cancelled` 取消' +
      '（**录错了 / 不成立**，不需原因）/ `waived` 豁免（**确有其事但做不成，必填 `waive_reason`**）。' +
      '已结束的承诺（兑现 / 取消 / 豁免）再改 → **422 / 20403**',
  })
  @ApiParam({ name: 'id', description: '关系 id（十进制字符串）' })
  @ApiOkResponse({ type: CommitmentVoDto })
  updateCommitment(
    @Param('id') id: string,
    @Body() body: UpdateCommitmentDto,
  ): Promise<CommitmentVo> {
    return this.engine.updateCommitment(id, body);
  }

  // ===== M4-14 工作台今日概览 =====

  @Get('today-agenda')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '今日该找谁（工作台）',
    description:
      '**只返回登录人自己的**动线条目（`daily_agenda.user_id`），且只含 `open` / `snoozed`（已办的 `done` / `ignored` 不再推）。' +
      '⚠ 本批**不实时组装**：条目由每日 05:00 的组装任务产生（属 M7），库里没有当日行就是**空数组**。' +
      '`relation` 可为 `null`（「只有联系人、还没挂关系」的提醒，→ 数据架构 D4）',
  })
  @ApiOkResponse({ type: [AgendaItemVoDto] })
  todayAgenda(): Promise<AgendaItemVo[]> {
    return this.engine.todayAgenda();
  }
}

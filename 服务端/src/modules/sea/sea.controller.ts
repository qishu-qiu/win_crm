// =============================================================================
// F 域控制器（M7-01）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§三 接口总览：公海端点 `G /sea/company`、`G /sea/department`、
//     **`P /sea/company/:id/claim`**、`G /sea/records`、`G /sea/manager-todo`、
//     `P /sea/manager-decision`、`G/U /sea/rules` —— **本片只做 claim 一条**，
//     其余属 M7 后续片（列表当前由 `GET /relations?tab=sea` 顶替，→ 施工单 §三「不做」表）。
//   · 同 §2.2：除登录 / 刷新外**一律带** `Authorization: Bearer <access_token>`（本域无 `@Public()`）。
//   · 同 §2.3：**成功响应 HTTP 状态码一律 200** ⇒ 本 POST 显式 `@HttpCode(200)`；
//     §2.4：400 / 401 / 403 / 409 / 422 由横切层统一出口，**controller 不自己拼错误响应**。
//   · 同 §2.5：`Idempotency-Key` 横切**尚未实现**（→《欠账登记表》D-06，同现状不额外要求请求头）；
//     本端点的**语义幂等**由 C 域出口保证：重复调用时第二次定位不到公海关系（已是私海）→ **400**。
//
// ★ 留痕（架构 §7.4「所有增删改都有迹可查」）：标 `@Audit(SEA_AUDIT_ACTIONS.claim, 'company')`
//   —— 对象类型取**路径参数指向的对象**（路径里是**公司 id**，故记 `company`），
//   与 D 域 `POST /contacts/:id/activate-relation` 标 `'contact'` 同一取法。
// =============================================================================
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../kernel/index';
import { ClaimSeaRelationDto } from './dto/sea-request.dto';
import { SeaClaimVoDto } from './dto/sea-response.dto';
import { SEA_AUDIT_ACTIONS, SeaService, type SeaClaimVo } from './sea.service';

@ApiTags('公海')
@Controller()
export class SeaController {
  constructor(private readonly sea: SeaService) {}

  @Audit(SEA_AUDIT_ACTIONS.claim, 'company')
  @Post('sea/company/:id/claim')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '领取公海客户到私海',
    description:
      '`{dept_id, product_line_id}` 定位「公司 × 部门 × 产品线」下**那一条公海关系**（与 `POST /relations` 同形）。' +
      '**谁能领**＝可写角色 ＋ 读范围（销售＝本部门公海、经理＝管辖部门、总经理＝全部；' +
      '**管理员（只读）与交付 / 客服一律 403**）—— 与公海读门同一档，不另开一格权限。' +
      '**抢到才算**：条件 UPDATE（`sea_status = company_sea`）影响 1 行，并发被同事先领走 → **409**；' +
      '定位不到（本就无 / 刚刚被领走）→ **400**；`dept_id` / `product_line_id` / 公司不存在 → **400**。' +
      '**幂等（语义）**：领成功后关系已是私海，重复调用 → 400（**不是 500、不会双写**）。' +
      '**级联**：阶段回到 1（新一轮，上一轮阶段留痕保留）＋ owner 成员切给领取人 ＋ ' +
      '该关系所有 **open 承诺 `owner_id` 转新 owner**（承诺随关系走，→ 接口 §5.6 尾）；' +
      '入公海历史（`sea_record`）回填 `claimed_by` / `claimed_at`（**没有历史行则不造行**，`claimed_at` 回 `null`）。' +
      '出参＝**关系列表项**（与 §5.6 同一形状）＋ `claimed_at`，前端据此跳 `/relations/:id`',
  })
  @ApiParam({ name: 'id', description: '**公司 id**（十进制字符串）—— 注意不是关系 id' })
  @ApiOkResponse({ type: SeaClaimVoDto })
  claim(@Param('id') id: string, @Body() body: ClaimSeaRelationDto): Promise<SeaClaimVo> {
    return this.sea.claimCompanySeaRelation(id, body);
  }
}

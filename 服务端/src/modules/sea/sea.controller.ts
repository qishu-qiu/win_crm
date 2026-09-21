// =============================================================================
// F 域控制器（F-01）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§三 接口总览：公海端点 `G /sea/company`、`G /sea/department`、
//     **`P /sea/company/:id/claim`**、`G /sea/records`、`G /sea/manager-todo`、
//     `P /sea/manager-decision`、**`G/U /sea/rules`** —— **已落 claim（F-01）＋ rules 两条
//     （M9-F 规则配置片）**；其余属后续片（公海列表当前由 `GET /relations?tab=sea` 顶替
//     →《欠账登记表》D-33 ④）。
//     端点形状的唯一落点＝**§5.16**（rules 两条于 M9-F 回填）。
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
import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../kernel/index';
import { ClaimSeaRelationDto, UpdateSeaRuleDto } from './dto/sea-request.dto';
import { SeaClaimVoDto, SeaRuleUpdateResultDto, SeaRuleVoDto } from './dto/sea-response.dto';
import {
  SEA_AUDIT_ACTIONS,
  SeaService,
  type SeaClaimVo,
  type SeaRuleUpdateResultVo,
  type SeaRuleVo,
} from './sea.service';

@ApiTags('公海')
@Controller()
export class SeaController {
  constructor(private readonly sea: SeaService) {}

  // ===== 公海规则配置（M9-F；→ 接口 §4.14.10 / §5.16）=====

  @Get('sea/rules')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '公海规则列表（L1-L4 ＋ 7 天缓冲预告）',
    description:
      '**含待生效行**（7 天缓冲期内的新版本行也是 `active`，F1 停用的是旧行）—— ' +
      '出参 `pending` 区分"现在就生效"与"将于 X 生效"。' +
      '**谁能看**：老板 / 管理员看全部；部门经理看 L1 / L2 全部（上级兜底）＋ 自己**管辖部门**的 ' +
      'L3 / L4；**销售与交付 / 客服 403**（→ 需求 §6.3 / 前端 §四.2）。' +
      '四个天数各自可为 `null` ＝ 该维度**未配置**（前端请显示"未配置"，**不要回落成默认天数**）',
  })
  @ApiOkResponse({ type: [SeaRuleVoDto] })
  listRules(): Promise<SeaRuleVo[]> {
    return this.sea.listSeaRules();
  }

  @Audit(SEA_AUDIT_ACTIONS.ruleUpdate, 'sea_rule')
  @Put('sea/rules')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '提交公海规则的新版本（7 天缓冲 ＋ 变更前预告影响面）',
    description:
      '`{level,dept_id?,product_line_id?,follow_freq_days?,deal_cycle_days?,stay_days?,' +
      'no_progress_max?,confirmed?}`。**整行覆盖**：没给的字段＝该维度不配（落 `null`），' +
      '不做"缺省＝沿用"的推断。' +
      '**两段式确认**（不新增端点）：`confirmed` 不传 / `false` ⇒ **只回预告**' +
      '（`affected_customers`，**零写库**）；`true` ⇒ 落库（**插新版本行 ＋ 旧行 `status=disabled`**）。' +
      '**新版本 7 天后生效**（`effective_from` ＝提交日 + 7 天），生效瞬间受该规则约束的在途关系' +
      '**倒计时从生效日重新起算**（每个客户至少再给一整轮，→ 需求 §6.3）。' +
      '**谁能改**：L1 / L2 → 老板 / 管理员；L3 / L4 → 该部门的部门经理（或老板 / 管理员）；' +
      '越权 → **403**。层级与两个 key 搭配错 → **400**；部门 / 产品线不存在 → **400**。' +
      '⚠ `confirmed=false` 的预告调用**也会留一条** `sea.rule_update` 审计（配置动作本身即敏感动作，→ 架构 §7.4）',
  })
  @ApiOkResponse({ type: SeaRuleUpdateResultDto })
  updateRules(@Body() body: UpdateSeaRuleDto): Promise<SeaRuleUpdateResultVo> {
    return this.sea.updateSeaRule(body);
  }

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

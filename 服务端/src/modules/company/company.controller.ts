// =============================================================================
// B 域控制器（M2-11 / M2-12 / M2-13 / M2-14）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§三 接口总览：`/companies`（G/P）·`/companies/search-dup`（P）
//     ·`/companies/:id/contacts`（G）·`/contacts`（G/P/U）。
//   · 同 §2.2：除登录 / 刷新外**一律带** `Authorization: Bearer <access_token>`
//     —— 本域**没有** `@Public()`，全部走全局守卫。
//   · 同 §2.3：**成功响应 HTTP 状态码一律 200**（2026-09-15 定）⇒ 三个 POST 显式 `@HttpCode(200)`；
//     §2.4：400 / 401 / 403 / 409 / 422 由横切层统一出口，**controller 不自己拼错误响应**。
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Audit, AuditSkip, type PageResult } from '../../kernel/index';
import {
  COMPANY_AUDIT_ACTIONS,
  CompanyService,
  type CompanyVo,
  type ContactBriefVo,
  type CreatedContactVo,
  type SearchDupResult,
} from './company.service';
import {
  CreateCompanyDto,
  CreateContactDto,
  PageQueryDto,
  SearchDupDto,
} from './dto/company-request.dto';
import {
  CompanyPageVoDto,
  CompanyVoDto,
  ContactCreatedVoDto,
  ContactPageVoDto,
  SearchDupResultVoDto,
} from './dto/company-response.dto';

@ApiTags('公司 / 联系人')
@Controller()
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  // ===== M2-11 公司列表 / 建档 =====

  @Get('companies')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '公司档案列表',
    description:
      '**D-08（2026-09-20）起分页**：入参 `page`（默认 1）/ `page_size`（默认 20、最大 100），' +
      '出参 ＝ §2.3 分页形态 `{list,total,page,page_size}`（**不再是裸数组**）；排序恒 `id desc`' +
      '（§2.7 的 `order_by` / `keyword` 尚未铺到 B 域 →《欠账登记表》D-07）。' +
      '⚠ 接口 §5.4 列表项里的 `relation_count` / `old_customer` 属 C / E 域，跨域不许查表 ⇒ 待 M3/M4 提供',
  })
  @ApiOkResponse({ type: CompanyPageVoDto })
  listCompanies(@Query() query: PageQueryDto): Promise<PageResult<CompanyVo>> {
    return this.company.listCompanies({ page: query.page, pageSize: query.page_size });
  }

  @Audit(COMPANY_AUDIT_ACTIONS.createCompany, 'company')
  @Post('companies')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '建档公司',
    description:
      '服务端生成 `name_core`（供两段式查重第一段）。`credit_code` 撞码 → **409「请使用已有档案」**；' +
      '**疑似重复不拦建档**（需求 §12.1 分支 4：保留「强行新建」出口）',
  })
  @ApiOkResponse({ type: CompanyVoDto })
  createCompany(@Body() body: CreateCompanyDto): Promise<CompanyVo> {
    return this.company.createCompany(body);
  }

  // ===== M2-12 撞库查重 =====

  @AuditSkip() // ★ 语义是**读**（只查重、不改库）—— 不写 operation_log（→ kernel/audit/audit.decorator.ts）
  @Post('companies/search-dup')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '撞库查重',
    description:
      '`phone` / `credit_code` 精确命中 → `same`；`name` 走两段式（`name_core` 前缀收缩 → 编辑距离判级 → `same` / `high_sim`）。' +
      '**有候选即 `suggest=use_exists`**（疑似默认选现有），无候选才 `create_new`',
  })
  @ApiOkResponse({ type: SearchDupResultVoDto })
  searchDup(@Body() body: SearchDupDto): Promise<SearchDupResult> {
    return this.company.searchDup(body);
  }

  // ===== M2-13 联系人建档 =====
  //
  // ⚠ `GET /contacts`（列表）与 `GET /contacts/:id`（详情）**自 2026-09-21 起不在本域注册**：
  //   它们的可见性要「我可见的公司」集合，而那是 C 域算得出来的东西（B(L2) 不许依赖 C(L3)），
  //   故两条读路由迁到**聚合层** `company-aggregate`（→《欠账登记表》D-28 / D-61 桥③）。
  //   本域保留：它们读的**实现**（`CompanyService.listContacts` / `getContact`，收「可见公司集合」入参）。

  @Audit(COMPANY_AUDIT_ACTIONS.createContact, 'contact')
  @Post('contacts')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '建档联系人',
    description:
      '主号先归一（去空格 / `+86` / `-`）再入库；**重复手机号 → 409**（软删后同号可再建）；' +
      '命中历史号只提示 `phone_history_hint`、**不拦截**',
  })
  @ApiOkResponse({ type: ContactCreatedVoDto })
  createContact(@Body() body: CreateContactDto): Promise<CreatedContactVo> {
    return this.company.createContact(body);
  }

  // ===== M6-15 联系人详情（欠账 D-03）=====
  //    ⚠ 路由已迁聚合层，见本文件上一条说明（实现仍在 `CompanyService.getContact`）。

  // ===== M2-14 公司联系人 =====

  @Get('companies/:id/contacts')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '公司联系人',
    description:
      '含**历史就职 / 已离职标记**（`is_current`，→ B5）；**D-08（2026-09-20）起分页**' +
      '（`page` / `page_size`，出参 ＝ §2.3 分页形态）；排序恒 `is_current desc, id desc`（**在职在前**）',
  })
  @ApiParam({ name: 'id', description: '公司 id（十进制字符串）' })
  @ApiOkResponse({ type: ContactPageVoDto })
  listCompanyContacts(
    @Param('id') id: string,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<ContactBriefVo>> {
    return this.company.listCompanyContacts(id, { page: query.page, pageSize: query.page_size });
  }

}

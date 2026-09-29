// =============================================================================
// 公海列表聚合控制器（Phase 6；→ 接口 §5.16 `GET /sea/company` · `/sea/department`）
//
// 分层约束（架构 §5.4）：controller **只做三件事** —— 解析请求、调**一个** service 方法、
// 返回。**不写业务判断、不碰 Prisma**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§三 接口总览：`G /sea/company`、`G /sea/department` ——
//     原由 `GET /relations?tab=sea` 顶替（→《欠账登记表》D-33 ④）；本次补成**专用端点**。
//   · 落点放在**聚合层**（`RelationAggregateService`）：列表本体是 C 域的关系列表（范围收敛 /
//     分页 / 筛选 / 排序），"公海停留信息"是 F 域派生（→ 桥③ 同一姿势，**不新开编排**）。
//   · 为什么是独立控制器而非塞进 `SeaController`：本端点要跨 C / F 两域拼装，必须走聚合层；
//     若在 `SeaController` 里反向注入聚合层会令 `SeaModule ↔ RelationAggregateModule` 成环
//     （架构 §3 层级 / 模块依赖忌循环），故聚合层自己挂一个 `@Controller('sea')` 的控制器，
//     与 `SeaController` 的 `sea/claim`、`sea/rules`、`sea/manager-todo` 平级、互不重叠。
//   · 同 §2.2：一律带 `Authorization: Bearer <access_token>`（无 `@Public()`）。
//   · **数据范围收敛**（→ C 域 `resolveRelationListScope('sea')`）：销售＝本部门公海；
//     经理＝管辖部门；总经理 / 管理员＝全部；**交付 / 客服 → 403**。部门端点 `dept_id` 越范围也 403。
// =============================================================================
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SeaListPageVoDto } from '../relation/dto/relation-response.dto';
import { ListRelationQueryDto, ListSeaDepartmentQueryDto } from '../relation/dto/relation-request.dto';
import { RelationAggregateService } from './relation-aggregate.service';

@ApiTags('公海列表')
@Controller('sea')
export class SeaAggregateController {
  constructor(private readonly aggregate: RelationAggregateService) {}

  /**
   * 系统公海列表（→ §5.16 `GET /sea/company`，Phase 6）。
   *
   * ★ ＝ 原 `GET /relations?tab=sea` 的**专用端点**：同一套 C 域范围收敛 ＋ 同一套 `RelationVo` 映射，
   *   **额外**拼公海停留信息（`sea_entered_at` / `sea_reason` / `days_in_sea` / `stay_days` / `remaining_days`）。
   * ★ 不再用 `tab='sea'` 顶替——菜单固定两项、语义清晰（→ 前端交互文档 §五 页 9/10）。
   * ★ 分页 / 筛选（view / urgency）/ 排序 / 关键词 与 `GET /relations` 同套。
   */
  @Get('company')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '系统公海列表（Phase 6）',
    description:
      '＝ 原 `GET /relations?tab=sea` 的**专用端点**（不再用 `tab` 顶替）。' +
      '**服务端按数据范围收敛**：销售＝本部门公海；经理＝管辖部门；总经理 / 管理员＝全部；' +
      '**交付 / 客服 → 403**（不进公海）。列表项＝关系列表项 ＋ `drop_in_x_days`（公海恒 `null`）＋ ' +
      '公海停留信息（`sea_entered_at` / `sea_reason` / `days_in_sea` / `stay_days` / `remaining_days`）。' +
      '分页 / 筛选（view / urgency）/ 排序 / 关键词 与 `GET /relations` 同套。',
  })
  @ApiOkResponse({ type: SeaListPageVoDto })
  listCompanySea(@Query() query: ListRelationQueryDto) {
    return this.aggregate.listCompanySea({
      page: query.page,
      pageSize: query.page_size,
      view: query.view,
      urgencies: query.urgency,
      orderField: query.order_by,
      ...(query.desc === undefined ? {} : { desc: query.desc === 'true' }),
      keyword: query.keyword,
    });
  }

  /**
   * 部门公海列表（→ §5.16 `GET /sea/department`，Phase 6）。
   *
   * ★ 在 viewer 公海范围内**按单个部门**收敛（`dept_id` 必填，且必须在查看者可读范围内，否则 403）。
   * ★ 其余口径与 `GET /sea/company` 一致。
   */
  @Get('department')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '部门公海列表（Phase 6）',
    description:
      '在 viewer 公海范围内**按单个部门**收敛（`dept_id` 必填，且必须在查看者可读范围内，否则 403）。' +
      '其余口径与 `GET /sea/company` 一致。销售看本部门、经理看管辖部门内某一部门、总经理 / 管理员可任选部门。',
  })
  @ApiOkResponse({ type: SeaListPageVoDto })
  listDepartmentSea(@Query() query: ListSeaDepartmentQueryDto) {
    return this.aggregate.listDepartmentSea(query.dept_id, {
      page: query.page,
      pageSize: query.page_size,
      view: query.view,
      urgencies: query.urgency,
      orderField: query.order_by,
      ...(query.desc === undefined ? {} : { desc: query.desc === 'true' }),
      keyword: query.keyword,
    });
  }
}

// =============================================================================
// 业务关系列表聚合控制器（D-10 桥③）
//
// 分层约束（架构 §5.4）：controller 只解析请求、调**一个** service、返回 —— 不写判断、不碰 Prisma。
// ★ 路由 `GET /relations` 从 C 域 `relation.controller` **迁移**至此（桥③ 落点）：
//   列表项要带 `drop_in_x_days`（只有 F 域算得出），而 C(L3) 不许依赖 F(L4) ⇒ 装配只能在本层。
//   C 域**不再注册**该路由（避免同一路径两个 handler）。
// =============================================================================
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ListRelationQueryDto } from '../relation/dto/relation-request.dto';
import { RelationPageVoDto } from '../relation/dto/relation-response.dto';
import { RelationAggregateService } from './relation-aggregate.service';

@ApiTags('业务关系（聚合）')
@Controller()
export class RelationAggregateController {
  constructor(private readonly aggregate: RelationAggregateService) {}

  @Get('relations')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '业务关系列表（桥③ 聚合层）',
    description:
      '`tab=private`（默认）＝私海；`tab=sea`＝公海（＝无 owner 的关系）。' +
      '**服务端按数据范围收敛**（→ §2.2）：销售＝我参与的关系 ＋ **我所属部门**的公海；' +
      '经理＝管辖部门；总经理 / 管理员＝全部；**交付 / 客服看公海 → 403**（「不进公海」）。' +
      '**分页**：`page`（默认 1）/ `page_size`（默认 20、最大 100），出参＝ §2.3 分页形态' +
      ' `{list,total,page,page_size}`（**不再是裸数组**）；' +
      '**筛选**：`view`（视图：`all` / `following` / `cooperated` / `churned`）＋ `urgency`' +
      '（紧迫档**多选**、逗号分隔）—— `total` 数的是**筛完之后**的总数；' +
      '**排序 / 搜索**：`order_by`（白名单）＋ `desc`（缺省 `true`）＋ `keyword`（公司名，→ §2.7）。' +
      '★ **落点**：本端点 2026-09-22 由 C 域迁至本聚合层 —— 列表项的 `drop_in_x_days`' +
      '（**距掉海还剩几个自然日**，`0`＝今天到期 / 负数＝已过期 / `null`＝判不了；**派生、不落库**）' +
      '只有 F 域算得出，而 C(L3) 不许依赖 F(L4)，跨域装配只能发生在更高编排层' +
      '（→《欠账登记表》**D-10** / D-61 桥③）。⚠ 该字段**照实给，不编假值**：' +
      '公海（无主）/ 没有规则命中 / 规则没配跟进天数 ⇒ `null`。' +
      '⚠ 规格 §5.6 列表项里 `overdue` / `amount` / `old_customer` / `is_weekly` **仍未返回**' +
      '（分属 D / E 域，未就绪）',
  })
  @ApiOkResponse({ type: RelationPageVoDto })
  listRelations(@Query() query: ListRelationQueryDto) {
    return this.aggregate.listRelations(query.tab === 'sea' ? 'sea' : 'private', {
      page: query.page,
      pageSize: query.page_size,
      view: query.view,
      urgencies: query.urgency,
      orderField: query.order_by,
      // ⚠ `desc` 是**三态**（未给 / true / false）：只在给了的时候传 —— 缺省的"降序"由仓储一处定
      ...(query.desc === undefined ? {} : { desc: query.desc === 'true' }),
      keyword: query.keyword,
    });
  }
}

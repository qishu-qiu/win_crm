// =============================================================================
// 业务关系列表聚合服务（D-10 桥③）
//
// 分层约束（架构 §5.4）：本层是**编排层** —— 只调对方 `exports` 的 service、**不碰 Prisma**、不查表。
// 口径来源：详见 `relation-aggregate.module.ts` 文件头（★ 真相源）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import type { PageResult } from '../../kernel/index';
import {
  RelationService,
  type RelationListQuery,
  type RelationListTab,
  type RelationVo,
} from '../relation/relation.service';
import { SeaService } from '../sea/sea.service';

/** 关系列表项（聚合后）＝ C 域列表项 ＋ F 域算出的掉海倒计时 */
export interface RelationListItemVo extends RelationVo {
  /**
   * 距掉海还剩几个**自然日**（Asia/Shanghai 日界；**派生、不落库**）。
   * `0` ＝ 今天到期 / **负数** ＝ 到期日已过（次日掉落）/ `null` ＝ **判不了**（公海、无规则…）。
   * → 出参 DTO 的字段说明见 `relation/dto/relation-response.dto.ts` 的 `RelationListItemVoDto`。
   */
  drop_in_x_days: number | null;
}

/** 公海列表项（聚合后）＝ 关系列表项 ＋ 公海停留信息（Phase 6；→ 接口 §5.16 `GET /sea/company` · `/sea/department`） */
export interface SeaListItemVo extends RelationListItemVo {
  /** 最近一次入公海时刻（ISO） */
  sea_entered_at: string | null;
  /** 入海原因码（→ 数据架构 F2 `sea_record.reason`） */
  sea_reason: string | null;
  /** 已在公海停留的自然日数（北京时间日界） */
  days_in_sea: number | null;
  /** 适用公海停留阈值 `sea_rule.stay_days`；取不到规则 ⇒ `null` */
  stay_days: number | null;
  /** 剩余天数 ＝ `stay_days − days_in_sea`；负数＝已超期；`null` ⇒ `null` */
  remaining_days: number | null;
}

@Injectable()
export class RelationAggregateService {
  constructor(
    private readonly relation: RelationService,
    private readonly sea: SeaService,
  ) {}

  /**
   * 业务关系列表（桥③ 拼装）。
   *
   * ★ 两步，**顺序不可倒**：
   *   ① C 域出**已按数据范围收敛**的一页（页签 / 范围 / 筛选 / 排序 / 分页全是本域规矩）；
   *   ② F 域按**这一页的 id** 算距掉海天数（口径＝需求 §6.3 的"按天"三档）。
   *   ⚠ F 域那个出口**不判数据范围**（它服务的是装配层）⇒ 入参必须是①收敛出来的 id。
   *   先取数再派生；反过来（先随便拿 id 去问天数）就是绕过范围判定
   *   （→ `RelationService.getSeaWarningAnchors` 的 ★ 段）。
   *
   * ★ **公海页签照样问一次**（结果必然是空 map）：判「公海没有掉海倒计时」的地方**只有一处** ——
   *   C 域那条 SQL（`sea_status='private'` ＋ 在位 owner）。在装配层再补一句
   *   `tab === 'sea' → null`，等于把同一条规则记两遍（改一处漏一处）——
   *   多一次往返换"只判一次"，值。
   *
   * ★ 取值口径：**取不到就给 `null`**（不编 `0`、不编默认天数）。编 `0` 会把"这条判不了"
   *   显示成"今天就要掉"，那比空着更坏。
   *
   * @returns 出参＝ §2.3 分页形态；`list` 每项比 C 域多一个 `drop_in_x_days`
   */
  async listRelations(
    tab: RelationListTab,
    query: RelationListQuery = {},
  ): Promise<PageResult<RelationListItemVo>> {
    const page = await this.relation.listRelations(tab, query);
    const countdown = await this.sea.listDropCountdown(page.list.map((row) => row.id));

    return {
      ...page,
      list: page.list.map((row) => ({
        ...row,
        drop_in_x_days: countdown.get(row.id.toString()) ?? null,
      })),
    };
  }

  /**
   * 系统公海列表（→ 接口 §5.16 `GET /sea/company`，Phase 6）。
   *
   * ★ ＝ `listRelations('sea')` 的**专用端点**：同一套 C 域范围收敛（销售＝本部门 / 经理＝管辖 /
   *   总·管＝全部；交付·客服 403）＋ 同一套 `RelationVo` 映射，**额外**拼公海停留信息
   *   （`sea_entered_at` / `sea_reason` / `days_in_sea` / `stay_days` / `remaining_days`）。
   * ★ 不再用 `tab='sea'` 顶替——菜单固定两项、语义清晰（→ 前端交互文档 §五 页 9/10）。
   * ★ 落点：F 域 `listSeaStayInfo` 与 `listDropCountdown` 本就服务装配层，这里只是多拼一份，零新编排。
   */
  async listCompanySea(query: RelationListQuery = {}): Promise<PageResult<SeaListItemVo>> {
    const page = await this.relation.listRelations('sea', query);
    return this.enrichSeaPage(page);
  }

  /**
   * 部门公海列表（→ 接口 §5.16 `GET /sea/department`，Phase 6）。
   *
   * ★ 在 viewer 公海范围内**按单个部门**收敛（范围校验在 C 域 `listSeaRelationsByDept` 内：
   *   越范围 403，不反推）；其余口径与 `listCompanySea` 一致。
   */
  async listDepartmentSea(
    deptId: string,
    query: RelationListQuery = {},
  ): Promise<PageResult<SeaListItemVo>> {
    const page = await this.relation.listSeaRelationsByDept(deptId, query);
    return this.enrichSeaPage(page);
  }

  /** 把一页公海关系（C 域 `RelationVo`）拼上 F 域派生项 → 公海列表项（抽取：两个公海端点共用） */
  private async enrichSeaPage(page: PageResult<RelationVo>): Promise<PageResult<SeaListItemVo>> {
    const ids = page.list.map((row) => row.id);
    const [countdown, stay] = await Promise.all([
      this.sea.listDropCountdown(ids),
      this.sea.listSeaStayInfo(ids),
    ]);
    return {
      ...page,
      list: page.list.map((row) => {
        const stayInfo = stay.get(row.id.toString());
        return {
          ...row,
          drop_in_x_days: countdown.get(row.id.toString()) ?? null,
          sea_entered_at: stayInfo?.sea_entered_at ?? null,
          sea_reason: stayInfo?.sea_reason ?? null,
          days_in_sea: stayInfo?.days_in_sea ?? null,
          stay_days: stayInfo?.stay_days ?? null,
          remaining_days: stayInfo?.remaining_days ?? null,
        };
      }),
    };
  }
}

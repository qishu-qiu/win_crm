// =============================================================================
// 公司详情聚合服务（D-61 桥③）
//
// 分层约束（架构 §5.4）：本层是**编排层**，只调对方 exports 的 service、**不碰 Prisma**、不查表。
// 口径来源：详见 `company-aggregate.module.ts` 文件头（★ 真相源）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { jsonToBigint } from '../../kernel/index';
import { CompanyService, type CompanyDetailVo } from '../company/company.service';
import { RelationService } from '../relation/relation.service';

/** 业务线列表项（＝ C 域 `getRelationsByCompany` 的返回形状；本期 `relations_summary` 子集） */
type RelationsSummaryItem = Awaited<ReturnType<RelationService['getRelationsByCompany']>>;

/** 公司详情（聚合后）：B 域档案 ＋ C 域业务线列表 */
export interface CompanyDetailAggregateVo extends CompanyDetailVo {
  /** 业务线列表（→ §5.4 `relations_summary` 本期子集；sign_date/amount 待 E 域补） */
  relations_summary: RelationsSummaryItem;
}

@Injectable()
export class CompanyAggregateService {
  constructor(
    private readonly company: CompanyService,
    private readonly relation: RelationService,
  ) {}

  /**
   * 公司详情（桥③ 拼装）。
   *
   * ★ 并行取 B 域档案 ＋ C 域业务线列表（一次请求两次往返，别串行）。
   * ★ `company.view` 管理员读留痕由 `CompanyService.getCompany` 内部处理（复用，不重复标）。
   * ★ 不做数据范围过滤：公司档案是全公司共享资料层（→ §5.4）。
   * ★ 本期只填 C 域能真实给的 `relations_summary` 业务线部分；`sign_date`/`amount`（E 域）与
   *   `event_count_30d`（D 域）待对应域就绪后在本层补，**不编假值**。
   */
  async getCompanyDetail(id: string): Promise<CompanyDetailAggregateVo> {
    const companyId = jsonToBigint(id, 'id');
    const [detail, relations] = await Promise.all([
      this.company.getCompany(id),
      this.relation.getRelationsByCompany(companyId),
    ]);
    return { ...detail, relations_summary: relations };
  }
}

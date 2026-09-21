// =============================================================================
// 公司详情聚合服务（D-61 桥③）
//
// 分层约束（架构 §5.4）：本层是**编排层**，只调对方 exports 的 service、**不碰 Prisma**、不查表。
// 口径来源：详见 `company-aggregate.module.ts` 文件头（★ 真相源）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { jsonToBigint, type PageResult } from '../../kernel/index';
import {
  CompanyService,
  type CompanyDetailVo,
  type ContactBriefVo,
  type ContactDetailVo,
  type ListContactsQuery,
} from '../company/company.service';
import { EngineService } from '../engine/engine.service';
import { RelationService } from '../relation/relation.service';

/** 业务线列表项（＝ C 域 `getRelationsByCompany` 的返回形状；本期 `relations_summary` 子集） */
type RelationsSummaryItem = Awaited<ReturnType<RelationService['getRelationsByCompany']>>;

/** 公司详情（聚合后）：B 域档案 ＋ C 域业务线列表 ＋ D 域跟单计数 */
export interface CompanyDetailAggregateVo extends CompanyDetailVo {
  /** 业务线列表（→ §5.4 `relations_summary` 本期子集；sign_date/amount 待 E 域补） */
  relations_summary: RelationsSummaryItem;
  /** 近 30 天该公司各关系下的跟单条数合计（→ §5.4；D-61 桥③，D 域出口） */
  event_count_30d: number;
}

@Injectable()
export class CompanyAggregateService {
  constructor(
    private readonly company: CompanyService,
    private readonly relation: RelationService,
    private readonly engine: EngineService,
  ) {}

  /**
   * 公司详情（桥③ 拼装）。
   *
   * ★ **三路并行**取：B 域档案 ＋ C 域业务线列表 ＋ D 域跟单计数（一次请求三路往返，别串行）。
   * ★ `company.view` 管理员读留痕由 `CompanyService.getCompany` 内部处理（复用，不重复标 —— 本层
   *   与 D 域那个计数出口都**不写**留痕）。
   * ★ 不做数据范围过滤：公司档案是全公司共享资料层（→ §5.4）。⚠ **例外是 `event_count_30d`** ——
   *   它数的是「**我能看见的**关系下的跟单」（收敛在 D 域出口 → C 域可见性出口），
   *   「多人跟过同一家公司、只看见自己那份」是**刻意的**（同一页给不同的人看，跟单数本就该不同）。
   * ★ 只填各域**能真实给的**字段：`relations_summary` 的 `sign_date` / `amount`（E 域合同）
   *   待 E 域 module 就绪后在本层补，**不编假值**（→ D-61 后续）。
   */
  async getCompanyDetail(id: string): Promise<CompanyDetailAggregateVo> {
    const companyId = jsonToBigint(id, 'id');
    const [detail, relations, eventCount] = await Promise.all([
      this.company.getCompany(id),
      this.relation.getRelationsByCompany(companyId),
      this.engine.countCompanyEvents30d(companyId),
    ]);
    return { ...detail, relations_summary: relations, event_count_30d: eventCount };
  }

  // ===== 联系人列表 / 详情（D-28：收敛条件由本层算，B 域只收结论）=====

  /**
   * 联系人列表（→ §5.5 `GET /contacts`）。
   *
   * ★ **本层做的那一件事**：问 C 域「我可见的公司」集合，再把它当**入参**交给 B 域列表 ——
   *   B(L2) 不许依赖 C(L3)，跨域**装配**只能发生在更高编排层（→ D-28 / 桥③）。
   * ★ 可见性口径（→ 需求 §6.1 ⑪）＝ **自己的待关联线索**（B 域自己判归属）＋ **自己关系下公司的联系人**
   *   （本层给的集合）；`null` ＝ 不收敛（`all` 档）。
   * ★ **一次请求两次往返**（集合 ＋ 列表）：集合那条是 `distinct` 窄查询，先取它才谈得上过滤，
   *   无法并行 —— 别为了"看起来并行"把它塞进 `Promise.all`（那是假并行）。
   */
  async listContacts(query: ListContactsQuery): Promise<PageResult<ContactBriefVo>> {
    const visibleCompanyIds = await this.relation.listVisibleCompanyIds();
    return this.company.listContacts(query, visibleCompanyIds);
  }

  /**
   * 联系人详情（→ §5.5 `GET /contacts/:id`）。
   *
   * ★ 与列表**同一套可见性**（同一份集合、同一个判定入口在 B 域 service）：否则会出现
   *   「列表里点得开、详情说无权」或反过来的自相矛盾（→ D-32① 的教训）。
   */
  async getContact(id: string): Promise<ContactDetailVo> {
    const visibleCompanyIds = await this.relation.listVisibleCompanyIds();
    return this.company.getContact(id, visibleCompanyIds);
  }
}

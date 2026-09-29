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
import { TradeService } from '../trade/trade.service';

/**
 * 公司详情业务线汇总项（→ §5.4 `relations_summary`）：部门×业务线 ＋ 该线签约日期 / 跨线金额。
 * ★ 由聚合层从 C 域业务线组合 ＋ E 域已签约合同（按 relation_id 聚合）拼出，业务域零改动（桥③）。
 */
export interface CompanyRelationSummaryItem {
  dept: { id: bigint; name: string };
  product_line: { id: bigint; name: string; color_key: string | null };
  /** 该业务线最近签约日期（ISO 串；多条合同取最大；无签约合同为 `null`） */
  sign_date: string | null;
  /** 该业务线已签约合同金额合计（字符串，两位小数；单位＝元） */
  amount: string;
}

/** 公司详情（聚合后）：B 域档案 ＋ C 域业务线列表（含签约信息）＋ D 域跟单计数 */
export interface CompanyDetailAggregateVo extends CompanyDetailVo {
  /** 业务线列表（→ §5.4 `relations_summary`；dept / product_line 来自 C 域，sign_date / amount 来自 E 域） */
  relations_summary: CompanyRelationSummaryItem[];
  /** 近 30 天该公司各关系下的跟单条数合计（→ §5.4；D-61 桥③，D 域出口） */
  event_count_30d: number;
}

@Injectable()
export class CompanyAggregateService {
  constructor(
    private readonly company: CompanyService,
    private readonly relation: RelationService,
    private readonly engine: EngineService,
    private readonly trade: TradeService,
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
   * ★ 各域**能真实给的**字段都已拼上：`relations_summary` 的 `dept` / `product_line`（C 域）＋
   *   `sign_date` / `amount`（E 域合同，按 relation_id 聚合，→ D-61 桥③，2026-09-29 已补），不编假值。
   */
  async getCompanyDetail(id: string): Promise<CompanyDetailAggregateVo> {
    const companyId = jsonToBigint(id, 'id');
    const [detail, relations, eventCount, contracts] = await Promise.all([
      this.company.getCompany(id),
      this.relation.getRelationsByCompany(companyId),
      this.engine.countCompanyEvents30d(companyId),
      // ★ D-61：E 域已签约合同（sign_date 非空）按 relation_id 归组，聚合进 `relations_summary`
      this.trade.getSignedContractsByCompany(companyId),
    ]);

    // 合同按 relation_id 归组（已签约：sign_date 非空，→ trade 出口已筛）
    const contractsByRelation = new Map<bigint, { sign_date: string | null; amount: string }[]>();
    for (const contract of contracts) {
      const list = contractsByRelation.get(contract.relation_id) ?? [];
      list.push({ sign_date: contract.sign_date, amount: contract.amount });
      contractsByRelation.set(contract.relation_id, list);
    }

    // 按「部门×业务线」聚合：签约日期取最大、金额求和（→ §5.4 `relations_summary`）
    // ★ 一个组合可能对应多条关系（去重只在 C 域展示层做），故遍历每条 relation_id 的合同
    const agg = new Map<string, { sign_date: string | null; amountCents: bigint }>();
    for (const item of relations) {
      const key = `${item.dept.id.toString()}:${item.product_line.id.toString()}`;
      const cur = agg.get(key) ?? { sign_date: null, amountCents: 0n };
      for (const relationId of item.relation_ids) {
        for (const contract of contractsByRelation.get(relationId) ?? []) {
          if (contract.sign_date !== null && (cur.sign_date === null || contract.sign_date > cur.sign_date)) {
            cur.sign_date = contract.sign_date;
          }
          cur.amountCents += BigInt(Math.round(Number(contract.amount) * 100));
        }
      }
      agg.set(key, cur);
    }

    // ★ 剥掉内部中间字段 `relation_ids`，只出参 §5.4 规定的形状（dept / product_line / sign_date / amount）
    const relationsSummary: CompanyRelationSummaryItem[] = relations.map((item) => {
      const key = `${item.dept.id.toString()}:${item.product_line.id.toString()}`;
      const merged = agg.get(key);
      return {
        dept: item.dept,
        product_line: item.product_line,
        sign_date: merged?.sign_date ?? null,
        amount: merged ? (Number(merged.amountCents) / 100).toFixed(2) : '0.00',
      };
    });

    return { ...detail, relations_summary: relationsSummary, event_count_30d: eventCount };
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

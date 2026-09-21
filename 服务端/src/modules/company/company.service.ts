// =============================================================================
// B 域服务（M2-08 / M2-09 / M2-10 / M2-11 ~ M2-14）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、发事件），
//   **不写业务规则**（判级 / 归一在 `domain/`）、**不写 SQL**（在 `company.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.4 / §5.5：建档入参、查重出参（`candidates` ＋ `suggest`）。
//   · 《销售CRM业务需求文档》§12.1 分支 4：命中后**由人点选**（「挂现有公司」/「确认新建」），
//     系统**不自动合并、不自动拦截** ⇒ 本服务只**给候选 + 给建议**，绝不阻断建档。
//   · 《销售CRM数据架构文档》B1：`credit_code` 「**撞码强制使用已有档案**」；
//     B3：`phone_active` 生成列让「软删 / 换号自动释放」；B5：`company_contact` 含历史。
//   · 架构 §5.2 跨域三条路之③：改多表必须一起成功 → **本域 `$transaction`**（禁止跨域大事务）。
//   · 架构 §7.4：**所有增删改都要留痕**（2026-09-15 七叔口径：「**符合等保标准，所有的增删改
//     都有迹可查**」）—— 本域两个写动作（公司建档 / 联系人建档）由**统一审计切面**
//     （`shared/interceptors/audit-log.interceptor.ts`）在端点成功后自动写 `operation_log`，
//     动作名＝本文件导出的 `COMPANY_AUDIT_ACTIONS`，由 controller 的 `@Audit(...)` 声明。
//     ⚠ 原文「建档不在 §7.4 清单里 ⇒ 不写审计」**作废**：那份括号是**举例，不是穷尽清单**。
//
// ★ P2002 的处理姿势（两条都要）：
//   ① **预检**（先查一次）→ 给明确人话，覆盖 99% 的「销售手快」场景；
//   ② **catch 再映射**（`mapPrismaError`）→ 覆盖并发下预检漏过的竞态。
//   只做①会在并发时把 DB 原话透出去；只做②则日常路径也走异常（日志噪音大、人话还得靠映射）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import {
  AppError,
  ErrorCode,
  bigintToJson,
  // D-08（2026-09-20）：B 域列表统一分页 —— 归一化（默认 1/20、超 100 夹紧）与 VO 组装**只在 kernel 一处**
  buildPageResult,
  getRequestContext,
  isBusinessWriteRole,
  jsonToBigint,
  mapPrismaError,
  maskCreditCode,
  maskPhone,
  // JSON 列拉直（M6-15 上收 kernel）：`contact.tags` 要用 —— 原先 A 域仓储里那份**引不动**
  // （跨域直连对方 repository 被 ESLint 硬卡），故两域共用 kernel 这一份
  parseStringList,
  resolvePagination,
  type PageResult,
  type PaginationQuery,
  AuditService,
  type RequestContext,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
// A 域出口（架构 §5.2 路之①）：员工姓名走 `OrgService`、**字典文案走 `DictService`**
// —— 两张表都属 A 域，B 域**不许**直查 `employee` / `dict_item`
import { DictService } from '../org/dict.service';
import { OrgService } from '../org/org.service';
import { compareCompanyNameCore, type CompanyMatchType } from './domain/company-name-similarity';
import { isPhoneLockedForViewer } from './domain/contact-lock';
import { toNameCore } from './domain/company-name';
import { isEmptyPhone, normalizeContactPhone } from './domain/contact-phone';
import { CompanyRepository, type CompanyTxClient, type CreateCompanyData } from './company.repository';
import type { CreateCompanyDto, CreateContactDto, SearchDupDto } from './dto/company-request.dto';

/**
 * B 域写动作的审计动作名（→ A10 口径 `模块.动词`；2026-09-15 定）。
 * ★ 集中一处导出（同 `ORG_AUDIT_ACTIONS` / `RELATION_AUDIT_ACTIONS`）：动作名是检索键，**只增不改**。
 * ⚠ 撞库查重 `POST /companies/search-dup` **语义是读**（不改库），故标 `@AuditSkip()` 不留痕。
 */
export const COMPANY_AUDIT_ACTIONS = {
  /** 建档公司档案 → `POST /companies` */
  createCompany: 'company.create',
  /** 建档联系人 → `POST /contacts` */
  createContact: 'contact.create',
  /** 管理员查看公司详情 → `GET /companies/:id`（→ D-35：仅 `admin` 角色写 `operation_log`） */
  view: 'company.view',
} as const;

/** 公司出参（→ §5.4 列表项；跨域字段 `relation_count` / `old_customer` 待 M3/M4） */
export interface CompanyVo {
  id: bigint;
  full_name: string;
  name_core: string | null;
  city: string | null;
  industry_l1: string | null;
  scale: string | null;
  credit_code: string | null;
  registered_capital: string | null;
  legal_person: string | null;
  address_maintained: boolean;
  updated_at: string;
}

/** 公司档案标签分组（→ §5.4 `profile_tags`；B2：identity / policy 多选，decision_chain 单选） */
export interface CompanyProfileTagGroupVo {
  identity: { tag_id: bigint; tag_code: string; label: string | null }[];
  policy: { tag_id: bigint; tag_code: string; label: string | null }[];
  decision_chain: { tag_id: bigint; label: string | null } | null;
}

/** 公司详情出参（→ §5.4 详情；D-05） */
export interface CompanyDetailVo extends CompanyVo {
  /** 完善度三档（0-100，→ B1 `completeness_1/2/3`） */
  completeness: { c1: number; c2: number; c3: number };
  /** 档案标签（身份 / 制度 / 决策链，→ B2） */
  profile_tags: CompanyProfileTagGroupVo;
  /** 该公司下的联系人简卡（→ §5.4 `contacts[]`；列表 / 卡片一律 `phone_masked`，拍板 Q2） */
  contacts: ContactBriefVo[];
}

/** 查重候选（→ §5.4） */
export interface DupCandidateVo {
  id: bigint;
  full_name: string;
  credit_code_masked: string | null;
  similarity: number;
  match_type: CompanyMatchType;
}

export interface SearchDupResult {
  candidates: DupCandidateVo[];
  suggest: 'use_exists' | 'create_new';
}

/** 联系人简卡（→ §5.5 `ContactBrief`；列表 / 卡片一律打码） */
export interface ContactBriefVo {
  id: bigint;
  name: string;
  position: string | null;
  phone_masked: string;
  phone_locked: boolean;
  decision_role: string | null;
  is_current: boolean;
}

export interface CreatedContactVo {
  id: bigint;
  name: string;
  phone: string;
  phone_history_hint?: string;
}

/** 就职 / 跳槽历史项（→ §5.5 详情 `employments`，B5 `company_contact` 含历史） */
export interface ContactEmploymentVo {
  company_id: bigint;
  company_name: string;
  position: string | null;
  joined_at: string | null;
  left_at: string | null;
  is_current: boolean;
}

/**
 * 谈判特质项（→ §5.5 详情 `traits`，B4 `contact_trait`）。
 * ★ `trait_code` 取自 `contact_trait` **建标记时冗余落库**的那一列；`label` 是**字典文案**
 *   （`dict_item`，A 域的表）—— 字典项被停用 / 删除时给 `null`（**不编文案**，前端显示码本身）。
 */
export interface ContactTraitVo {
  trait_id: bigint;
  trait_code: string;
  label: string | null;
}

/**
 * 联系人**详情**（→ §5.5「详情」形态）。
 * ★ 出参形态（→ §2.8，**是形态不是权限**）：**详情一律全号**；唯一例外＝被上锁且查看者
 *   不是落锁人 —— 此时 `phone` 与 `extra_phones` **两个键都不出现**（锁跟人：主号备用号一并隐藏）。
 * ⚠ 规格详情里还有 `unlocked_until`（申请解锁通过后 24h 内可见）：依赖 G 域审批（`phone_unlock`），
 *   未建 ⇒ 本批**既不给值也不给 `null` 占位**（→《欠账登记表》D-04）。
 */
export interface ContactDetailVo {
  id: bigint;
  name: string;
  /** 主号（全号）；**上锁且查看者非落锁人时该键不出现** */
  phone?: string;
  phone_locked: boolean;
  phone_locked_by: { id: bigint; name: string } | null;
  /** 备用号；**上锁且查看者非落锁人时该键不出现** */
  extra_phones?: { type: string; number: string; note?: string }[];
  wechat: string | null;
  email: string | null;
  gender: string | null;
  birthday: string | null;
  decision_role: string | null;
  tags: string[];
  traits: ContactTraitVo[];
  status: string;
  employments: ContactEmploymentVo[];
}

/** 「同部门 / 别的部门」等提示不进本批；`take` 上限集中在仓储，这里只做去重与排序 */
const MAX_CANDIDATES = 20;

/**
 * 「该联系人已挂过公司」的人话（→ 接口 §5.6：`POST /contacts/:id/activate-relation`
 * 对**不是「待关联」**的联系人给 **409**，防重复触发）。
 * ★ 与 `EVENT_DUPLICATED_MESSAGE` / `RELATION_DUPLICATED_MESSAGE` 同一姿势：**就一句常量** ——
 *   「前置校验」与「写出口复核」两处共用它，改一处即两处生效（两句话＝两套口径）。
 */
const CONTACT_ALREADY_LINKED_MESSAGE = '该联系人已挂过公司，不能重复关联';

/** `GET /contacts` 的查询条件（controller 从 query 翻译过来；→ §5.5） */
export interface ListContactsQuery {
  /** 只看「**未关联公司**」的待跟进联系人（「待关联」视图，→ 需求 §6.1 ③） */
  onlyUnlinked?: boolean;
  /** 页码（归一化在 kernel：默认 1、`< 1` 回第 1 页，→ §2.7；**D-08**） */
  page?: number;
  /** 每页条数（默认 20、超 100 夹紧，→ §2.7；**D-08**） */
  pageSize?: number;
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly repository: CompanyRepository,
    private readonly prisma: PrismaService,
    /** A 域出口·组织与权限（M6-15 起：联系人详情要落锁人姓名） */
    private readonly org: OrgService,
    /** A 域出口·字典（M6-15 起：联系人详情的特质 `label`）—— 与 `org` 分家，见 `DictService` 文件头 */
    private readonly dict: DictService,
    /** 审计留痕（`@Global()` 单例；管理员读路径的 `company.view` 走 `recordStandalone`，→ D-35） */
    private readonly audit: AuditService,
  ) {}

  // ===== M2-08 建档（公司）=====

  /**
   * 建档公司：**服务端生成 `name_core`**（→ B1：建档 / 改名 / 合并时生成并落库），
   * 撞重**预检 ＋ 兜底**（信用代码撞码 → 409「请使用已有档案」）。
   * ★ 注意：**不做「疑似重复就拦住」** —— 需求 §12.1 分支 4 明确「强行新建」是合法出口。
   */
  async createCompany(dto: CreateCompanyDto): Promise<CompanyVo> {
    const operatorId = this.requireWriter();
    const creditCode = dto.credit_code?.trim();

    if (creditCode !== undefined && creditCode !== '') {
      const existing = await this.repository.findCompanyByCreditCode(creditCode);
      if (existing !== null) {
        throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '该统一社会信用代码已存在，请使用已有档案', {
          constraint: 'uk_credit_code',
        });
      }
    }

    const data = buildCompanyData(dto, operatorId, toNameCore(dto.full_name), creditCode);

    try {
      return toCompanyVo(await this.repository.createCompany(data));
    } catch (error) {
      throw mapPrismaError(error) ?? error;
    }
  }

  /**
   * 公司列表（→ §5.4；分页 / 筛选属 M6，本批给最近 100 条）。
   *
   * ★ **刻意不做数据范围过滤**（M5-01 已核，不是漏做）：
   *   `company` ＝ **公司公海本身、全公司唯一共享**（→ 需求 §6.3 / 数据架构 B1）——
   *   销售能看到全部**公司档案**是业务设计；被范围约束的是**业务关系 / 跟单**（C / D 域）。
   *   ⚠ 下个窗口**不要**在这里「补上」`owner` / `dept` 过滤：那会把公司公海打成私海，越改越错。
   */
  async listCompanies(query: PaginationQuery = {}): Promise<PageResult<CompanyVo>> {
    const pagination = resolvePagination(query);
    const { rows, total } = await this.repository.listCompanies(pagination);
    return buildPageResult(rows.map(toCompanyVo), total, pagination);
  }

  // ===== 跨域引用出口（架构 §5.2 路之①：同步调对方 exports 的 service）=====

  /**
   * 公司 `{id, name}` 引用（供 C 域 `company:{id,name}` / `relations_summary` 装配）。
   *
   * ★ 为什么由本域提供：`company` 是 B 域的表，跨域**不许查表**（§5.2）——
   *   C 域只该问「这些 id 对应哪几家、叫什么」，**取数方式不外泄**。
   * ⚠ 只回**未删除、未合并**的公司：合并墓碑 / 已删档案**不给引用**（与详情同口径，
   *   免得列表上出现「已并入别家的那家」）。
   */
  async getCompanyRefs(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    const rows = await this.repository.findCompanyRefsByIds(ids);
    // 出参名按调用方（C 域出参）的键名给 `name`，但**不改 B 域自己的 `full_name` 口径**
    return rows.map((row) => ({ id: row.id, name: row.full_name }));
  }

  /**
   * 联系人 `{id, name}` 引用（**D 域时间线的跨域出口**，M4-08 用）。
   *
   * ★ 为什么由本域提供：`contact` 是 B 域的表，跨域**不许查表**（§5.2）——
   *   D 域只该问「这些 id 对应哪几个人、叫什么」，**取数方式不外泄**。
   * ⚠ 只回**未删除、未合并**的联系人（与 `getCompanyRefs` 同口径）。
   */
  async getContactRefs(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    return this.repository.findContactRefsByIds(ids);
  }

  // ===== M2-09 撞库查重 =====

  /**
   * 撞库查重（→ §5.4 `POST /companies/search-dup`）：
   * `phone` / `credit_code` → **精确命中**（判 `same`）；`name` → **两段式**
   * （`name_core` 前缀收缩候选 → 编辑距离判级）。
   *
   * ★ `suggest` 的口径：**只要有候选就给 `use_exists`** —— 需求 §12.1 分支 4 原文
   *   「疑似同一家**默认选现有**，仍须保留『强行新建』出口」；`create_new` 只在**一条候选都没有**时给。
   */
  async searchDup(dto: SearchDupDto): Promise<SearchDupResult> {
    const phone = dto.phone?.trim();
    const creditCode = dto.credit_code?.trim();
    const name = dto.name?.trim();

    if (!phone && !creditCode && !name) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：phone / credit_code / name 至少给一个', {
        constraint: 'company.search_dup.empty',
      });
    }

    /** 先按 id 去重：同一家公司可能被「手机号」与「名称」两路同时命中 */
    const byId = new Map<string, DupCandidateVo>();

    const push = (row: CompanyRow, matchType: CompanyMatchType, similarity: number): void => {
      const key = bigintToJson(row.id);
      const current = byId.get(key);
      // 同一家已有更高判级（same > high_sim）时不被覆盖
      if (current !== undefined && current.match_type === 'same' && matchType === 'high_sim') return;
      byId.set(key, {
        id: row.id,
        full_name: row.full_name,
        credit_code_masked: row.credit_code === null ? null : maskCreditCode(row.credit_code),
        similarity,
        match_type: matchType,
      });
    };

    if (phone !== undefined && phone !== '') {
      for (const row of await this.repository.findCompaniesByContactPhone(normalizeContactPhone(phone))) {
        push(row, 'same', 1);
      }
    }

    if (creditCode !== undefined && creditCode !== '') {
      const row = await this.repository.findCompanyByCreditCode(creditCode);
      if (row !== null) push(row, 'same', 1);
    }

    if (name !== undefined && name !== '') {
      const core = toNameCore(name);
      if (core !== '') {
        for (const row of await this.repository.findCompanyCandidatesByCore(core)) {
          const verdict = compareCompanyNameCore(core, row.name_core ?? '');
          if (verdict !== null) push(row, verdict.match_type, verdict.similarity);
        }
      }
    }

    const candidates = [...byId.values()]
      .sort((left, right) => {
        if (left.match_type !== right.match_type) return left.match_type === 'same' ? -1 : 1;
        return right.similarity - left.similarity;
      })
      .slice(0, MAX_CANDIDATES);

    return { candidates, suggest: candidates.length > 0 ? 'use_exists' : 'create_new' };
  }

  // ===== M2-10 建档（联系人）=====

  /**
   * 建档联系人：**主号先归一**（去空格 / `+86` / `-`，→ M2-07）→ 撞号预检 → 本域事务
   * （联系人 ＋ 就职关系一起成功，→ 架构 §5.2）。
   * ★ 撞号给 **409 人话**（不把 `Duplicate entry` 透出去）；命中**历史号**只提示、不拦截（→ B6）。
   */
  async createContact(dto: CreateContactDto): Promise<CreatedContactVo> {
    const operatorId = this.requireWriter();
    const phone = normalizeContactPhone(dto.phone);

    if (isEmptyPhone(phone)) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：phone 不能为空', {
        constraint: 'company.contact.phone_empty',
      });
    }

    const duplicated = await this.repository.findContactByPhone(phone);
    if (duplicated !== null) {
      // ⚠ 文案必须与 `kernel/errors/prisma-error.mapper.ts` 里 `uk_phone_active` 那条**逐字一致**：
      //   预检（日常路径）与 P2002 兜底（并发路径）是同一件事，两句话就是两套口径
      //   —— 单测同时钉住两条路径输出同一句（→ 本文件 spec「并发撞号」用例）
      throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '该手机号已存在', {
        constraint: 'uk_phone_active',
      });
    }

    const companyId = dto.company_id === undefined ? undefined : jsonToBigint(dto.company_id, 'company_id');
    if (companyId !== undefined) {
      const company = await this.repository.findCompanyById(companyId);
      if (company === null) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：company_id 指向的公司不存在', {
          constraint: 'company.contact.company_missing',
        });
      }
    }

    const created = await this.prisma
      .$transaction(async (tx) => {
        const client: CompanyTxClient = tx;
        const contact = await this.repository.createContact(
          {
            name: dto.name.trim(),
            phone,
            created_by: operatorId,
            // ★ 归属＝建档人自己（→ 需求 §6.1 ⑦）：未挂公司期间，这条线索出现在**他**的「我的待关联」里
            owner_id: operatorId,
            ...(dto.extra_phones === undefined ? {} : { extra_phones: dto.extra_phones }),
            ...(dto.wechat === undefined ? {} : { wechat: dto.wechat }),
            ...(dto.email === undefined ? {} : { email: dto.email }),
            ...(dto.gender === undefined ? {} : { gender: dto.gender }),
            ...(dto.birthday === undefined ? {} : { birthday: new Date(dto.birthday) }),
            ...(dto.decision_role === undefined ? {} : { decision_role: dto.decision_role }),
            ...(dto.tags === undefined ? {} : { tags: dto.tags }),
          },
          client,
        );

        if (companyId !== undefined) {
          await this.repository.createCompanyContact(
            {
              company_id: companyId,
              contact_id: contact.id,
              ...(dto.position === undefined ? {} : { position: dto.position }),
            },
            client,
          );
        }

        return contact;
      })
      .catch((error: unknown) => {
        // 并发下预检漏过 → 靠 DB 的 `uk_phone_active` 兜底，映射成同一句人话
        throw mapPrismaError(error) ?? error;
      });

    const history = await this.repository.findHistoricalPhoneOwner(phone);
    const owner = history?.contact;

    return {
      id: created.id,
      name: created.name,
      phone: created.phone,
      ...(owner === undefined || owner === null
        ? {}
        : { phone_history_hint: `该号曾属于 ${owner.name}` }),
    };
  }

  /**
   * 联系人列表（→ §5.5 `ContactBrief`；列表一律 `phone_masked`）。
   *
   * ★ M5-04：`phone_locked` 从「恒 false 的占位」改为**真判定** —— 判据＝「锁开着 **且** 查看者不是落锁人」
   *   （唯一判定点＝`domain/contact-lock.ts`；**落锁人＝上锁时的归属 owner**，等价性论证见该文件头 ★ 段）。
   * ⚠ 本接口因此**必须先有身份**：拿不到上下文 → 401（`requireOperatorId`）——
   *   锁的可见性取决于「我是谁」，**没有身份就不能猜**（猜「没锁」会把「已上锁」这条提示吞掉）。
   * ★ 2026-09-16：入参加 `only_unlinked`（只看未关联公司的待跟进），可见范围见 `repository.listContacts` 注释（→ 需求 §6.1 ⑪）。
   * ★ 2026-09-21（D-28 桥③）：可见性**改成由调用方给定**（`visibleCompanyIds` 第二个必填参数）——
   *   「已挂公司」那半边要按「**自己关系下公司**」收敛（→ 需求 §6.1 ⑪），而那个集合只有 C 域算得出；
   *   B(L2) 不许依赖 C(L3)，故由**聚合层**（`GET /contacts` 的新落点）算好当**入参**喂进来。
   */
  async listContacts(
    query: ListContactsQuery,
    /**
     * 「已挂公司」那半边的可见公司集合（→ 需求 §6.1 ⑪ / D-28）。
     * ★ **必填、不给默认值**：这个参数决定"收起还是裸奔"，漏传一次就是全公司裸奔 ——
     *   宁可在编译期红，也不给"忘了传＝回到旧行为"的路。
     * `null` ＝ **不收敛**（`all` 档，总经理 / 管理员，→ 需求 §4.2）。
     */
    visibleCompanyIds: readonly bigint[] | null,
  ): Promise<PageResult<ContactBriefVo>> {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'company.no_context',
      });
    }
    const viewerId = context.employeeId;
    const pagination = resolvePagination({ page: query.page, pageSize: query.pageSize });
    const { rows, total } = await this.repository.listContacts(
      {
        viewerId,
        onlyUnlinked: query.onlyUnlinked === true,
        // ★ 可见性**由调用方（聚合层）按 C 域出口给定**：B 域不许反向 import C 域（架构 §3），
        //   故这里只透传 —— 「谁算 `all` 档」那一条判定仍只有一处（C 域 `resolveVisibleCompanyScope`）。
        visibleCompanyIds,
      },
      pagination,
    );
    return buildPageResult(
      rows.map((row) => toContactBrief(row, viewerId, { position: null, is_current: true })),
      total,
      pagination,
    );
  }

  // ===== 跨域只读出口（架构 §5.2 路之①）=====

  /**
   * 联系人**归属人**（供 D 域判「这条"待关联"线索能不能标我」；→ 需求 §6.1 ⑦ / ⑨）。
   * ★ 口径：**谁建的归谁**（归属可改，故以**当前** `owner_id` 为准，不是最初建档人）。
   */
  getContactOwners(ids: readonly bigint[]): Promise<{ id: bigint; owner_id: bigint | null }[]> {
    return this.repository.findContactOwnersByIds(ids);
  }

  // ===== 「关联公司并激活业务关系」的跨域出口（→ 接口 §5.6 `POST /contacts/:id/activate-relation` / D-29）=====

  /**
   * **「待关联」前置校验**：这条联系人现在能不能走「关联公司并激活业务关系」动线。
   *
   * ★ 语义是**校验**、不是「读一条记录」⇒ 不合格**当场抛**（把人话与判定都留在 B 域一处）：
   *   · 联系人不存在 / 已删除 / 已合并 → **400**；
   *   · 已有就职记录（＝不是「待关联」）→ **409**（→ 接口 §5.6「防重复触发」）。
   * ★ 调用方：D 域编排 `POST /contacts/:id/activate-relation` 时**先调本方法**（见该方法头
   *   「为什么先 C 后 B」）——D 域不查 `contact` / `company_contact` 两张表（架构 §5.2 路之①）。
   *
   * @returns 联系人 `{id,name}`（调用方回显 / 日志用；本方法**不**回 `has_company`，
   *          因为「不合格」已经用异常表达了，再给一个布尔字段就是两套判定）
   * @throws 400 联系人不存在 ｜ 409 该联系人已挂过公司
   */
  async requireContactUnlinked(contactId: bigint): Promise<{ id: bigint; name: string }> {
    const refs = await this.repository.findContactRefsByIds([contactId]);
    if (refs.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：联系人不存在（或已删除 / 已合并）', {
        constraint: 'company.contact_missing',
      });
    }
    const contact = refs[0];

    // 「待关联」＝**没有任何**就职记录（派生判定，→ 需求 §6.1 ③）
    const linked = await this.repository.countCompanyContacts(contactId);
    if (linked > 0) {
      throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, CONTACT_ALREADY_LINKED_MESSAGE, {
        constraint: 'company_contact.already_linked',
      });
    }
    return { id: contact.id, name: contact.name };
  }

  /**
   * 给「待关联」联系人补**就职关系**（→ 接口 §5.6 第 ① 件事：写 `company_contact`，
   * `is_current=true`），由 D 域编排调用（→ D-29）。
   *
   * ★ 为什么由 B 域写：`company_contact` 是 B 域的表，跨域**不许查表更不许写表**（架构 §5.2）——
   *   D 域只该说「把这个人挂到这家公司、职位是 X」。
   * ★ 校验**复核一遍**（不是重复劳动）：调用方的前置校验与真正的写之间有窗口（跨域禁大事务，
   *   → 架构 §5.2），故本方法自己再走一遍 `requireContactUnlinked` —— 同 B / C 域既有的
   *   「预检 ＋ 兜底」姿势（预检给人话，兜底挡并发）。
   * @throws 403 只读角色 ｜ 400 联系人 / 公司不存在 ｜ 409 该联系人已挂过公司
   */
  async linkContactEmployment(input: {
    contactId: bigint;
    companyId: bigint;
    position?: string;
  }): Promise<void> {
    this.requireWriter();
    await this.requireContactUnlinked(input.contactId);

    const company = await this.repository.findCompanyById(input.companyId);
    if (company === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：公司不存在', {
        constraint: 'company.not_found',
      });
    }

    const position = input.position?.trim();
    await this.repository.createCompanyContact({
      company_id: input.companyId,
      contact_id: input.contactId,
      // 空串＝没填职位（不写这一列，免得库里出现一个「职位＝空」的在职记录）
      ...(position === undefined || position === '' ? {} : { position }),
    });
  }

  // ===== M2-14 公司联系人 =====

  /** 该公司下的联系人（**含历史就职 / 已离职标记**，→ B5；`phone_locked` 同 `listContacts`） */
  async listCompanyContacts(
    companyId: string,
    query: PaginationQuery = {},
  ): Promise<PageResult<ContactBriefVo>> {
    const viewerId = this.requireOperatorId();
    const id = jsonToBigint(companyId, 'id');
    const company = await this.repository.findCompanyById(id);
    if (company === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：公司不存在', {
        constraint: 'company.not_found',
      });
    }

    const pagination = resolvePagination({ page: query.page, pageSize: query.pageSize });
    const { rows, total } = await this.repository.findCompanyContacts(id, pagination);
    return buildPageResult(
      rows.map((row) =>
        toContactBrief(row.contact, viewerId, { position: row.position, is_current: row.is_current }),
      ),
      total,
      pagination,
    );
  }

  // ===== M6-15 联系人详情（→ 接口 §5.5 `GET /contacts/:id`；欠账 D-03）=====

  /**
   * 联系人详情（→ §5.5「详情」形态：主号全号 ＋ 备用号 ＋ 就职历史 ＋ 谈判特质 ＋ 锁状态）。
   *
   * ★ **可见性**（与 `listContacts` **同一套判定**，两处不许各写一遍 —— 分叉就会
   *   「列表里看得到、点进去 403」或反过来）：
   *   ① `all` 档（总经理 / 管理员）→ 看全部（不套过滤）；
   *   ② 「待关联」（没挂公司）→ **只给归属人自己**（→ 需求 §6.1 ⑪）：线索属私人待跟进，
   *      别人拿到 id 也看不了 → **403**；
   *   ③ 已挂公司的人 → **必须有一条就职记录落在「我可见的公司」里**（→ 需求 §6.1 ⑪ / D-28；
   *      与 `listContacts` **同宽、同源**：集合都由聚合层按 C 域出口喂进来，本层不自己算）。
   *
   * ★ **脱敏**（→ §2.8：详情给全号，是**出参形态、不是权限**）：唯一例外＝该联系人**被上锁**
   *   且查看者**不是落锁人** ⇒ `phone` 与 `extra_phones` **两个键都不给**（锁跟人：主号与备用号
   *   一并隐藏），改给 `phone_locked` ＋ `phone_locked_by`。
   *   ⚠ 判定唯一落点仍是 `domain/contact-lock.ts`（本层只按结论决定给不给号）。
   *
   * ⚠ 规格详情里的 `unlocked_until`（申请解锁通过后 24h 内可见）依赖 G 域审批，**本批不返**
   *   （也不返 `null` 占位 —— 那会让人以为"字段在、只是没解锁"）→《欠账登记表》D-04。
   */
  async getContact(
    id: string,
    /** 同 `listContacts`：可见公司集合（`null` ＝ 不收敛）；**必填**，理由见该方法头 */
    visibleCompanyIds: readonly bigint[] | null,
  ): Promise<ContactDetailVo> {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'company.no_context',
      });
    }
    const viewerId = context.employeeId;
    const contactId = jsonToBigint(id, 'id');

    const row = await this.repository.findContactDetailById(contactId);
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：联系人不存在（或已删除 / 已合并）', {
        constraint: 'company.contact_missing',
      });
    }

    const [employments, traits] = await Promise.all([
      this.repository.findContactEmployments(contactId),
      this.repository.findContactTraits(contactId),
    ]);

    // 可见性（见方法头 ★②③）——**与列表同一套两半判定**，两处不许各写一遍：
    //   ① 「待关联」（**没有任何就职记录**）⇒ 只有归属人能看（归属人＝建档录入人）；
    //   ② 已挂公司 ⇒ 必须有一条就职记录落在「我可见的公司」里（`null` ＝ 不收敛 ⇒ 放行）。
    // ⚠ ② 里**不看 `owner_id`**（→ 需求 §6.1 ⑦「已挂公司的人走关系的 owner，不看这一列」），
    //   与仓储那条 `OR` 分支逐字同口径；判定用**公司 id** 比，不引第二个口径。
    const visible =
      visibleCompanyIds === null ||
      (employments.length === 0
        ? row.owner_id === viewerId
        : employments.some((item) => visibleCompanyIds.includes(item.company.id)));
    if (!visible) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '无权查看：该联系人不在你的可见范围内', {
        constraint: 'contact.out_of_scope',
      });
    }

    // 管理员读留痕（拍板 Q4：仅 `admin` 角色写 `operation_log`，best-effort 不冒泡）
    await this.recordAdminView(context, COMPANY_AUDIT_ACTIONS.view, 'contact', contactId);

    // 锁：唯一判定点在 `domain/contact-lock.ts`；未上锁时 `lockerId` 为 `null`（不必白问 A 域）
    const locked = isPhoneLockedForViewer(row, viewerId);
    const lockerId = locked ? row.phone_locked_by : null;

    // 跨域取名 / 取文案（A 域出口；两次都是**批量**形式，未上锁 / 无特质时传空数组不发查询）
    const [labels, lockers] = await Promise.all([
      this.dict.getDictItemLabels(traits.map((trait) => trait.trait_id)),
      this.org.getEmployeeRefs(lockerId === null ? [] : [lockerId]),
    ]);
    const labelById = new Map(labels.map((item) => [item.id.toString(), item.label]));
    const locker = lockers[0];

    return {
      id: row.id,
      name: row.name,
      // 上锁 ⇒ **整个键不出现**（→ §2.8「`phone` 与 `extra_phones` 只在一种情况下缺省」）
      ...(locked ? {} : { phone: row.phone }),
      phone_locked: locked,
      phone_locked_by: locker === undefined ? null : { id: locker.id, name: locker.name },
      ...(locked ? {} : { extra_phones: parseExtraPhones(row.extra_phones) }),
      wechat: row.wechat,
      email: row.email,
      gender: row.gender,
      // DATE 列（无时刻）：按 UTC 年-月-日 截断，避免时区把生日挪一天
      birthday: row.birthday === null ? null : row.birthday.toISOString().slice(0, 10),
      decision_role: row.decision_role,
      tags: parseStringList(row.tags),
      traits: traits.map((trait) => ({
        trait_id: trait.trait_id,
        trait_code: trait.trait_code,
        label: labelById.get(trait.trait_id.toString()) ?? null,
      })),
      status: row.status,
      employments: employments.map((item) => ({
        company_id: item.company.id,
        company_name: item.company.full_name,
        position: item.position,
        joined_at: item.joined_at === null ? null : item.joined_at.toISOString(),
        left_at: item.left_at === null ? null : item.left_at.toISOString(),
        is_current: item.is_current,
      })),
    };
  }

  // ===== D-05 公司详情（→ §5.4 详情；跨域字段待落点）=====

  /**
   * 公司详情（→ §5.4 详情出参；D-05）。
   *
   * ★ **不做数据范围过滤**：公司档案是**全公司共享的资料层**（→ §5.4 / 数据架构 B1），
   *   与 `listCompanies` 同口径（注释已明写「刻意不做范围过滤」）。
   *
   * ★ 口径（拍板 Q1 / Q2）：
   *   · 基本档案 / `completeness`(c1/c2/c3) / `profile_tags`(B2 本域表) / `contacts[]`(B5 本域表)
   *     ＝ **本域内部**，不跨域；
   *   · `contacts[]` 按**卡片**处理（拍板 Q2）→ `phone_masked`（详情给全号只在联系人详情，不在公司卡片）；
   *   · `relations_summary` / `event_count_30d` 依赖 C 域 `business_relation` —— **B(L2) 禁止依赖 C(L3)**，
   *     本轮暂不出（登记缺口 → 跨域落点待拍板），**不编假值**（同现有 `relation_count`「待 M3/M4」模式）。
   *
   * ★ 管理员读留痕（拍板 Q4）：仅 `admin` 角色写 `operation_log`，best-effort。
   */
  async getCompany(id: string): Promise<CompanyDetailVo> {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'company.no_context',
      });
    }
    const companyId = jsonToBigint(id, 'id');
    const row = await this.repository.findCompanyById(companyId);
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：公司不存在（或已删除 / 已合并）', {
        constraint: 'company.not_found',
      });
    }

    const [tags, contacts] = await Promise.all([
      this.repository.findCompanyProfileTags(companyId),
      this.repository.findCompanyContacts(companyId, { skip: 0, take: 1000 }),
    ]);

    // 字典文案（A 域出口；未打标的 tag_id 给 `null` 不编文案）
    const labels = await this.dict.getDictItemLabels(tags.map((tag) => tag.tag_id));
    const labelById = new Map(labels.map((item) => [item.id.toString(), item.label]));
    const profileTags = buildProfileTags(tags, labelById);

    const viewerId = context.employeeId;
    // 管理员读留痕（拍板 Q4）
    await this.recordAdminView(context, COMPANY_AUDIT_ACTIONS.view, 'company', companyId);

    return {
      ...toCompanyVo(row),
      completeness: { c1: row.completeness_1, c2: row.completeness_2, c3: row.completeness_3 },
      profile_tags: profileTags,
      contacts: contacts.rows.map((cc) =>
        toContactBrief(cc.contact, viewerId, { position: cc.position, is_current: cc.is_current }),
      ),
    };
  }

  /**
   * 管理员读留痕（拍板 Q4：仅 `admin` 角色写 `operation_log`；→ 需求 §4.2 ★）。
   * 走 `recordStandalone`（best-effort，失败只记日志、绝不冒泡，→ `audit.service.ts`）。
   */
  private async recordAdminView(
    context: RequestContext,
    action: `${string}.${string}`,
    targetType: string,
    targetId: bigint,
  ): Promise<void> {
    if (!context.roleCodes.includes('admin')) return;
    await this.audit.recordStandalone({ action, target_type: targetType, target_id: targetId });
  }

  /** 当前登录人 id；拿不到 → 401（正常链路上守卫已在前，走到这里还没有上下文＝装配问题） */
  private requireOperatorId(): bigint {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'company.no_context',
      });
    }
    return context.employeeId;
  }

  /**
   * 当前登录人能**写**客户档案吗（2026-09-15 定）？不能 → **403 / 20003**。
   *
   * ★ 依据＝需求 §4.2 ★「**管理员**可查看业务数据，但**一律只读**、不参与客户经营」
   *   ＋ 同节 ★ **交付 / 客服**「只读；不进公海、**不做客户经营动作**」——
   *   **建档属客户经营动作**，故这两类角色一律拒。⚠ 规格原文的「只读（不能写跟单 / 改关系 / 建合同）」
   *   是**举例**，不是「除这三样外都能做」（→ 2026-09-15 审计：把举例当穷尽会反过来**放行**建档）。
   * ★ 判定收口在 `kernel/data-scope/write-role.ts`（**多角色取"能写"**：`admin` ＋ `sale` 的人仍可写）。
   * ★ 与 `requireOperatorId()` 的分工：那个只答"**有没有身份**"（401），本函数答"**有没有写权**"（403）。
   */
  private requireWriter(): bigint {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'company.no_context',
      });
    }
    if (!isBusinessWriteRole(context.roleCodes)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '当前角色对客户档案只读（管理员 / 交付 · 客服）', {
        constraint: 'company.read_only',
      });
    }
    return context.employeeId;
  }
}

/** 仓储读出的公司行（结构取自 `COMPANY_SELECT`，不手抄字段） */
type CompanyRow = Awaited<ReturnType<CompanyRepository['createCompany']>>;

/** 仓储读出的联系人行（结构取自 `CONTACT_SELECT`，不手抄字段）—— D-08 起仓储返回 `{rows,total}`，故取 `rows` */
type ContactRow = Awaited<ReturnType<CompanyRepository['listContacts']>>['rows'][number];

/**
 * 联系人行 → 简卡（两个列表共用一段装配，**别写两遍**：脱敏口径一散开就会「改一处漏两处」）。
 *
 * ★ 出参形态（→ 数据架构 §十一 ①）：
 *   · `phone_masked` —— **列表 / 卡片一律打码**，是**出参形态、不是权限**（防「一眼扫走一列号」）；
 *   · `phone_locked` —— 锁开着、且查看者**不是落锁人**时为 `true`（→ `domain/contact-lock.ts`）。
 * ⚠ `extra_phones`（备用号）**不进简卡**：它只出现在**联系人详情**，而详情接口本批未建；
 *   「锁跟人：主号与备用号一并隐藏」随详情接口一起落地（已登记 → 交接说明「欠账」）。
 */
function toContactBrief(
  row: ContactRow,
  viewerId: bigint,
  extras: { position: string | null; is_current: boolean },
): ContactBriefVo {
  return {
    id: row.id,
    name: row.name,
    position: extras.position,
    phone_masked: maskPhone(row.phone),
    phone_locked: isPhoneLockedForViewer(row, viewerId),
    decision_role: row.decision_role,
    is_current: extras.is_current,
  };
}

/**
 * JSON 列 → 备用号数组：**逐项校验形状**，坏项丢弃（宁可少显一条，也不把脏数据抛给页面）。
 *
 * ⚠ 这个解析器**留在 B 域**、没有上收 kernel：它认的是 `extra_phones` 的**业务形状**
 *   （`{type,number,note?}`），上收会让 kernel 认识业务字段。
 *   「JSON 列 → `string[]`」那种**纯形状**的（`contact.tags` / `nav_open`）才归
 *   `kernel/common/json.ts`（→ `parseStringList`）。
 */
function parseExtraPhones(value: unknown): { type: string; number: string; note?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const { type, number, note } = item as Record<string, unknown>;
    if (typeof type !== 'string' || typeof number !== 'string') return [];
    return [{ type, number, ...(typeof note === 'string' ? { note } : {}) }];
  });
}

/** 公司行 → 出参（`Decimal` 显式转字符串：别指望 JSON 序列化替我们做） */
function toCompanyVo(row: CompanyRow): CompanyVo {
  return {
    id: row.id,
    full_name: row.full_name,
    name_core: row.name_core,
    city: row.city,
    industry_l1: row.industry_l1,
    scale: row.scale,
    credit_code: row.credit_code,
    registered_capital: row.registered_capital === null ? null : row.registered_capital.toString(),
    legal_person: row.legal_person,
    // 「地址是否维护」是**派生展示**（→ 数据架构 B7）：address 或坐标为空 → false，不落字段
    address_maintained: row.address !== null || row.longitude !== null,
    updated_at: row.updated_at.toISOString(),
  };
}

/** 档案标签按 `group_code` 分三组（→ §5.4 `profile_tags`；B2 三类口径） */
function buildProfileTags(
  tags: Awaited<ReturnType<CompanyRepository['findCompanyProfileTags']>>,
  labelById: Map<string, string | null>,
): CompanyProfileTagGroupVo {
  const identity: CompanyProfileTagGroupVo['identity'] = [];
  const policy: CompanyProfileTagGroupVo['policy'] = [];
  let decisionChain: CompanyProfileTagGroupVo['decision_chain'] = null;
  for (const tag of tags) {
    const label = labelById.get(tag.tag_id.toString()) ?? null;
    if (tag.group_code === 'company_identity_tag') {
      identity.push({ tag_id: tag.tag_id, tag_code: tag.tag_code, label });
    } else if (tag.group_code === 'company_policy_tag') {
      policy.push({ tag_id: tag.tag_id, tag_code: tag.tag_code, label });
    } else if (tag.group_code === 'decision_chain') {
      decisionChain = { tag_id: tag.tag_id, label };
    }
  }
  return { identity, policy, decision_chain: decisionChain };
}

/**
 * 组装落库数据：**只把「给了值」的可选字段带进去**（`undefined` 不写列，保持 DB 默认）。
 * ★ 为什么不写成「循环挑 key」：那会让类型退化成 `Record<string, unknown>`，
 *   正好丢掉「字段名写错要编译报错」这层保护（B 域字段多，拼错一个很难在联调前发现）。
 */
function buildCompanyData(
  dto: CreateCompanyDto,
  operatorId: bigint,
  nameCore: string,
  creditCode: string | undefined,
): CreateCompanyData {
  return {
    full_name: dto.full_name.trim(),
    name_core: nameCore,
    created_by: operatorId,
    ...(creditCode === undefined || creditCode === '' ? {} : { credit_code: creditCode }),
    ...(dto.industry_l1 === undefined ? {} : { industry_l1: dto.industry_l1 }),
    ...(dto.industry_l2 === undefined ? {} : { industry_l2: dto.industry_l2 }),
    ...(dto.province === undefined ? {} : { province: dto.province }),
    ...(dto.city === undefined ? {} : { city: dto.city }),
    ...(dto.district === undefined ? {} : { district: dto.district }),
    ...(dto.scale === undefined ? {} : { scale: dto.scale }),
    ...(dto.website === undefined ? {} : { website: dto.website }),
    ...(dto.address === undefined ? {} : { address: dto.address }),
    ...(dto.bank_name === undefined ? {} : { bank_name: dto.bank_name }),
    ...(dto.invoice_title === undefined ? {} : { invoice_title: dto.invoice_title }),
    ...(dto.tax_no === undefined ? {} : { tax_no: dto.tax_no }),
    ...(dto.registered_capital === undefined ? {} : { registered_capital: dto.registered_capital }),
    ...(dto.legal_person === undefined ? {} : { legal_person: dto.legal_person }),
    ...(dto.longitude === undefined ? {} : { longitude: dto.longitude }),
    ...(dto.latitude === undefined ? {} : { latitude: dto.latitude }),
    ...(dto.aliases === undefined ? {} : { aliases: dto.aliases }),
  };
}

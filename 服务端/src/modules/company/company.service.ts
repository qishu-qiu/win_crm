// =============================================================================
// B 域服务（M2-08 / M2-09 / M2-10 / M2-11 ~ M2-14）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、发事件），
//   **不写业务规则**（判级 / 归一在 `domain/`）、**不写 SQL**（在 `company.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.15 §5.4 / §5.5：建档入参、查重出参（`candidates` ＋ `suggest`）。
//   · 《销售CRM业务需求文档》§12.1 分支 4：命中后**由人点选**（「挂现有公司」/「确认新建」），
//     系统**不自动合并、不自动拦截** ⇒ 本服务只**给候选 + 给建议**，绝不阻断建档。
//   · 《销售CRM数据架构文档》V1.30 B1：`credit_code` 「**撞码强制使用已有档案**」；
//     B3：`phone_active` 生成列让「软删 / 换号自动释放」；B5：`company_contact` 含历史。
//   · 架构 §5.2 跨域三条路之③：改多表必须一起成功 → **本域 `$transaction`**（禁止跨域大事务）。
//   · 架构 §7.4 敏感动作清单（登录 / 改手机号 / 审批 / 公海 / 金额）：**建档不在其中**
//     ⇒ 本服务**不写审计**（别顺手加，加了就是自造口径）。
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
  getRequestContext,
  jsonToBigint,
  mapPrismaError,
  maskCreditCode,
  maskPhone,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { compareCompanyNameCore, type CompanyMatchType } from './domain/company-name-similarity';
import { toNameCore } from './domain/company-name';
import { isEmptyPhone, normalizeContactPhone } from './domain/contact-phone';
import { CompanyRepository, type CompanyTxClient, type CreateCompanyData } from './company.repository';
import type { CreateCompanyDto, CreateContactDto, SearchDupDto } from './dto/company-request.dto';

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

/** 「同部门 / 别的部门」等提示不进本批；`take` 上限集中在仓储，这里只做去重与排序 */
const MAX_CANDIDATES = 20;

@Injectable()
export class CompanyService {
  constructor(
    private readonly repository: CompanyRepository,
    private readonly prisma: PrismaService,
  ) {}

  // ===== M2-08 建档（公司）=====

  /**
   * 建档公司：**服务端生成 `name_core`**（→ B1：建档 / 改名 / 合并时生成并落库），
   * 撞重**预检 ＋ 兜底**（信用代码撞码 → 409「请使用已有档案」）。
   * ★ 注意：**不做「疑似重复就拦住」** —— 需求 §12.1 分支 4 明确「强行新建」是合法出口。
   */
  async createCompany(dto: CreateCompanyDto): Promise<CompanyVo> {
    const operatorId = this.requireOperatorId();
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

  /** 公司列表（→ §5.4；分页 / 筛选属 M6，本批给最近 100 条） */
  async listCompanies(): Promise<CompanyVo[]> {
    const rows = await this.repository.listCompanies();
    return rows.map(toCompanyVo);
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
    const operatorId = this.requireOperatorId();
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

  /** 联系人列表（→ §5.5 `ContactBrief`；列表一律 `phone_masked`） */
  async listContacts(): Promise<ContactBriefVo[]> {
    const rows = await this.repository.listContacts();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      position: null,
      phone_masked: maskPhone(row.phone),
      // ⚠ M5 前恒为 false：锁的判定要读「查看者是不是 owner」，属 M5 的脱敏出口
      phone_locked: false,
      decision_role: row.decision_role,
      is_current: true,
    }));
  }

  // ===== M2-14 公司联系人 =====

  /** 该公司下的联系人（**含历史就职 / 已离职标记**，→ B5） */
  async listCompanyContacts(companyId: string): Promise<ContactBriefVo[]> {
    const id = jsonToBigint(companyId, 'id');
    const company = await this.repository.findCompanyById(id);
    if (company === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：公司不存在', {
        constraint: 'company.not_found',
      });
    }

    const rows = await this.repository.findCompanyContacts(id);
    return rows.map((row) => ({
      id: row.contact.id,
      name: row.contact.name,
      position: row.position,
      phone_masked: maskPhone(row.contact.phone),
      phone_locked: false,
      decision_role: row.contact.decision_role,
      is_current: row.is_current,
    }));
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
}

/** 仓储读出的公司行（结构取自 `COMPANY_SELECT`，不手抄字段） */
type CompanyRow = Awaited<ReturnType<CompanyRepository['createCompany']>>;

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

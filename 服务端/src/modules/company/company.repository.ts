// =============================================================================
// B 域仓储（M2-02 / M2-03 / M2-04 / M2-14）
//
// 分层约束（架构 §5.4）：**本文件是全项目「唯一允许 import Prisma 干活的层」**
//   —— 只查 / 写库，**不写业务判断**（判级在 `domain/`、编排在 `*.service.ts`）。
//   故此处不做「算不算重复」「要不要提示」这类判断，只把行取回来。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》§四 B1（`company`）/ B3（`contact`）/ B5（`company_contact`）。
//   · 逻辑删除一律 `deleted_at IS NULL`（数据架构 §二 总则）；`merged_into IS NOT NULL`
//     是**合并墓碑**（`→ B1`「物理不删、永远可审计」）⇒ **查重与列表都要跳过墓碑**，
//     否则「已并入别家的档案」会一次次冒出来当候选（→ 需求 §7.3 撞码合并）。
//   · **第一段查重走 `name_core`**（`startsWith` 覆盖「精确 ＋ 前缀」，→ B1 的既有索引 `idx_name_core`）；
//     第二段（编辑距离判级）在 service 层用 `domain/company-name-similarity.ts` 做 —— 仓储不掺和判级。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 交互式事务客户端（`prisma.$transaction(async (tx) => …)` 里的 `tx`）。
 * ★ 直接用 Prisma 自己的 `TransactionClient`（＝ `Omit<PrismaClient, ITXClientDenyList>`）：
 *   ① 与 `$transaction` 回调收到的 `tx` **同型**，传参不需要 cast；
 *   ② 类型上就**没有** `$transaction` —— 想「在事务里再开一个事务」编译期就过不去；
 *   ③ 仅作**类型**引用（编译期擦除），不引入运行时依赖。
 */
export type CompanyTxClient = Prisma.TransactionClient;

/** 公司读出的列（**只取本域字段**；跨域的 `relation_count` / `old_customer` 由 M3/M4 提供） */
const COMPANY_SELECT = {
  id: true,
  full_name: true,
  name_core: true,
  credit_code: true,
  industry_l1: true,
  industry_l2: true,
  province: true,
  city: true,
  district: true,
  scale: true,
  website: true,
  address: true,
  bank_name: true,
  invoice_title: true,
  tax_no: true,
  registered_capital: true,
  legal_person: true,
  longitude: true,
  latitude: true,
  aliases: true,
  merged_into: true,
  updated_at: true,
} as const;

/**
 * 联系人读出的列（**不含 `phone_active`** —— 它是生成列，Prisma 侧为 `@ignore`，读不出来也不该读）。
 *
 * ★ M5-04 起带上 `phone_locked_at / phone_locked_by`：联系人出口要在**查询阶段**就把
 *   「这条记录有没有被上锁、落锁人是谁」**一并带出** —— 脱敏判定**不许回头再查库**
 *   （→ 架构 §7.1 / `desensitize.interceptor.ts` 文件头 ★ 段）。
 */
const CONTACT_SELECT = {
  id: true,
  name: true,
  phone: true,
  extra_phones: true,
  wechat: true,
  email: true,
  gender: true,
  birthday: true,
  decision_role: true,
  tags: true,
  status: true,
  phone_locked_at: true,
  phone_locked_by: true,
  merged_into: true,
} as const;

/** 建档公司时写入的列（由 service 组装好，仓储只管落库） */
export interface CreateCompanyData {
  full_name: string;
  name_core: string;
  created_by: bigint;
  credit_code?: string;
  industry_l1?: string;
  industry_l2?: string;
  province?: string;
  city?: string;
  district?: string;
  scale?: string;
  website?: string;
  address?: string;
  bank_name?: string;
  invoice_title?: string;
  tax_no?: string;
  registered_capital?: string;
  legal_person?: string;
  longitude?: string;
  latitude?: string;
  aliases?: string[];
}

/** 建档联系人时写入的列 */
export interface CreateContactData {
  name: string;
  phone: string;
  created_by: bigint;
  /**
   * ★ 待关联（未挂公司）联系人的**归属人** ＝ 建档录入人（→ 需求 §6.1 ⑦，migration `0007`）。
   * ⚠ 建档时**总是**写（哪怕当场就挂了公司）：挂公司后归属改走 `business_relation` 的 owner 成员、
   *   本列不再参与判定 —— 保留值无害，且「先建档、后补公司」的路径不必再回填一次。
   */
  owner_id: bigint;
  extra_phones?: { type: string; number: string; note?: string }[];
  wechat?: string;
  email?: string;
  gender?: string;
  birthday?: Date;
  decision_role?: string;
  tags?: string[];
}

@Injectable()
export class CompanyRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===== M2-02 建档（公司）=====

  /** 插入公司档案；`credit_code` 撞 `uk_credit_code` → Prisma 抛 **P2002**（service 映射 409 人话） */
  createCompany(data: CreateCompanyData) {
    return this.prisma.company.create({ data, select: COMPANY_SELECT });
  }

  /** 按主键取**未删除、未合并**的公司（合并墓碑不给详情） */
  findCompanyById(id: bigint) {
    return this.prisma.company.findFirst({
      where: { id, deleted_at: null, merged_into: null },
      select: COMPANY_SELECT,
    });
  }

  /** 按信用代码取**未删除、未合并**的公司（撞码 → 强制使用已有档案，→ B1） */
  findCompanyByCreditCode(creditCode: string) {
    return this.prisma.company.findFirst({
      where: { credit_code: creditCode, deleted_at: null, merged_into: null },
      select: COMPANY_SELECT,
    });
  }

  /**
   * 按 id 批量取公司引用（**只取 id / 全称**）—— 供 C 域 `company:{id,name}` 装配。
   *
   * ★ 跨域只走出口（§5.2）：关系列表要显示公司名，但 `company` 是 B 域的表，
   *   C 域**不许自己查**，所以由本域提供一个「只够装配引用」的窄查询（不暴露整行）。
   */
  async findCompanyRefsByIds(
    ids: readonly bigint[],
  ): Promise<{ id: bigint; full_name: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.company.findMany({
      where: { id: { in: [...new Set(ids)] }, deleted_at: null, merged_into: null },
      select: { id: true, full_name: true },
    });
  }

  /**
   * 联系人 `{id, name}` 引用（**M4-08 为 D 域时间线新增**：跟单事件上的 `contact_id` 属 B 域，
   * 跨域**不许查表**（§5.2）—— D 域只该问「这些 id 对应哪几个人、叫什么」）。
   *
   * ⚠ 与 `findCompanyRefsByIds` **同口径**：只回**未删除、未合并**的联系人 ——
   *   合并墓碑 / 已删联系人**不给引用**，免得时间线上冒出一个「已并入别人的那个联系人」。
   */
  async findContactRefsByIds(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.contact.findMany({
      where: { id: { in: [...new Set(ids)] }, deleted_at: null, merged_into: null },
      select: { id: true, name: true },
    });
  }

  /**
   * 联系人的**归属人**（→ 需求 §6.1 ⑦；列 `owner_id` 由 migration `0007` 加）。
   *
   * ★ 用途：**快速标记的联系人侧**要判「这条"待关联"线索归不归我标」——`contact` 是 B 域的表，
   *   D 域不许自己查（架构 §5.2 路之①），故由本域给一个只够判定的窄出口。
   * ⚠ 与 `findContactRefsByIds` 同口径：只回**未删除、未合并**的行；
   *   **查不到的 id 由调用方当「联系人不存在」处理**（400），别静默跳过——静默跳过＝"标了 9 条"却少一条。
   */
  async findContactOwnersByIds(
    ids: readonly bigint[],
  ): Promise<{ id: bigint; owner_id: bigint | null }[]> {
    if (ids.length === 0) return [];
    return this.prisma.contact.findMany({
      where: { id: { in: [...new Set(ids)] }, deleted_at: null, merged_into: null },
      select: { id: true, owner_id: true },
    });
  }

  // ===== M2-03 查重（公司）=====

  /**
   * **第一段**：按 `name_core` 收缩候选集（精确 / 前缀）。
   * ★ 为什么必须有第一段：不然每录一个客户都要**全表**算编辑距离（→ B1 原文）。
   * `limit` 是保护：`name_core` 前缀命中过多时，只取最近的若干条给第二段判级。
   */
  findCompanyCandidatesByCore(nameCore: string, limit = 50) {
    return this.prisma.company.findMany({
      where: { deleted_at: null, merged_into: null, name_core: { startsWith: nameCore } },
      select: COMPANY_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  /** 按**联系人手机号**查公司（查重第 ① 个触发点：录入联系人时按手机号撞库，→ 需求 §12.1） */
  async findCompaniesByContactPhone(phone: string, limit = 20) {
    const rows = await this.prisma.companyContact.findMany({
      where: {
        is_current: true,
        contact: { phone, deleted_at: null },
        company: { deleted_at: null, merged_into: null },
      },
      select: { company: { select: COMPANY_SELECT } },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.map((row) => row.company);
  }

  /** 公司列表（M2 最小列表：按 id 倒序取前 N；**分页 / 筛选属 M6 列表页**，→ 接口 §2.7） */
  listCompanies(limit = 100) {
    return this.prisma.company.findMany({
      where: { deleted_at: null, merged_into: null },
      select: COMPANY_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  // ===== M2-04 / M2-13 建档（联系人）=====

  /** 插入联系人；主号撞 `uk_phone_active` → **P2002**（软删后同号可再建，靠生成列释放，→ B3） */
  createContact(data: CreateContactData, tx?: CompanyTxClient) {
    const client = tx ?? this.prisma;
    return client.contact.create({
      data: {
        name: data.name,
        phone: data.phone,
        created_by: data.created_by,
        updated_by: data.created_by,
        owner_id: data.owner_id,
        ...(data.extra_phones === undefined ? {} : { extra_phones: data.extra_phones }),
        ...(data.wechat === undefined ? {} : { wechat: data.wechat }),
        ...(data.email === undefined ? {} : { email: data.email }),
        ...(data.gender === undefined ? {} : { gender: data.gender }),
        ...(data.birthday === undefined ? {} : { birthday: data.birthday }),
        ...(data.decision_role === undefined ? {} : { decision_role: data.decision_role }),
        ...(data.tags === undefined ? {} : { tags: data.tags }),
      },
      select: CONTACT_SELECT,
    });
  }

  /** 写就职关系（B5 `company_contact`：N:M 含历史；`is_current=true` 为当前在职） */
  createCompanyContact(
    input: { company_id: bigint; contact_id: bigint; position?: string },
    tx?: CompanyTxClient,
  ) {
    const client = tx ?? this.prisma;
    return client.companyContact.create({
      data: {
        company_id: input.company_id,
        contact_id: input.contact_id,
        is_current: true,
        ...(input.position === undefined ? {} : { position: input.position }),
      },
    });
  }

  /**
   * 该联系人**已有几条就职记录**（→ 需求 §6.1 ③「待关联」＝一条都没有，派生判定，不加字段）。
   *
   * ★ 用途：`POST /contacts/:id/activate-relation` 的**前置判定**（能不能走激活动线）——
   *   判定条件是「就职关系」这件事，唯一落点在本域（B 的表 / B 的规则），
   *   D 域编排时只调本域的出口，**不自己查这张表**（架构 §5.2 路之①）。
   */
  countCompanyContacts(contactId: bigint) {
    return this.prisma.companyContact.count({ where: { contact_id: contactId } });
  }

  /** 按手机号取**未删除**联系人（撞号时给 409 人话；也在建号前查历史号，→ B6「提示不拦截」） */
  findContactByPhone(phone: string) {
    return this.prisma.contact.findFirst({
      where: { phone, deleted_at: null },
      select: CONTACT_SELECT,
    });
  }

  /** 该手机号是否出现在**历史号**里（`contact_change_log`，→ B6：命中则提示「该号曾属于 XX」，不拦截） */
  findHistoricalPhoneOwner(phone: string) {
    return this.prisma.contactChangeLog.findFirst({
      where: { field: 'phone', old_value: phone },
      select: { contact: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 联系人列表（M2 最小列表；分页待补，→《欠账登记表》D-08）。
   *
   * ★ 可见范围（2026-09-16 起，→ 需求 §6.1 ⑪）**分三档**：
   *   ① **`all` 档**（总经理 / 管理员，→ 需求 §4.2 数据范围）→ **看全部**（不套过滤）；
   *   ② **待关联**（没挂公司的人）→ 只给**归属人自己**（`owner_id = 我`）：
   *      线索属私人待跟进，此前"任何登录人都能看最近 100 条"＝全公司裸奔（含号码）；
   *   ③ **已挂公司的人** → **暂维持原样**（只要有就职记录就可见）。
   *      ⚠ ③ 的严格口径是"我关系下公司的联系人"，但**判定要复用 C 域的数据范围** ——
   *      而 `company`(L2) → `relation`(L3) 是**反向依赖**（架构 §3 层级禁止），故落地方式待定
   *      （→《欠账登记表》**D-28**）。**过渡期刻意"放松"**：若现在就按关系收紧，
   *      销售会连**自己客户**的联系人都看不到 —— 那比现状更差。
   */
  listContacts(
    input: { viewerId: bigint; onlyUnlinked: boolean; allScope: boolean },
    limit = 100,
  ) {
    return this.prisma.contact.findMany({
      where: {
        deleted_at: null,
        merged_into: null,
        AND: [
          // 「未关联公司」＝无任何 `company_contact` 记录（派生判定，→ 需求 §6.1 ③）
          ...(input.onlyUnlinked ? [{ company_contacts: { none: {} } }] : []),
          ...(input.allScope
            ? []
            : [{ OR: [{ owner_id: input.viewerId }, { company_contacts: { some: {} } }] }]),
        ],
      },
      select: CONTACT_SELECT,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  // ===== M2-14 公司联系人（含历史就职与已离职标记）=====

  /** 该公司下的联系人 ＋ 就职关系（`is_current` 区分在职 / 历史，→ B5） */
  async findCompanyContacts(companyId: bigint) {
    const rows = await this.prisma.companyContact.findMany({
      where: {
        company_id: companyId,
        contact: { deleted_at: null, merged_into: null },
      },
      select: {
        is_current: true,
        position: true,
        contact: { select: CONTACT_SELECT },
      },
      orderBy: [{ is_current: 'desc' }, { id: 'desc' }],
    });
    return rows;
  }
}

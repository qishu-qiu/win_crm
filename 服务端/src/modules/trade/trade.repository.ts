// =============================================================================
// E 域仓储（M9-E / B2）
//
// 分层约束（架构 §5.4）：**本文件是全项目「唯一允许 import Prisma 干活的层」**——只查 / 写库，
//   **不写业务判断**（规则在 `domain/contract.ts`）、**不写 SQL 之外的逻辑**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》E1（`contract`）。
//   · 逻辑删除一律 `deleted_at IS NULL`（数据架构 §二 总则）。
//   · 列表范围：合同归属由底层业务关系的 `dept_id` 决定（合同本身无 `dept_id` 列），
//     故「部门 / 全部」筛选经 `relation.dept_id` 收敛；「本人」= 签单人 ∪ 关系 owner。
//
// ★ 范围与方法一一对应（文件头 ★ 的取法）：service 不拼 `where`，仓储按范围具名取数。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { type Pagination } from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import type { ContractFilter } from './domain/contract-filter';

/** 合同读出的列（本域字段；公司 / 产品线 / 签单人名字由 service 走跨域出口装配） */
const CONTRACT_SELECT = {
  id: true,
  contract_no: true,
  relation_id: true,
  company_id: true,
  product_line_id: true,
  contact_id: true,
  signer_id: true,
  amount: true,
  paid_amount: true,
  pay_type: true,
  sign_date: true,
  service_start: true,
  service_end: true,
  auto_renew: true,
  remind_days: true,
  attachments: true,
  status: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
} as const;

/** 建档合同时写入的列（由 service 组装好，仓储只管落库） */
export interface CreateContractData {
  contract_no: string;
  relation_id: bigint;
  company_id: bigint;
  product_line_id: bigint;
  contact_id?: bigint | null;
  signer_id: bigint;
  amount: string;
  paid_amount: string;
  pay_type?: string | null;
  sign_date?: Date | null;
  service_start?: Date | null;
  service_end?: Date | null;
  auto_renew: boolean;
  remind_days?: unknown;
  attachments?: unknown;
  status: string;
  created_by: bigint;
}

/** 改合同时写入的列（只带给了值的字段，由 service 决定） */
export interface UpdateContractData {
  pay_type?: string;
  status?: string;
  auto_renew?: boolean;
  remind_days?: unknown;
  service_start?: Date | null;
  service_end?: Date | null;
  attachments?: unknown;
  updated_by: bigint;
}

/** 列表通用选项（排序 ＋ 筛选，service 已校验过白名单） */
export interface ContractListOptions {
  orderField?: string;
  desc?: boolean;
}

/** 成员类型常量（仅本仓储用于 `self` 范围判定；与 C 域 `owner` 同义） */
const OWNER_MEMBER_TYPE = 'owner';

@Injectable()
export class TradeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===== 写（创建）=====

  /**
   * 插入合同。`contract_no` 由 service 预检过唯一性后传入；撞 `uk_contract_no`
   * → Prisma 抛 **P2002**，由 `mapPrismaError` 映射成 409（→ 架构 §7.5 / 内核映射器）。
   */
  createContract(data: CreateContractData, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.contract.create({
      data: {
        contract_no: data.contract_no,
        relation_id: data.relation_id,
        company_id: data.company_id,
        product_line_id: data.product_line_id,
        ...(data.contact_id === undefined ? {} : { contact_id: data.contact_id }),
        signer_id: data.signer_id,
        amount: data.amount,
        paid_amount: data.paid_amount,
        ...(data.pay_type === undefined ? {} : { pay_type: data.pay_type }),
        ...(data.sign_date === undefined ? {} : { sign_date: data.sign_date }),
        ...(data.service_start === undefined ? {} : { service_start: data.service_start }),
        ...(data.service_end === undefined ? {} : { service_end: data.service_end }),
        auto_renew: data.auto_renew,
        ...(data.remind_days === undefined ? {} : { remind_days: data.remind_days as Prisma.InputJsonValue }),
        ...(data.attachments === undefined ? {} : { attachments: data.attachments as Prisma.InputJsonValue }),
        status: data.status,
        created_by: data.created_by,
        updated_by: data.created_by,
      },
      select: CONTRACT_SELECT,
    });
  }

  // ===== 读（详情 / 唯一键预检）=====

  /** 按主键取**未删除**的合同 */
  findById(id: bigint) {
    return this.prisma.contract.findFirst({
      where: { id, deleted_at: null },
      select: CONTRACT_SELECT,
    });
  }

  /** 按合同号取（创建前唯一性预检；只需 id 一列） */
  findByContractNo(contractNo: string) {
    return this.prisma.contract.findFirst({
      where: { contract_no: contractNo, deleted_at: null },
      select: { id: true },
    });
  }

  // ===== 改 =====

  /** 改合同属性（只改给的列；`updated_by` 由 service 带） */
  updateContract(id: bigint, data: UpdateContractData) {
    return this.prisma.contract.update({
      where: { id },
      data: {
        updated_by: data.updated_by,
        ...(data.pay_type === undefined ? {} : { pay_type: data.pay_type }),
        ...(data.status === undefined ? {} : { status: data.status }),
        ...(data.auto_renew === undefined ? {} : { auto_renew: data.auto_renew }),
        ...(data.remind_days === undefined ? {} : { remind_days: data.remind_days as Prisma.InputJsonValue }),
        ...(data.service_start === undefined ? {} : { service_start: data.service_start }),
        ...(data.service_end === undefined ? {} : { service_end: data.service_end }),
        ...(data.attachments === undefined ? {} : { attachments: data.attachments as Prisma.InputJsonValue }),
      },
      select: CONTRACT_SELECT,
    });
  }

  // ===== 列表（四种数据范围，方法名即范围）=====
  //
  // ★ 与 relation 同款：五个列表方法都收 `Pagination`、都返回 `{ rows, total }`；
  //   `total` ＝ 同一个 `where` 的全量条数（前端「共 N 条」，→ 设计规范 §4.3）；
  //   取页与计数包在本域只读事务里（§5.2 ③ 只禁跨域大事务）。

  /** 筛选 ＋ 关键字 → Prisma `where` 片段（翻译只在本层，domain 不碰 Prisma） */
  private filterWhere(filter: ContractFilter): Prisma.ContractWhereInput {
    const where: Prisma.ContractWhereInput = {};
    if (filter.status !== undefined) where.status = filter.status;
    if (filter.keyword !== undefined && filter.keyword.trim() !== '') {
      const kw = filter.keyword.trim();
      // 合同无 `company` 关系（只有 `company_id` 列）；按公司名搜需穿过 `relation.company`
      where.OR = [
        { contract_no: { contains: kw } },
        { relation: { company: { full_name: { contains: kw } } } },
      ];
    }
    return where;
  }

  /** 排序字段 → Prisma 排序（白名单之外回落 `id desc`） */
  private orderByOf(options: ContractListOptions): Prisma.ContractOrderByWithRelationInput[] {
    const dir: Prisma.SortOrder = options.desc === false ? 'asc' : 'desc';
    switch (options.orderField) {
      case 'sign_date':
        return [{ sign_date: dir }, { id: 'desc' }];
      case 'service_end':
        return [{ service_end: dir }, { id: 'desc' }];
      case 'amount':
        return [{ amount: dir }, { id: 'desc' }];
      case 'created_at':
        return [{ created_at: dir }, { id: 'desc' }];
      default:
        return [{ id: dir }];
    }
  }

  /** 一个范围条件 ＋ 筛选 ＋ 分页 → `{ rows, total}`（findMany 与 count 共用同一 `where`） */
  private async pageOf(
    scopeWhere: Prisma.ContractWhereInput,
    filter: ContractFilter,
    pagination: Pagination,
    options: ContractListOptions,
  ) {
    const where: Prisma.ContractWhereInput = {
      ...scopeWhere,
      ...this.filterWhere(filter),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        select: CONTRACT_SELECT,
        orderBy: this.orderByOf(options),
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * 某公司**已签约**合同（sign_date 非空）的「关系 → 签约日期 / 金额」组。
   * ★ 签约口径＝`sign_date IS NOT NULL`（系统**无 `signed` 状态**，→ `domain/contract.ts` 状态枚举）；
   *   逻辑删跳过。仅取聚合层要的三列（→ D-61 桥③ 拼 `relations_summary`）。
   */
  findSignedContractsByCompanyId(companyId: bigint) {
    return this.prisma.contract.findMany({
      where: { company_id: companyId, deleted_at: null, sign_date: { not: null } },
      select: { relation_id: true, sign_date: true, amount: true },
    });
  }

  /** 全部（`all` 档：总经理 / 管理员；管理员只读在 service 层拦） */
  listContractsAll(filter: ContractFilter, pagination: Pagination, options: ContractListOptions) {
    return this.pageOf({ deleted_at: null }, filter, pagination, options);
  }

  /** 这些部门的（`dept` 档：经理＝管辖部门；经底层关系 `dept_id` 收敛） */
  listContractsByDepts(
    deptIds: readonly bigint[],
    filter: ContractFilter,
    pagination: Pagination,
    options: ContractListOptions,
  ) {
    return this.pageOf(
      { deleted_at: null, relation: { dept_id: { in: [...deptIds] } } },
      filter,
      pagination,
      options,
    );
  }

  /** 我相关的（`self` 档：销售＝签单人 ∪ 关系 owner） */
  listContractsSelf(
    employeeId: bigint,
    filter: ContractFilter,
    pagination: Pagination,
    options: ContractListOptions,
  ) {
    return this.pageOf(
      {
        deleted_at: null,
        OR: [
          { signer_id: employeeId },
          {
            relation: {
              members: { some: { employee_id: employeeId, member_type: OWNER_MEMBER_TYPE, revoked_at: null } },
            },
          },
        ],
      },
      filter,
      pagination,
      options,
    );
  }

  /** 服务期内（`serving` 档：交付 / 客服，只读；合同服务未到期） */
  listContractsServing(now: Date, filter: ContractFilter, pagination: Pagination, options: ContractListOptions) {
    return this.pageOf({ deleted_at: null, service_end: { gte: now } }, filter, pagination, options);
  }

  /**
   * 疑似重复合同检测取数（→ B6 `GET /contracts/suspected-duplicates`）。
   * ★ 不收敛数据范围：范围由 service 通过 `scopeWhere` 传入（经理＝管辖部门 / 总经理＝全公司）；
   *   销售 / 交付·客服在 service 层直接 403（不进本查询）。
   * ★ 不分页、不限 `sign_date`（null 的无法比对，由 domain 在配对时跳过）。
   */
  findForDuplicateCheck(scopeWhere: Prisma.ContractWhereInput) {
    return this.prisma.contract.findMany({
      where: scopeWhere,
      select: {
        id: true,
        contract_no: true,
        company_id: true,
        signer_id: true,
        amount: true,
        sign_date: true,
      },
    });
  }

  // ===== 签约校验清单（B3：sign_checklist 表；ledger 类校验涉及 field_template，同域 E6）=====

  /** 某产品线全部清单项（含 disabled；→ §5.15 `GET /sign-checklists`） */
  listSignChecklist(productLineId: bigint) {
    return this.prisma.signChecklist.findMany({
      where: { product_line_id: productLineId },
      orderBy: { sort: 'asc' },
      select: {
        id: true,
        product_line_id: true,
        scope: true,
        field_key: true,
        label: true,
        required: true,
        sort: true,
        status: true,
      },
    });
  }

  /** 创建前硬卡用的 active＋required 项（→ §5.9 / §5.15） */
  getActiveRequiredSignChecklist(productLineId: bigint) {
    return this.prisma.signChecklist.findMany({
      where: { product_line_id: productLineId, status: 'active', required: true },
      select: {
        id: true,
        product_line_id: true,
        scope: true,
        field_key: true,
        label: true,
        required: true,
        sort: true,
        status: true,
      },
    });
  }

  /** 新增清单项（唯一冲突 `uk_line_scope_field` 由 service 层 `mapPrismaError` → 409） */
  createSignChecklist(data: {
    product_line_id: bigint;
    scope: string;
    field_key: string;
    label: string;
    required: boolean;
  }) {
    return this.prisma.signChecklist.create({ data });
  }

  /** 改清单项：仅 `required` / `sort` / `status` 可改（→ §5.15；不可变字段不在此处接收） */
  updateSignChecklist(
    id: bigint,
    data: { required?: boolean; sort?: number; status?: string },
  ) {
    return this.prisma.signChecklist.update({ where: { id }, data });
  }

  /** ledger 类 `field_key` 须先登记 `field_template`（→ §5.15 422 判据；`uk_line_key` 复合唯一） */
  async fieldTemplateExists(productLineId: bigint, fieldKey: string): Promise<boolean> {
    const row = await this.prisma.fieldTemplate.findUnique({
      where: { product_line_id_field_key: { product_line_id: productLineId, field_key: fieldKey } },
      select: { id: true },
    });
    return row !== null;
  }
}

/** 疑似重复检测取出的合同行（结构取自 `findForDuplicateCheck` 的 select，不手抄字段） */
export type ContractDuplicateRow = NonNullable<
  Awaited<ReturnType<TradeRepository['findForDuplicateCheck']>>
>[number];

/** 签约校验清单项（结构取自 `listSignChecklist` / `createSignChecklist` 的 select） */
export type SignChecklistRow = NonNullable<
  Awaited<ReturnType<TradeRepository['listSignChecklist']>>
>[number];

/** 仓储读出的合同行（结构取自 `CONTRACT_SELECT`，不手抄字段） */
export type ContractRow = NonNullable<Awaited<ReturnType<TradeRepository['findById']>>>;

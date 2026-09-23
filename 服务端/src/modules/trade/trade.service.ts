// =============================================================================
// E 域服务（M9-E / B2）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、跨域取引用、落库），**不写业务规则**
//   （纯规则在 `domain/contract.ts`）、**不写 SQL**（在 `trade.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.9（合同入参出参）、§2.2（数据范围四档）、§2.4（错误码）。
//   · 《销售CRM数据架构文档》E1（`contract` 表 / 状态 / `uk_contract_no`）。
//   · 《销售CRM架构设计说明》§5.2 跨域三条路：
//       ① 同步调对方 **exports 的 service** —— 取关系 / 公司 / 产品线 / 员工引用走这条（**禁止**查对方的表）；
//       ③ 改多表必须一起成功 → **本域 `$transaction`**（B5 回款才需要；本期单表创建无需）。
//   · 同 §7.4：**所有增删改都要留痕**——由 controller 的 `@Audit(...)` 声明，统一切面写 `operation_log`
//     （动作名＝本文件 `TRADE_AUDIT_ACTIONS`，只增不改）。
//   · 同 §7.5：`P2002` + `uk_contract_no` → **409**（人话由 `mapPrismaError` 给，与预检同源）。
//
// ★ 合同归属：公司 / 产品线从**底层关系**派生（合同本身不存 `dept_id`），故创建时先调 C 域
//   `getRelation` 取引用 ＋ 判可见性——E 域（L4）依赖 C 域（L3）合法（§3 层序）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import {
  AppError,
  type PageResult,
  ErrorCode,
  buildPageResult,
  getRequestContext,
  jsonToBigint,
  mapPrismaError,
  resolvePagination,
} from '../../kernel/index';
import { CompanyService } from '../company/company.service';
import { OrgService } from '../org/org.service';
import { RelationService } from '../relation/relation.service';
import { computePayProgress, expireLevelOf, isContractStatus } from './domain/contract';
import type { ContractFilter } from './domain/contract-filter';
import {
  TradeRepository,
  type ContractRow,
  type CreateContractData,
  type UpdateContractData,
} from './trade.repository';
import type { CreateContractDto, ListContractQueryDto, UpdateContractDto } from './dto/contract-request.dto';

/** 合同出参（→ §5.9；未落地字段见响应 DTO 文件头清单） */
export interface ContractVo {
  id: bigint;
  contract_no: string;
  company: { id: bigint; name: string } | null;
  product_line: { id: bigint; name: string; color_key: string | null } | null;
  signer: { id: bigint; name: string } | null;
  amount: string;
  paid_amount: string;
  pay_progress: number;
  status: string;
  sign_date: string | null;
  service_end: string | null;
  expire_level: number;
  created_at: string;
  updated_at: string;
}

/**
 * E 域写动作的审计动作名（→ A10 口径 `模块.动词`）。
 * ★ 集中一处导出：动作名是「谁在何时干了什么」的检索键，写歪一次就再也查不到那条记录。
 * ★ **只增不改**：改名＝历史审计断链；新增写动作在此追加。
 */
export const TRADE_AUDIT_ACTIONS = {
  /** 创建合同 → `POST /contracts` */
  create: 'contract.create',
  /** 更新合同 → `PUT /contracts/:id` */
  update: 'contract.update',
  /** 查看合同详情 → `GET /contracts/:id`（管理员查看留痕在 C 域口径下暂未单列，沿用切面兜底） */
  view: 'contract.view',
} as const;

@Injectable()
export class TradeService {
  constructor(
    private readonly repository: TradeRepository,
    private readonly org: OrgService,
    private readonly company: CompanyService,
    private readonly relation: RelationService,
  ) {}

  // ===== 创建（合同号服务端生成 ＋ 关系可见性 ＋ 唯一性预检 ＋ 落库）=====

  /**
   * 创建合同（→ §5.9 `POST /contracts`）。
   *
   * 顺序＝**先可见性、再金额下限、再唯一性、最后落库**：
   *   ① 关系可见性 —— 调 `RelationService.getRelation`，不存在 / 越界给 400 / 403（跨域走 service，不查表）；
   *   ② 公司 / 产品线必须能从关系取到（被逻辑删的关系取不到 → 400）；
   *   ③ 金额必须 > 0（DTO 已卡两位小数格式，这里卡业务下限）；
   *   ④ 合同号服务端生成 ＋ `findByContractNo` 预检（撞号给 409，**与 P2002 兜底同一句人话**）；
   *   ⑤ 落库（catch `P2002` → `mapPrismaError` → 409，覆盖并发下预检漏过的竞态）。
   * ★ `signer_id` ＝ **当前登录人**（签单人锁定＝业绩归属，终身不变，→ 数据架构 E1）。
   * ★ `company_id` / `product_line_id` 由关系**派生**（合同不存 dept，且避免与关系漂移）。
   */
  async createContract(dto: CreateContractDto): Promise<ContractVo> {
    const viewer = requireViewer();

    const relation = await this.relation.getRelation(dto.relation_id);
    if (relation.company === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '该业务关系所属公司档案不存在', {
        constraint: 'contract.company_missing',
      });
    }
    const productLineId = relation.product_line?.id;
    if (productLineId === undefined) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '该业务关系所属产品线不存在', {
        constraint: 'contract.product_line_missing',
      });
    }

    if (Number(dto.amount) <= 0) {
      throw new AppError(ErrorCode.REQUIRED_MISSING, 422, '合同金额必须大于 0', {
        constraint: 'contract.amount_invalid',
      });
    }

    const contractNo = await this.reserveContractNo();

    const data: CreateContractData = {
      contract_no: contractNo,
      relation_id: relation.id,
      company_id: relation.company.id,
      product_line_id: productLineId,
      ...(dto.contact_id === undefined ? {} : { contact_id: jsonToBigint(dto.contact_id, 'contact_id') }),
      signer_id: viewer.employeeId,
      amount: dto.amount,
      paid_amount: '0',
      ...(dto.pay_type === undefined ? {} : { pay_type: dto.pay_type }),
      ...(dto.sign_date === undefined ? {} : { sign_date: new Date(dto.sign_date) }),
      ...(dto.service_start === undefined ? {} : { service_start: new Date(dto.service_start) }),
      ...(dto.service_end === undefined ? {} : { service_end: new Date(dto.service_end) }),
      auto_renew: dto.auto_renew ?? false,
      ...(dto.remind_days === undefined ? {} : { remind_days: dto.remind_days }),
      status: 'unpaid',
      created_by: viewer.employeeId,
    };

    const created = await this.repository
      .createContract(data)
      .catch((error: unknown) => {
        const mapped = mapPrismaError(error);
        if (mapped !== null) throw mapped;
        throw error;
      });

    return this.buildVo(created, await this.loadRefs([created]));
  }

  // ===== 详情 / 列表 =====

  /** 合同详情（→ §5.9；本期只返回合同主体 ＋ 引用，payments/splits 属 B4/B5 留空） */
  async getContract(id: string): Promise<ContractVo> {
    const contractId = jsonToBigint(id, 'id');
    const row = await this.repository.findById(contractId);
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：合同不存在', {
        constraint: 'contract.not_found',
      });
    }
    // 可见性 ＝ 底层关系可见（跨域走 C 域 service；serving 在 update 拦、get 允许看）
    await this.relation.getRelation(row.relation_id.toString());
    return this.buildVo(row, await this.loadRefs([row]));
  }

  /**
   * 合同列表（→ §5.9 `GET /contracts`；按数据范围四档收敛）。
   *
   * ★ 档位判定走 `context.dataScope`（→ 架构 §7.1 横切层）：`all` 全公司、`dept` 管辖部门、
   *   `self` 我相关（签单人 ∪ 关系 owner）、`serving` 服务期内（只读）。
   *   `self` / `dept` 经底层关系 `dept_id` / `members` 收敛（合同无 dept 列，→ 仓储注释 ★）。
   * ★ 分页默认值与上限归 kernel 一处（`resolvePagination`）：本层只把 snake_case 的
   *   `page_size` 桥接成 `PaginationQuery.pageSize`（→ §2.6 / §2.7）。
   */
  async listContracts(query: ListContractQueryDto = {}): Promise<PageResult<ContractVo>> {
    const viewer = requireViewer();
    const pagination = resolvePagination({ page: query.page, pageSize: query.page_size });
    const filter: ContractFilter = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
    };
    const options = { orderField: query.order_by, desc: query.desc === 'false' ? false : true };

    const result =
      viewer.dataScope === 'all'
        ? await this.repository.listContractsAll(filter, pagination, options)
        : viewer.dataScope === 'dept'
          ? await this.repository.listContractsByDepts(viewer.deptIds, filter, pagination, options)
          : viewer.dataScope === 'serving'
            ? await this.repository.listContractsServing(new Date(), filter, pagination, options)
            : await this.repository.listContractsSelf(viewer.employeeId, filter, pagination, options);

    const refs = await this.loadRefs(result.rows);
    return buildPageResult(
      result.rows.map((row) => this.buildVo(row, refs)),
      result.total,
      pagination,
    );
  }

  // ===== 更新 =====

  /**
   * 更新合同（→ §5.9 `PUT /contracts/:id`）。
   *
   * ★ 交付 / 客服（`serving` 档）只读 → **403**（→ §2.2 数据范围）；
   *   其余可写角色须能看到底层关系（`getRelation` 判可见性），看不到＝403。
   * ★ 只改给了值的字段；`status` 走白名单 `isContractStatus` 校验（避免落非法状态值）。
   */
  async updateContract(id: string, dto: UpdateContractDto): Promise<ContractVo> {
    const viewer = requireViewer();
    if (viewer.dataScope === 'serving') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '当前角色对合同只读（交付 / 客服）', {
        constraint: 'contract.read_only',
      });
    }

    const contractId = jsonToBigint(id, 'id');
    const row = await this.repository.findById(contractId);
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：合同不存在', {
        constraint: 'contract.not_found',
      });
    }
    // 可见性 ＝ 底层关系可见
    await this.relation.getRelation(row.relation_id.toString());

    if (dto.status !== undefined && !isContractStatus(dto.status)) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：status 取值不合法', {
        constraint: 'contract.status_invalid',
      });
    }

    const data: UpdateContractData = {
      updated_by: viewer.employeeId,
      ...(dto.pay_type === undefined ? {} : { pay_type: dto.pay_type }),
      ...(dto.status === undefined ? {} : { status: dto.status }),
      ...(dto.auto_renew === undefined ? {} : { auto_renew: dto.auto_renew }),
      ...(dto.remind_days === undefined ? {} : { remind_days: dto.remind_days }),
      ...(dto.service_start === undefined ? {} : { service_start: toDateOrNull(dto.service_start) }),
      ...(dto.service_end === undefined ? {} : { service_end: toDateOrNull(dto.service_end) }),
      ...(dto.attachments === undefined ? {} : { attachments: dto.attachments }),
    };

    const updated = await this.repository
      .updateContract(contractId, data)
      .catch((error: unknown) => {
        const mapped = mapPrismaError(error);
        if (mapped !== null) throw mapped;
        throw error;
      });

    return this.buildVo(updated, await this.loadRefs([updated]));
  }

  // ===== 私有：合同号生成 / 取数 / 装配 =====

  /**
   * 服务端生成合同号 ＋ 唯一性预检（→ 数据架构 E1 `uk_contract_no`）。
   * ★ 撞号概率极低（日期 ＋ 6 位随机），但仍预检一次给人话；预检漏过的并发由 `P2002` 兜底
   *   （两句人话同源：都来自内核 `mapPrismaError` 的 `uk_contract_no` 规则）。
   */
  private async reserveContractNo(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = generateContractNo();
      const hit = await this.repository.findByContractNo(candidate);
      if (hit === null) return candidate;
    }
    throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '合同编号生成冲突，请重试', {
      constraint: 'contract.no_conflict',
    });
  }

  /** 批量取跨域引用（一次列表一次往返，不按行查）：公司（B）＋ 产品线 / 员工（A） */
  private async loadRefs(rows: readonly ContractRow[]) {
    const [companies, productLines, signers] = await Promise.all([
      this.company.getCompanyRefs(uniqueBigints(rows.map((row) => row.company_id))),
      this.org.getProductLineRefs(uniqueBigints(rows.map((row) => row.product_line_id))),
      this.org.getEmployeeRefs(uniqueBigints(rows.map((row) => row.signer_id))),
    ]);

    return {
      companies: toNameMap(companies),
      productLines: new Map(
        productLines.map((line) => [line.id.toString(), { name: line.name, colorKey: line.color_key }]),
      ),
      signers: toNameMap(signers),
    };
  }

  /** 行 → 出参（纯装配；范围 / 唯一键等判断都不在这一层做） */
  private buildVo(row: ContractRow, refs: RefMaps): ContractVo {
    return {
      id: row.id,
      contract_no: row.contract_no,
      company: refOf(refs.companies, row.company_id),
      product_line: productLineRefOf(refs.productLines, row.product_line_id),
      signer: refOf(refs.signers, row.signer_id),
      amount: row.amount.toString(),
      paid_amount: row.paid_amount.toString(),
      pay_progress: computePayProgress(row.amount.toString(), row.paid_amount.toString()),
      status: row.status,
      sign_date: row.sign_date === null ? null : row.sign_date.toISOString(),
      service_end: row.service_end === null ? null : row.service_end.toISOString(),
      expire_level: expireLevelOf(row.service_end),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}

/** 跨域引用表（id 十进制串 → 名字 / 产品线信息）；取不到就是「没有」（调用方给 `null`，不编名字） */
interface RefMaps {
  companies: Map<string, string>;
  productLines: Map<string, { name: string; colorKey: string | null }>;
  signers: Map<string, string>;
}

/** 当前登录人 → viewer（**只从令牌/上下文来**，不查库，→ 架构 §7.1） */
function requireViewer(): {
  employeeId: bigint;
  roleCodes: readonly string[];
  dataScope: string;
  deptIds: readonly bigint[];
} {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'contract.no_context',
    });
  }
  return {
    employeeId: context.employeeId,
    roleCodes: context.roleCodes,
    dataScope: context.dataScope as unknown as string,
    deptIds: context.deptIds,
  };
}

/** ISO 日期字符串 → Date；`undefined` 当 null 处理（清空前端的空值） */
function toDateOrNull(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

/** 合同号：`CN` ＋ 年月日 ＋ 6 位随机（→ 数据架构 E1 `uk_contract_no` 唯一） */
function generateContractNo(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return `CN${ymd}${rand}`;
}

function uniqueBigints(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids)];
}

function toNameMap(refs: readonly { id: bigint; name: string }[]): Map<string, string> {
  return new Map(refs.map((ref) => [ref.id.toString(), ref.name]));
}

/** id → `{id,name}`；引用取不到 → `null`（跨域出口只回未删除的行：已删档案 / 已停用员工取不到） */
function refOf(map: Map<string, string>, id: bigint): { id: bigint; name: string } | null {
  const name = map.get(id.toString());
  return name === undefined ? null : { id, name };
}

/** id → `{id,name,color_key}`（产品线专用；未配置配色 → 该字段 `null`，不编默认色） */
function productLineRefOf(
  map: Map<string, { name: string; colorKey: string | null }>,
  id: bigint,
): { id: bigint; name: string; color_key: string | null } | null {
  const hit = map.get(id.toString());
  return hit === undefined ? null : { id, name: hit.name, color_key: hit.colorKey };
}

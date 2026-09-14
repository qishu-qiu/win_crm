// =============================================================================
// A 域服务（M1-08 登录 / M1-09 刷新 / M1-10 me / M1-13 只读列表）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、发事件），
//   **不写业务规则**（口径在 `domain/`）、**不写 SQL**（在 `*.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.12 §5.2：`POST /account/login` req `{phone,password}`、
//     resp `{access_token, refresh_token, user: UserVO}`；`GET /account/me` → `UserVO`
//     ＝ `{id,name,role,dept:{id,name},managed_dept_ids:[],permissions:{}}`。
//   · 同 §2.2：`access_token` Bearer JWT（建议 2h）＋ `refresh_token`；§2.4：401/20002、403/20003。
//   · 《销售CRM架构设计说明》V1.1 §7.1：`RequestContext` 随令牌带进请求，
//     **横切层只读上下文、不查库** —— 故登录时把「我是谁、管哪些部门、什么角色、什么范围」一次性签进令牌。
//   · 同 §7.4：登录是**敏感动作**，须在业务事务内写 `operation_log`（→ M0-30 的 `AuditService`）。
//
// ⚠ 与《开发计划》M1-03 的一处冲突（按铁律「以规格为准」，已记入 M1 完成报告）：
//   计划写「按 `username` 查员工」，但数据架构 A2 `employee` **没有 `username` 列**，
//   登录唯一键是 `phone`（API §5.2 req 亦为 `{phone,password}`）→ 实现取 `phone`。
// =============================================================================
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  AppError,
  AuditService,
  ErrorCode,
  REFRESH_TOKEN_MARK,
  REFRESH_TOKEN_TTL,
  fromClaims,
  getRequestContext,
  runInTransaction,
  toClaims,
  type AuditLogInput,
  type RequestContext,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveDataScope, resolvePrimaryRole } from './domain/data-scope';
import { verifyPassword } from './domain/password';
import { mergePermissionLevels } from './domain/permission';
import type { LoginDto } from './dto/login.dto';
import { OrgRepository, parseIdList } from './org.repository';

/** 员工鉴权行（结构直接取自仓储的 `select`，**不手抄字段** —— 避免两处漂移） */
type EmployeeAuthRow = NonNullable<Awaited<ReturnType<OrgRepository['findEmployeeByPhone']>>>;

/** `UserVO`（→ API §5.2；`bigint` 由统一的出参拦截器转字符串，此处保持原样） */
export interface UserVo {
  id: bigint;
  name: string;
  role: string;
  dept: { id: bigint; name: string } | null;
  managed_dept_ids: bigint[];
  permissions: Record<string, string>;
}

/** 登录出参（→ API §5.2） */
export interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: UserVo;
}

/** 刷新出参（→ API §三 `/account/refresh`；规格未给字段名，与 §2.2 的键名保持一致） */
export interface RefreshResult {
  access_token: string;
  refresh_token: string;
}

/** 请求元信息（审计用；由 controller 从 `@Ip()` / `@Headers()` 取，service 不碰 HTTP 对象） */
export interface RequestMeta {
  ip?: string;
  user_agent?: string;
  req_id?: string;
}

/**
 * 登录路径的三个审计动作名（→ A10 口径 `模块.动词`）。
 * ★ 集中一处导出，**不让 spec 与实现各写一遍字符串**：动作名是「谁在什么时候被拒」的检索键，
 *   写歪一次就再也查不到那条记录（这类双真相源在本项目被列为一号坑）。
 */
export const ORG_AUDIT_ACTIONS = {
  /** 登录成功 */
  loginSuccess: 'account.login.success',
  /** 凭据不对（手机号不存在 / 密码错，**对外同一句人话**，真实原因只进 detail） */
  loginFail: 'account.login.fail',
  /** 凭据对但账号不可登录（停用 / 离职） */
  loginRejected: 'account.login.rejected',
} as const;

/**
 * 手机号查不到人时的审计操作人。
 * → A10 口径「系统动作 = 0」；此处借用该值表示「无对应员工」，**绝不用 `undefined`**
 *   （`AuditService.resolveOperatorId` 在无请求上下文 + 未传 operator_id 时会抛错，
 *    而登录成功前本来就没有请求上下文）。
 */
const UNKNOWN_OPERATOR_ID = 0n;

/** 员工 → 鉴权事实（一次装载，登录 / 刷新 / me 三处复用，避免重复查库） */
interface AuthFacts {
  employee: EmployeeAuthRow;
  roleCodes: string[];
  managedDeptIds: bigint[];
}

/** 去重（主部门常与兼部门重复） */
function unique(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids)];
}

@Injectable()
export class OrgService {
  constructor(
    private readonly repository: OrgRepository,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  // ===== M1-08 / M1-09 登录 =====

  /**
   * 登录：手机号 + 密码 → 双令牌 + `UserVO`。
   *
   * ★ 「手机号不存在」与「密码不对」**对外同一句人话、同一个错误码** ——
   *   否则这个接口就是一台**手机号枚举器**（能据此判断某手机号是不是本司员工）。
   *   真实原因只写进审计 `detail`，供安全排查。
   */
  async login(input: LoginDto, meta: RequestMeta = {}): Promise<LoginResult> {
    const employee = await this.repository.findEmployeeByPhone(input.phone);
    const passwordOk =
      employee !== null && (await verifyPassword(input.password, employee.password_hash));

    if (!passwordOk || employee === null) {
      // ⚠ 审计**先落**再抛 401：审计是硬要求（§7.4），落不下去就该以 500 暴露，
      //   绝不 try/catch 吞掉 —— 否则「有人正在暴破」这件事会被静默丢弃。
      await this.recordAudit({
        action: ORG_AUDIT_ACTIONS.loginFail,
        operator_id: employee?.id ?? UNKNOWN_OPERATOR_ID,
        operator_name: employee?.name,
        detail: {
          phone: input.phone,
          reason: employee === null ? 'phone_not_found' : 'bad_password',
        },
        ...meta,
      });
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '手机号或密码不正确', {
        constraint: 'account.login.credentials',
      });
    }

    if (employee.status !== 'active') {
      await this.recordAudit({
        action: ORG_AUDIT_ACTIONS.loginRejected,
        operator_id: employee.id,
        operator_name: employee.name,
        detail: { status: employee.status },
        ...meta,
      });
      throw new AppError(ErrorCode.FORBIDDEN, 403, '账号已停用，请联系管理员', {
        constraint: `account.status.${employee.status}`,
      });
    }

    const facts = await this.loadAuthFacts(employee);
    const tokens = this.signTokens(this.toRequestContext(facts));

    await this.recordAudit({
      action: ORG_AUDIT_ACTIONS.loginSuccess,
      operator_id: employee.id,
      operator_name: employee.name,
      dept_id: employee.primary_dept_id,
      ...meta,
    });

    return { ...tokens, user: await this.toUserVo(facts) };
  }

  // ===== M1-12 刷新 =====

  /**
   * 刷新：用 `refresh_token` 换一对**新**令牌。
   *
   * ★ 三重校验，缺一不可：
   *   ① `jwt.verify` —— 签名 + 有效期（伪造 / 过期在此被拒）；
   *   ② `tk === 'refresh'` —— **判别位**，把 access_token 挡在门外（同密钥，verify 分不出来）；
   *   ③ `fromClaims` —— 声明形状（形状坏掉退化成伪装上下文用）。
   *
   * ★ **重新装载**（而不是直接沿用旧令牌里的角色 / 部门）：续期时把最新的角色与管辖部门吃进来，
   *   否则「刚被撤掉经理」的人还能拿着旧范围继续查数，直到 access 过期。
   */
  async refresh(refreshToken: string): Promise<RefreshResult> {
    const invalid = (constraint: string): AppError =>
      new AppError(ErrorCode.UNAUTHENTICATED, 401, '刷新令牌无效或已过期', { constraint });

    let payload: unknown;
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw invalid('account.refresh.verify');
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      (payload as Record<string, unknown>).tk !== REFRESH_TOKEN_MARK
    ) {
      throw invalid('account.refresh.kind');
    }

    const claimed = fromClaims(payload); // 形状非法 → 自身抛 401 / 20002
    const employee = await this.requireActiveEmployee(claimed.employeeId);
    return this.signTokens(this.toRequestContext(await this.loadAuthFacts(employee)));
  }

  // ===== M1-10 我是谁 =====

  /**
   * 当前登录人 → `UserVO`。
   * ★ 入参取自**令牌带来的请求上下文**（`RequestContext` 由 M0-32 守卫解析令牌写入），
   *   这里**不回查令牌内容** —— 但 `name` / `dept` 这些**不在令牌里**的展示字段必须回库取，
   *   故本方法查库（与 §7.1「横切层不查库」不冲突：那是**守卫**的纪律，service 本就该编排数据）。
   */
  async me(): Promise<UserVo> {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'account.me.no_context',
      });
    }
    const employee = await this.requireActiveEmployee(context.employeeId);
    return this.toUserVo(await this.loadAuthFacts(employee));
  }

  // ===== M1-13 四个只读接口 =====

  /** 部门列表（→ API §5.4；树形由 `parent_id` 自带，前端自行组树） */
  async listDepartments() {
    const [departments, deptManagers, productLines] = await Promise.all([
      this.repository.listDepartments(),
      this.repository.findDeptManagers(),
      this.repository.listProductLines(),
    ]);

    // `manager_ids`：经理在**部门侧**（A3），需按部门聚合
    const managersByDept = new Map<string, bigint[]>();
    for (const row of deptManagers) {
      const key = row.dept_id.toString();
      const list = managersByDept.get(key);
      if (list === undefined) {
        managersByDept.set(key, [row.employee_id]);
      } else {
        list.push(row.employee_id);
      }
    }

    // `product_line_ids`：承接部门写在**产品线侧**（A7 `dept_ids` JSON），故需反向索引
    const linesByDept = new Map<string, bigint[]>();
    for (const line of productLines) {
      for (const deptId of parseIdList(line.dept_ids)) {
        const key = deptId.toString();
        const list = linesByDept.get(key);
        if (list === undefined) {
          linesByDept.set(key, [line.id]);
        } else {
          list.push(line.id);
        }
      }
    }

    return departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      parent_id: dept.parent_id,
      service_enabled: dept.service_enabled,
      status: dept.status,
      manager_ids: managersByDept.get(dept.id.toString()) ?? [],
      product_line_ids: linesByDept.get(dept.id.toString()) ?? [],
    }));
  }

  /** 员工列表（→ API §5.4；**不含密码哈希**） */
  async listEmployees() {
    const employees = await this.repository.listEmployees();
    const ids = employees.map((employee) => employee.id);

    const [rolesByEmployee, departments, productLines, managers] = await Promise.all([
      this.repository.findRolesByEmployeeIds(ids),
      this.repository.findDepartmentsByIds(
        employees.flatMap((employee) => [
          employee.primary_dept_id,
          ...parseIdList(employee.extra_dept_ids),
        ]),
      ),
      this.repository.listProductLines(),
      this.repository.findEmployeesByIds(
        employees
          .map((employee) => employee.direct_manager_id)
          .filter((id): id is bigint => id !== null),
      ),
    ]);

    const deptById = new Map(departments.map((dept) => [dept.id.toString(), dept]));
    const lineById = new Map(productLines.map((line) => [line.id.toString(), line]));
    const managerById = new Map(managers.map((row) => [row.id.toString(), row]));

    const toRef = (id: bigint): { id: bigint; name: string } | null => {
      const dept = deptById.get(id.toString());
      return dept === undefined ? null : { id: dept.id, name: dept.name };
    };

    return employees.map((employee) => {
      const manager =
        employee.direct_manager_id === null
          ? null
          : (managerById.get(employee.direct_manager_id.toString()) ?? null);

      return {
        id: employee.id,
        work_no: employee.work_no,
        name: employee.name,
        phone: employee.phone,
        primary_dept: toRef(employee.primary_dept_id),
        extra_depts: parseIdList(employee.extra_dept_ids)
          .map((id) => toRef(id))
          .filter((ref): ref is { id: bigint; name: string } => ref !== null),
        product_lines: parseIdList(employee.product_line_ids)
          .map((id) => {
            const line = lineById.get(id.toString());
            return line === undefined ? null : { id: line.id, name: line.name };
          })
          .filter((ref): ref is { id: bigint; name: string } => ref !== null),
        direct_manager: manager === null ? null : { id: manager.id, name: manager.name },
        roles: rolesByEmployee.get(employee.id.toString()) ?? [],
        status: employee.status,
      };
    });
  }

  /** 角色列表（→ API §5.4 `{code,name,is_builtin}`） */
  listRoles() {
    return this.repository.listRoles();
  }

  /** 权限矩阵（→ API §5.4 `{perm_key,role_code,level}`） */
  listPermissions() {
    return this.repository.listPermissionMatrix();
  }

  // ===== 私有：装载 / 装配 / 签发 / 审计 =====

  /** 按主键装载**在职**员工；不存在或非在职一律拒绝（刷新与 me 共用） */
  private async requireActiveEmployee(employeeId: bigint): Promise<EmployeeAuthRow> {
    const employee = await this.repository.findEmployeeById(employeeId);
    if (employee === null) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '账号不存在或已停用', {
        constraint: 'account.employee.missing',
      });
    }
    if (employee.status !== 'active') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '账号已停用，请联系管理员', {
        constraint: `account.status.${employee.status}`,
      });
    }
    return employee;
  }

  /** 装载鉴权事实：角色码 + 管辖部门（两者并行取，互不依赖） */
  private async loadAuthFacts(employee: EmployeeAuthRow): Promise<AuthFacts> {
    const [roleCodes, managedDeptIds] = await Promise.all([
      this.repository.findRoleCodes(employee.id),
      this.repository.findManagedDeptIds(employee.id),
    ]);
    return { employee, roleCodes, managedDeptIds };
  }

  /**
   * 鉴权事实 → 请求上下文（→ 架构 §7.1 / §7.2）。
   *
   * `deptIds` ＝ **我所属 ∪ 我管辖**（兼部门也算「我的部门」，否则兼部门员工在列表里看不到本职数据）；
   * `dataScope.deptIds` 只在 `dept` 档填值（→ `jwt-claims.ts` 的声明契约：
   * `self` / `all` 时必须是**空数组**，缺字段会被判成非法令牌）。
   */
  private toRequestContext(facts: AuthFacts): RequestContext {
    const ownedDeptIds = unique([
      facts.employee.primary_dept_id,
      ...parseIdList(facts.employee.extra_dept_ids),
    ]);
    const type = resolveDataScope(facts.roleCodes);
    return {
      employeeId: facts.employee.id,
      deptIds: unique([...ownedDeptIds, ...facts.managedDeptIds]),
      roleCodes: facts.roleCodes,
      dataScope: {
        type,
        deptIds: type === 'dept' ? facts.managedDeptIds : [],
      },
    };
  }

  /** 签发双令牌（**必须走 `toClaims`**，不许手搓键名 → `jwt-claims.ts` 契约） */
  private signTokens(context: RequestContext): RefreshResult {
    const claims = toClaims(context);
    return {
      access_token: this.jwt.sign(claims),
      refresh_token: this.jwt.sign(
        // `tk` 判别位：让刷新接口能把 access_token 挡在门外（→ `REFRESH_TOKEN_MARK` 注释）
        { ...claims, tk: REFRESH_TOKEN_MARK },
        { expiresIn: REFRESH_TOKEN_TTL },
      ),
    };
  }

  /** 鉴权事实 → `UserVO`（→ API §5.2） */
  private async toUserVo(facts: AuthFacts): Promise<UserVo> {
    const [departments, permissions] = await Promise.all([
      this.repository.findDepartmentsByIds([facts.employee.primary_dept_id]),
      this.repository.findPermissions(facts.roleCodes),
    ]);
    const primaryDept = departments[0];

    return {
      id: facts.employee.id,
      name: facts.employee.name,
      role: resolvePrimaryRole(facts.roleCodes),
      dept: primaryDept === undefined ? null : { id: primaryDept.id, name: primaryDept.name },
      managed_dept_ids: facts.managedDeptIds,
      permissions: mergePermissionLevels(permissions, facts.roleCodes),
    };
  }

  /**
   * 写审计（登录成功 / 失败 / 被拒）。
   * ★ 审计**必须在事务上下文里写**（M0-30 判据：无事务即抛），而登录路径本身没有别的业务写入，
   *   故这里为审计单开一个事务 —— 与 §7.4「业务失败一起回滚」等价：审计要么落库、要么整体失败。
   */
  private async recordAudit(input: AuditLogInput): Promise<void> {
    await this.prisma.$transaction(async (tx) =>
      runInTransaction(tx, async () => {
        await this.audit.record(input);
      }),
    );
  }
}

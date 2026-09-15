// =============================================================================
// A 域仓储（M1-03 / M1-04 / M1-05 / M1-13）
//
// 分层约束（架构 §5.4）：**本文件是全项目「唯一允许 import `@prisma/client` 干活的层」**
//   —— 只查 / 写库，**不写业务判断**（口径判定在 `domain/`、编排在 `*.service.ts`）。
//   故此处不做「是不是经理」「角色该给什么范围」这类判断，只把行取回来、把 JSON 列**拉直**。
//
// 口径来源（★ 真相源，勿自造）：
//   · 表 / 字段 / 索引 →《销售CRM数据架构文档》V1.31 域 A（A1~A7）。
//   · 出参字段形状 →《销售CRM接口API文档》V1.16 §5.3：
//       部门 `{id,name,parent_id,service_enabled,status,manager_ids:[],product_line_ids:[]}`
//       员工 `{id,work_no,name,phone,username?,primary_dept:{id,name},extra_depts:[],product_lines:[],
//              direct_manager:{id,name},roles:["sale"],status}`
//       角色 `{code,name,is_builtin}` / 权限矩阵行 `{perm_key,role_code,level}`
//   · 逻辑删除一律 `deleted_at IS NULL`（数据架构 §二 总则）。
//
// ★ 2026-09-14：登录改**双通道**（手机号 或 账号名，→ 接口 §5.2 / 登记表 #32），
//   故此处提供两个查询入口，**通道判别不在这里**（判别是业务规则 → `domain/login-account.ts`）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * 登录 / 鉴权要用的员工列（**刻意不含** `extra_dept_ids` / `product_line_ids` 之外的冗余列）。
 * 密码哈希**只**在登录路径取一次，列表接口绝不带它出库。
 */
const EMPLOYEE_AUTH_SELECT = {
  id: true,
  work_no: true,
  name: true,
  phone: true,
  // 登录账号名：登录路径要把它带出来（`UserVO.username`，→ 接口 §5.2），且它也是**双通道之一**
  username: true,
  password_hash: true,
  primary_dept_id: true,
  extra_dept_ids: true,
  product_line_ids: true,
  direct_manager_id: true,
  status: true,
} as const;

/** 只读列表用的员工列（**不含 `password_hash`** —— 列表接口绝不带哈希出库） */
const EMPLOYEE_LIST_SELECT = {
  id: true,
  work_no: true,
  name: true,
  phone: true,
  username: true,
  primary_dept_id: true,
  extra_dept_ids: true,
  product_line_ids: true,
  direct_manager_id: true,
  status: true,
} as const;

/**
 * JSON 列（`extra_dept_ids` / `product_line_ids` / `dept_ids`）→ `bigint` 集合。
 *
 * ★ 为什么要「拉直 + 容错」而不是直接 `value as bigint[]`：
 *   MySQL 的 JSON 列**不保证**元素是数字（手工 INSERT / 导入可能写成字符串 `"12"`），
 *   而 `JSON.parse` 出来的 `1234567890123456789` 还会**精度丢失**（JS number 只有 53 位）。
 *   故：数字取整、字符串走正则，**其余一律丢弃** —— 宁可少一个部门，也不让脏数据把登录打成 500。
 */
export function parseIdList(value: unknown): bigint[] {
  if (!Array.isArray(value)) return [];
  const ids: bigint[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 0) {
      ids.push(BigInt(item));
    } else if (typeof item === 'string' && /^\d+$/.test(item)) {
      ids.push(BigInt(item));
    }
  }
  return ids;
}

/** 去重（部门 / 产品线集合常出现「主部门又出现在兼部门里」） */
function uniqueBigints(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids)];
}

@Injectable()
export class OrgRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===== M1-03 取员工（登录双通道：手机号 / 登录账号名） =====

  /** 按手机号取**未删除**员工（含密码哈希，仅供登录路径使用） */
  findEmployeeByPhone(phone: string) {
    return this.prisma.employee.findFirst({
      where: { phone, deleted_at: null },
      select: EMPLOYEE_AUTH_SELECT,
    });
  }

  /**
   * 按**登录账号名**取**未删除**员工（双通道的第二条，→ 接口 §5.2）。
   *
   * ★ 大小写不敏感由**库的排序规则**（`utf8mb4_unicode_ci`）完成，此处**刻意不做** `toLowerCase`：
   *   → A2 / `0003_username_and_phone_lock` 注释原文「不区分大小写（跟随库 / 表 `utf8mb4_unicode_ci`，
   *   **登录时无需额外处理**）」。若将来排序规则改成区分大小写，应在此层统一改写两侧
   *   （既改查询值、也依赖库侧规则），而**不是**在 domain 里改输入值 —— 那会让「库里存的是
   *   大写形式」这类数据永远查不到。
   */
  findEmployeeByUsername(username: string) {
    return this.prisma.employee.findFirst({
      where: { username, deleted_at: null },
      select: EMPLOYEE_AUTH_SELECT,
    });
  }

  /** 按主键取**未删除**员工（`/account/me` 与刷新令牌时重装配用，含密码哈希以便复用同一行类型） */
  findEmployeeById(id: bigint) {
    return this.prisma.employee.findFirst({
      where: { id, deleted_at: null },
      select: EMPLOYEE_AUTH_SELECT,
    });
  }

  // ===== M1-04 角色码 + 管辖部门 =====

  /** 员工角色码集合（→ A5 `employee_role`；表无软删列，故不带 `deleted_at` 条件） */
  async findRoleCodes(employeeId: bigint): Promise<string[]> {
    const rows = await this.prisma.employeeRole.findMany({
      where: { employee_id: employeeId },
      select: { role_code: true },
      orderBy: { role_code: 'asc' },
    });
    return rows.map((row) => row.role_code);
  }

  /** 员工管辖部门 id 集合（→ A3 `dept_manager`；**经理查数范围就是这个集合**） */
  async findManagedDeptIds(employeeId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.deptManager.findMany({
      where: { employee_id: employeeId, deleted_at: null },
      select: { dept_id: true },
      orderBy: { dept_id: 'asc' },
    });
    return rows.map((row) => row.dept_id);
  }

  /** 批量取「部门 → 经理 id 集合」（`/org/departments` 的 `manager_ids`） */
  async findDeptManagers(): Promise<{ dept_id: bigint; employee_id: bigint }[]> {
    return this.prisma.deptManager.findMany({
      where: { deleted_at: null },
      select: { dept_id: true, employee_id: true },
    });
  }

  // ===== M1-05 权限矩阵 =====

  /**
   * 角色码集合 → 权限矩阵行（→ A6 `permission_matrix`）。
   * 空集合**必须短路返回 `[]`**：`{ in: [] }` 在 MySQL 里恒为假，白跑一趟还容易写错。
   */
  async findPermissions(
    roleCodes: readonly string[],
  ): Promise<{ perm_key: string; role_code: string; level: string }[]> {
    if (roleCodes.length === 0) return [];
    return this.prisma.permissionMatrix.findMany({
      where: { role_code: { in: [...roleCodes] } },
      select: { perm_key: true, role_code: true, level: true },
      orderBy: [{ perm_key: 'asc' }, { role_code: 'asc' }],
    });
  }

  // ===== 装配用：批量取名 =====

  /** 按 id 批量取部门（只要 id/name，供 VO 装配） */
  async findDepartmentsByIds(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.department.findMany({
      where: { id: { in: uniqueBigints(ids) }, deleted_at: null },
      select: { id: true, name: true },
    });
  }

  /** 按 id 批量取员工（只要 id/name，供「直属经理」等引用装配） */
  async findEmployeesByIds(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.employee.findMany({
      where: { id: { in: uniqueBigints(ids) }, deleted_at: null },
      select: { id: true, name: true },
    });
  }

  /**
   * 按 id 批量取**产品线**引用（供 C 域 `product_line:{id,name,color_key}` 装配，→ 接口 §5.6）。
   *
   * ★ `color_key`（固定配色键）原**无数据源**：需求 §13.3「产品线 = 全系统固定配色（7 条线各一色）」
   *   与接口 §4.1 / §5.3 / §5.6 都要求它，《数据架构文档》A7 却漏落该列 ⇒ 2026-09-15 补
   *   `product_line.color_key`（migration `0004`），三处口径就此对齐。列**可空**：未配置给 `null`，
   *   由前端回落（**不编默认色** —— 假默认色会让页面理直气壮地渲染错颜色）。
   */
  async findProductLinesByIds(
    ids: readonly bigint[],
  ): Promise<{ id: bigint; name: string; color_key: string | null }[]> {
    if (ids.length === 0) return [];
    return this.prisma.productLine.findMany({
      where: { id: { in: uniqueBigints(ids) }, deleted_at: null },
      select: { id: true, name: true, color_key: true },
    });
  }

  /**
   * 取某员工的**部门集合（主部门 ＋ 兼部门）** —— 供 C 域判「@求助是否同部门」（→ 需求 §4.3）。
   *
   * ★ 为什么由 A 域提供、C 域不自己查：`employee` 是 A 域的表，跨域查表被架构 §5.2 禁止；
   *   C 域只该问「这个人有哪些部门」，**怎么取**是 A 域的事（主 / 兼的存储形状不外泄）。
   */
  async findEmployeeDeptIds(employeeId: bigint): Promise<bigint[]> {
    const row = await this.prisma.employee.findFirst({
      where: { id: employeeId, deleted_at: null },
      select: { primary_dept_id: true, extra_dept_ids: true },
    });
    if (row === null) return [];
    return [row.primary_dept_id, ...parseIdList(row.extra_dept_ids)];
  }

  /** 批量取员工角色码（`/org/employees` 的 `roles` 列），返回 员工 id → 角色码数组 */
  async findRolesByEmployeeIds(
    employeeIds: readonly bigint[],
  ): Promise<Map<string, string[]>> {
    const grouped = new Map<string, string[]>();
    if (employeeIds.length === 0) return grouped;

    const rows = await this.prisma.employeeRole.findMany({
      where: { employee_id: { in: uniqueBigints(employeeIds) } },
      select: { employee_id: true, role_code: true },
      orderBy: { role_code: 'asc' },
    });
    for (const row of rows) {
      const key = row.employee_id.toString();
      const list = grouped.get(key);
      if (list === undefined) {
        grouped.set(key, [row.role_code]);
      } else {
        list.push(row.role_code);
      }
    }
    return grouped;
  }

  // ===== M1-13 四个只读接口的数据源 =====

  /** `GET /org/departments`：部门行（树形关系由 `parent_id` 自带，前端自行组树） */
  async listDepartments(): Promise<
    { id: bigint; name: string; parent_id: bigint; service_enabled: boolean; status: string }[]
  > {
    return this.prisma.department.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        parent_id: true,
        service_enabled: true,
        status: true,
      },
      orderBy: [{ parent_id: 'asc' }, { id: 'asc' }],
    });
  }

  /** 产品线（用于把部门行的 `product_line_ids` 反查出来 —— A7 把承接部门写在**产品线侧**） */
  async listProductLines(): Promise<
    { id: bigint; name: string; code: string; dept_ids: unknown }[]
  > {
    return this.prisma.productLine.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true, code: true, dept_ids: true },
      orderBy: { id: 'asc' },
    });
  }

  /** `GET /org/employees`：员工行（不含密码哈希） */
  async listEmployees() {
    return this.prisma.employee.findMany({
      where: { deleted_at: null },
      select: EMPLOYEE_LIST_SELECT,
      orderBy: { id: 'asc' },
    });
  }

  /** `GET /org/roles`：**内置 6 条**角色（→ A4；`deleted_at IS NULL` 防自定义角色被删后仍返回） */
  async listRoles(): Promise<{ code: string; name: string; is_builtin: boolean }[]> {
    return this.prisma.role.findMany({
      where: { deleted_at: null },
      select: { code: true, name: true, is_builtin: true },
      orderBy: { code: 'asc' },
    });
  }

  /** `GET /org/permissions`：权限矩阵行（→ A6） */
  async listPermissionMatrix(): Promise<
    { perm_key: string; role_code: string; level: string }[]
  > {
    return this.prisma.permissionMatrix.findMany({
      select: { perm_key: true, role_code: true, level: true },
      orderBy: [{ perm_key: 'asc' }, { role_code: 'asc' }],
    });
  }
}

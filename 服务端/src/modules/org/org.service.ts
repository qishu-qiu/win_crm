// =============================================================================
// A 域服务（M1-08 登录 / M1-09 刷新 / M1-10 me / M1-13 只读列表）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、发事件），
//   **不写业务规则**（口径在 `domain/`）、**不写 SQL**（在 `*.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.2：`POST /account/login` req **`{account,password}`**
//     （`account` ＝ 手机号 或 登录账号名，**服务端判别**，→ 登记表 #32）、
//     resp `{access_token, refresh_token, user: UserVO}`；`GET /account/me` → `UserVO`
//     ＝ `{id,name,username?,role,dept:{id,name},managed_dept_ids:[],permissions:{}}`。
//   · 同 §4.2：`GET /org/employees` **服务端按 `managed_dept_ids` 收敛**（G7）、**销售只能看同部门**
//     → 收敛规则在 `domain/employee-visibility.ts`（纯函数）。
//   · 同 §2.2：`access_token` Bearer JWT（建议 2h）＋ `refresh_token`；§2.4：401/20002、403/20003。
//   · 《销售CRM架构设计说明》§7.1：`RequestContext` 随令牌带进请求，
//     **横切层只读上下文、不查库** —— 故登录时把「我是谁、管哪些部门、什么角色、什么范围」一次性签进令牌。
//   · 同 §7.4：登录是**敏感动作**，须在业务事务内写 `operation_log`（→ M0-30 的 `AuditService`）。
//
// ★ 2026-09-14 收口：原先记在 M1 完成报告里的「计划写 `username`、而规格写 `phone`」冲突**已消解** ——
//   数据架构 A2 已加 `employee.username`、接口 §5.2 已定为 `{account,password}` 双通道
//   （→ 登记表 #32），故本文件按**双通道**实现，`domain/login-account.ts` 负责判别。
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
  // M6-15 上收 kernel：JSON 列拉直（原先在本域 `org.repository.ts`，B 域要用时跨域引不动）
  parseStringList,
  runInTransaction,
  toClaims,
  type AuditLogInput,
  type RequestContext,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveDataScope, resolvePrimaryRole } from './domain/data-scope';
import { isEmployeeVisible, managedDeptIdsOf, visibleEmployeeDeptIds } from './domain/employee-visibility';
import { classifyLoginAccount } from './domain/login-account';
import { verifyPassword } from './domain/password';
import { mergePermissionLevels } from './domain/permission';
import type { LoginDto } from './dto/login.dto';
import type { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { OrgRepository, parseIdList } from './org.repository';

/** 员工鉴权行（结构直接取自仓储的 `select`，**不手抄字段** —— 避免两处漂移） */
type EmployeeAuthRow = NonNullable<Awaited<ReturnType<OrgRepository['findEmployeeByPhone']>>>;

/** `UserVO`（→ API §5.2；`bigint` 由统一的出参拦截器转字符串，此处保持原样） */
export interface UserVo {
  id: bigint;
  name: string;
  /** 登录账号名（可空：为空则只能手机号登录，→ §5.2）；**始终下发该键**（无值给 `null`，不给 `undefined`） */
  username: string | null;
  role: string;
  dept: { id: bigint; name: string } | null;
  managed_dept_ids: bigint[];
  /**
   * 可建业务关系的部门集合（→ §5.6 录入前部门归属校验的**同一口径**，单一真相源）。
   * **空数组 = 不限制（总经理 / 管理员可建任意部门）**；销售＝主部门 ∪ 兼部门；部门经理＝管辖部门。
   * 前端据此收敛录入页部门下拉——**不另立第二套权限**，越权兜底仍是 `POST /relations` 的 403。
   */
  activatable_dept_ids: bigint[];
  /**
   * 本人关联的产品线集合（→ 员工 A7 `product_line_ids`）。**空数组 = 不限制**；
   * 前端据此收敛录入页产品线下拉。
   */
  product_line_ids: bigint[];
  permissions: Record<string, string>;
  /**
   * 个人主题（`light` / `dark`；→ 设计规范 §八.1 / 接口 §4.14.9）。
   * **`null` = 从未设置过**（≠ 选了白天）—— 前端按「跟随默认」回落（→ migration 0009 注释）。
   */
  theme: string | null;
  /**
   * 侧栏展开的分组键（→ 需求 §13.4「折叠状态按账号持久化」）。
   * **始终下发该键**：没存过给 `[]`（前端把它当"本机也没存过"用），不给 `undefined`。
   */
  nav_open: string[];
}

/** 登录出参（→ API §5.2） */
export interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: UserVo;
}

/**
 * 刷新出参（→ API §三 `/account/refresh`；规格未给字段名，与 §2.2 的键名保持一致）。
 *
 * ★ **不带 `user`**（2026-09-14 拍板）：刷新只负责换令牌；前端要用户信息就调 `GET /account/me`
 *   —— 避免「刷新」与「我是谁」两个出口各带一份用户信息（双真相源）。
 */
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
  /**
   * 改个人偏好（主题 / 侧栏展开状态）—— 2026-09-18（D-37 / D-36⑥ / D-41）。
   * ★ 它是**增删改**（动 `employee` 行），由统一审计切面自动留痕（→ 架构 §7.4）。
   */
  preferenceUpdate: 'account.preferences.update',
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
   * 登录：**手机号 或 登录账号名** ＋ 密码 → 双令牌 ＋ `UserVO`（→ 接口 §5.2 **双通道**）。
   *
   * ★ 走哪条通道由**服务端**按格式判别（`classifyLoginAccount`），客户端**不指定** ——
   *   前端只有一个输入框（→ §5.2 /《前端页面与交互文档》登录页）。
   *   两通道**共用同一个 `password_hash`**：没有任何一条通道有「额外验证」。
   * ★ 「账号不存在」与「密码不对」**对外同一句人话、同一个错误码** ——
   *   否则这个接口就是一台**账号枚举器**（能据此判断某手机号 / 某账号名是不是本司员工）。
   *   真实原因只写进审计 `detail`，供安全排查。
   * ⚠ 对外人话**保持规格原文**「手机号或密码不正确」（§5.2 逐字），不因通道是账号名就改文案
   *   —— 改了就等于告诉探测者「这个输入走的是账号名通道」，且会与前端文案 / 规格脱钩。
   */
  async login(input: LoginDto, meta: RequestMeta = {}): Promise<LoginResult> {
    const channel = classifyLoginAccount(input.account);
    const employee =
      channel === 'phone'
        ? await this.repository.findEmployeeByPhone(input.account)
        : await this.repository.findEmployeeByUsername(input.account);
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
          account: input.account,
          channel,
          // 原因按**通道**区分（`phone_not_found` / `username_not_found`）：搜日志时才分得清
          // 「手机号打错」与「账号名打错」—— 对外的文案是一句，对内必须能分辨。
          reason: employee === null ? `${channel}_not_found` : 'bad_password',
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

  /**
   * 「**管辖部门内**的员工 id」集合（→ B 域判「经理能看管辖部门内的**待关联**线索」，D-67）。
   *
   * @returns **`null` ＝ 不限制**（`all` 档：总经理 / 管理员，调用方据此**不套过滤**）；
   *          数组 ＝ 管辖部门内的员工 id（**非经理档回空数组** ⇒ 调用方只剩"自己"那一份）。
   *
   * ★ 为什么由 A 域给：判「这个员工属不属于我管辖的部门」要读 `employee`（够不着的域不许查，
   *   架构 §5.2 路之①），且**兼部门**在 JSON 列里、必须由本域解析（`parseIdList`）—— 别处重写一遍必漏。
   * ★ 口径**故意比 `listEmployees` 窄**（→ `domain/employee-visibility.ts` 的 `managedDeptIdsOf` ★）：
   *   通讯录允许销售看**同部门**，但**线索归属**不行 —— 否则销售能看到同部门同事录入的
   *   待关联线索（含手机号），那是越权。
   * ★ 一次「查全量员工 ＋ 内存过滤」（与 `listEmployees` 同款取法）：员工表规模按公司算，
   *   **不做 `JSON_CONTAINS` 反查**（数据架构 §十七 A 明令禁止在 JSON 列做反向全表扫描）。
   *   ⚠ 非经理档**直接短路**（`allowed.length === 0`）—— 不让销售 / 交付白跑一次员工查询。
   */
  async listEmployeeIdsOfManagedDepts(): Promise<readonly bigint[] | null> {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'org.employees.no_context',
      });
    }

    // `all` 档：不过滤（返回 `null` 而不是"全量 id 列表" —— 同 C 域 `listVisibleCompanyIds` 的取法）
    if (context.dataScope.type === 'all') return null;

    const allowedDeptIds = managedDeptIdsOf(context.dataScope);
    if (allowedDeptIds.length === 0) return [];

    const employees = await this.repository.listEmployees();
    return employees
      .filter((employee) =>
        isEmployeeVisible(allowedDeptIds, [
          employee.primary_dept_id,
          ...parseIdList(employee.extra_dept_ids),
        ]),
      )
      .map((employee) => employee.id);
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

  // ===== 2026-09-18 个人偏好（D-37 / D-36⑥ / D-41） =====

  /**
   * 改个人偏好（主题 / 侧栏展开状态）→ **更新后的 `UserVO`**（→ 接口 §4.14.9 / §5.2）。
   *
   * ★ 为什么出参是**整个 `UserVO`**（而不是只回改过的那两个字段）：§4.1 明写「`UserVO` 的完整结构：
   *   **唯一权威落点见 §5.2**」—— 回一个只含偏好的新形状，就是在权威落点之外**另造一个出参契约**
   *   （本项目一号坑）。回 `UserVO` 还让前端**一次往返**把主题 / 展开状态同步进本地状态，
   *   不必自己拼「旧值 ∪ 新值」。
   *
   * ★ 为什么「一个键都没给」也照常回 200：本端点是**部分更新**（没给 = 不改）—— 空 body 是
   *   一次合法的"什么都没改"，不该报 400（报错的代价是前端每次都得先判空再决定发不发请求）。
   *   ⚠ 但此时**库里一次都不碰**（→ `updateEmployeePreferences` 短路），只在审计里留一条访问痕。
   *
   * ⚠ **只能改自己**：操作对象取自**令牌上下文**，不接受任何 `employee_id` 入参 ——
   *   一旦开了"帮别人改偏好"的口子，就是一个没有业务理由的越权写入口。
   */
  async updatePreferences(input: UpdatePreferencesDto): Promise<UserVo> {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'account.preferences.no_context',
      });
    }
    const employee = await this.requireActiveEmployee(context.employeeId);

    // ★ 两个键都没给 ⇒ **连仓储都不调**：不是为了省一次查询，而是「什么都没改」这件事
    //   不该以一次写路径调用表达（仓储那侧同样短路，那是防**别处**调用；此处是本路径的纪律）。
    const hasChange = input.theme !== undefined || input.nav_open !== undefined;
    if (hasChange) {
      await this.repository.updateEmployeePreferences(employee.id, {
        ...(input.theme === undefined ? {} : { theme: input.theme }),
        ...(input.nav_open === undefined ? {} : { nav_open: input.nav_open }),
      });
    }

    // ★ 用**刚写进去的值**装配出参，不再回查一遍：本路径没有并发写者（只有本人改自己的偏好），
    //   回查反而多开一个"可能读到别人写入"的窗口；且库里存的就是这两个值，不存在不一致。
    const updated: EmployeeAuthRow = {
      ...employee,
      theme: input.theme ?? employee.theme,
      nav_open: input.nav_open === undefined ? employee.nav_open : [...input.nav_open],
    };
    return this.toUserVo(await this.loadAuthFacts(updated));
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

  /**
   * 产品线列表（→ 接口 §5.3 / §4.2 `GET /org/product-lines`）。
   *
   * ★ 用途：录入页「激活业务关系」要选产品线（`POST /relations` req 含 `product_line_id`，
   *   → §5.6）；此前没有这个只读端点，录入页建不出关系（→《欠账登记表》D-05）。
   * ★ **不做数据范围收敛**：产品线是**全公司配置**（7 条线固定配色，→ 需求 §13.3），
   *   不是业务数据 —— 同 `listRoles` / `listPermissions` 的取法。
   * ★ `dept_ids` 出参转**十进制字符串**（→ §2.6：id 一律十进制字符串）；`color_key` 未配置
   *   原样给 `null`（**不编默认色**，→ DTO 注释）。
   */
  async listProductLines() {
    const rows = await this.repository.listProductLines();
    return rows.map((line) => ({
      id: line.id,
      name: line.name,
      code: line.code,
      color_key: line.color_key,
      dept_ids: parseIdList(line.dept_ids).map((id) => id.toString()),
      service_cycle_days: line.service_cycle_days,
      status: line.status,
    }));
  }

  /**
   * 员工列表（→ API §4.2 / §5.3；**不含密码哈希**）。
   *
   * ★ **G7 收敛**（→ 接口 §4.2）：「服务端按 `managed_dept_ids` 收敛；**销售只能看同部门**」——
   *   收敛规则以纯函数落在 `domain/employee-visibility.ts`，本层只做「取上下文 → 调规则 → 套用」。
   * ★ 为什么在 **service** 而不是仓储里收敛：范围条件是**业务口径**，且入口不止一处；
   *   写进仓储就变成「每个查询各自记一遍」（正是 §7.2 禁止的「repository 手写范围条件」）。
   * ⚠ 拿不到上下文**绝不兜底成全量**（＝越权读全公司通讯录）：正常链路上守卫已 401 在前，
   *   走到这里还没有上下文＝装配出了问题，按 401 暴露（宁可不给数据）。
   */
  async listEmployees() {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'org.employees.no_context',
      });
    }

    const allowedDeptIds = visibleEmployeeDeptIds(context.dataScope, context.deptIds);
    const employees = (await this.repository.listEmployees()).filter((employee) =>
      // 主部门 ＋ 兼部门一起参与判断：兼部门员工也是「本部门的人」，漏掉会让他在列表里凭空消失
      isEmployeeVisible(allowedDeptIds, [
        employee.primary_dept_id,
        ...parseIdList(employee.extra_dept_ids),
      ]),
    );
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
        username: employee.username,
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

  // ===== 跨域引用出口（架构 §5.2 路之①：同步调对方 exports 的 service）=====
  //
  // ★ 为什么要有这一段：C 域（`modules/relation`）的出参里有 `company:{id,name}` /
  //   `dept:{id,name}` / `product_line:{id,name}` / `owner:{id,name}` —— 但**跨域不许查对方的表**
  //   （§5.2），所以「把 id 翻成名字」这件事**必须由拥有该表的域提供**。
  //   A 域在这里只做三件最薄的事：按 id 批量取名、按 id 取部门集合；**不含任何业务判断**。
  // ⚠ 全部是**批量**接口：列表页一行一次查询会变成 N+1（几十行就是几十次往返）。

  /** 员工 `{id,name}` 引用（供 `owner` / `members.employee` 装配） */
  getEmployeeRefs(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    return this.repository.findEmployeesByIds(ids);
  }

  /** 部门 `{id,name}` 引用（供 `dept` 装配） */
  getDeptRefs(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    return this.repository.findDepartmentsByIds(ids);
  }

  /** 产品线 `{id,name,color_key}` 引用（固定配色键 → 需求 §13.3；migration 0004 补的列） */
  getProductLineRefs(
    ids: readonly bigint[],
  ): Promise<{ id: bigint; name: string; color_key: string | null }[]> {
    return this.repository.findProductLinesByIds(ids);
  }

  /**
   * 某部门**承接的产品线 id 集合**（→ 数据架构 A7 `product_line.dept_ids` 的**反查**）。
   *
   * ★ 供 C 域判「这条产品线能不能在该部门建档」（→ 架构 §7.2「可建产品线范围」/ 接口 §2.4 `20409`）：
   *   `product_line` 是 A 域的表，跨域只能问本出口，**C 域不许自己查**（架构 §5.2 路之①）。
   * ★ 判据与前端录入页下拉**逐字同集**（前端也是按 `product_line.dept_ids` 含所选部门收敛）——
   *   两边同源才不会出现「界面不给选、接口却收下」或反过来（→《欠账登记表》D-74）。
   * ★ **不按 `status` 过滤**：停用线照样算作"承接"（前端口径是「**不隐藏停用项、只标注**」，
   *   → `RelationTargetPicker.vue`）—— 这里过滤掉会让前后端不同集。
   * ★ 部门不存在 / 已删除 → 空数组（调用方按「**不承接**」处理，**不默认放行**）。
   */
  async getDeptProductLineIds(deptId: bigint): Promise<bigint[]> {
    const rows = await this.repository.listProductLines();
    return rows
      .filter((line) => parseIdList(line.dept_ids).includes(deptId))
      .map((line) => line.id);
  }

  /**
   * 某员工的**部门集合（主 ＋ 兼）** —— 供 C 域判「@求助限同部门」（→ 需求 §4.3）。
   * 员工不存在 / 已删除 → 空数组（调用方按「不是同部门」处理，**不默认放行**）。
   */
  getEmployeeDeptIds(employeeId: bigint): Promise<bigint[]> {
    return this.repository.findEmployeeDeptIds(employeeId);
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

    // ★ 可建部门 / 业务线：与 `relation` 域 `checkActivateScope` **同一口径**（单一真相源），
    //   由服务端算、随 `me` 下发，前端只据此渲染下拉——不另立第二套权限（→ D-73）。
    //   `resolveDataScope` 已在 `toRequestContext` 用，此处复用同一档位判定；`all` 档给空数组＝不限制。
    const ownedDeptIds = unique([
      facts.employee.primary_dept_id,
      ...parseIdList(facts.employee.extra_dept_ids),
    ]);
    const scopeType = resolveDataScope(facts.roleCodes);
    const activatableDeptIds =
      scopeType === 'all'
        ? []
        : scopeType === 'dept'
          ? facts.managedDeptIds
          : unique([...ownedDeptIds, ...facts.managedDeptIds]);
    const productLineIds = parseIdList(facts.employee.product_line_ids);

    return {
      id: facts.employee.id,
      name: facts.employee.name,
      username: facts.employee.username,
      role: resolvePrimaryRole(facts.roleCodes),
      dept: primaryDept === undefined ? null : { id: primaryDept.id, name: primaryDept.name },
      managed_dept_ids: facts.managedDeptIds,
      activatable_dept_ids: activatableDeptIds,
      product_line_ids: productLineIds,
      permissions: mergePermissionLevels(permissions, facts.roleCodes),
      // 偏好两列（migration 0009）：`theme` 原样给（`null` = 从未设置，前端回落默认）；
      // `nav_open` 是 JSON 列，**必须拉直**（脏值 / 非字符串元素一律丢弃，→ parseStringList）。
      theme: facts.employee.theme,
      nav_open: parseStringList(facts.employee.nav_open),
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

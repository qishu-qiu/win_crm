// =============================================================================
// A 域控制器（M1-11 登录 / M1-12 刷新 + me / M1-13 四个只读接口）
//
// 分层约束（架构 §5.4 第 1 行）：controller **只做三件事** ——
//   解析请求、调**一个** service 方法、返回。**不写业务判断、不碰 Prisma**（故本文件零 `if` 业务分支）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.15 §三 接口总览：`POST /account/login`（P）·`POST /account/refresh`（P）
//     ·`GET /account/me`（G）·`GET /org/departments|employees|roles|permissions`（G）。
//   · 同 §2.2：除登录 / 刷新外**一律带** `Authorization: Bearer <access_token>` ——
//     故本文件只给 login / refresh 打 `@Public()`（守卫自 M0-38 起全局生效，不打就被 401 挡死）。
//   · 同 §2.4：401 / 20002（未认证）、403 / 20003（无权限）、400 / 20001（参数错）由横切层统一出口，
//     **controller 不自己拼错误响应**。
//   · 《销售CRM架构设计说明》V1.3 §7.4：审计要记 IP / UA / req_id → 由本文件从请求头取，交给 service。
//
// ★ 成功状态码 **200**（2026-09-15 七叔拍板，→ API §2.3）：
//   POST 若不显式声明，NestJS 默认返回 **201 Created** —— 规格只定义了失败码、没说成功，
//   故此前保留默认值未拍板。现定：**成功一律 200**（与 §2.3「成功 / 失败」两态对称），
//   故 login / refresh 两个 POST 显式 `@HttpCode(200)`；前端仍按 `body.code === 0` 判成功。
// =============================================================================
import { Body, Controller, Get, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../kernel/index';
import { LoginDto } from './dto/login.dto';
import {
  DepartmentVoDto,
  EmployeeVoDto,
  LoginResultDto,
  PermissionVoDto,
  RefreshResultDto,
  RoleVoDto,
  UserVoDto,
} from './dto/org-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { OrgService, type LoginResult, type RefreshResult, type RequestMeta, type UserVo } from './org.service';

/** 链路 id 请求头（**与 M0-33 统一响应拦截器同一个头名**，前端 / 网关给的同一条链路可贯穿审计） */
const REQUEST_ID_HEADER = 'x-request-id';
/** 客户端标识请求头（→ §7.4 审计字段 `user_agent`） */
const USER_AGENT_HEADER = 'user-agent';

/**
 * 组装审计用的请求元信息（→ §7.4：IP / UA / req_id）。
 *
 * ★ 空值一律**不写该键**：审计入参的语义是「缺省 = 不写该列」（→ `AuditLogInput` 注释），
 *   显式塞 `undefined` 会让「没传」与「传了空」在类型层看不出区别，也容易被 `JSON.stringify` 抖掉。
 */
export function toRequestMeta(
  ip: string | undefined,
  userAgent: string | undefined,
  requestId: string | undefined,
): RequestMeta {
  const meta: RequestMeta = {};
  if (ip !== undefined && ip !== '') meta.ip = ip;
  if (userAgent !== undefined && userAgent !== '') meta.user_agent = userAgent;
  if (requestId !== undefined && requestId !== '') meta.req_id = requestId;
  return meta;
}

/**
 * A 域路由。
 * ⚠ 类级 `@Controller()` 用**空前缀**：两条业务路径前缀不同（`/account/*` 与 `/org/*`），
 *   按接口文档的分组挂各自完整路径，比硬套一个前缀再到处 `@Controller('account')` 更贴近规格。
 */
@ApiTags('认证 / 组织')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // ===== M1-11 登录 =====

  @Public()
  @Post('account/login')
  @HttpCode(200) // 成功 200（→ §2.3；不写就是 Nest 对 POST 的默认 201）
  @ApiOperation({
    summary: '登录',
    description:
      '`account`（**手机号 或 登录账号名，二选一、服务端判别**）＋ 密码 → 双令牌 ＋ 当前人信息。' +
      '失败一律 401 / 20002 且**不区分**「账号不存在」与「密码错」',
  })
  @ApiOkResponse({ type: LoginResultDto, description: '统一响应包的 `data` 即本结构' })
  login(
    @Body() body: LoginDto,
    @Ip() ip: string | undefined,
    @Headers(USER_AGENT_HEADER) userAgent: string | undefined,
    @Headers(REQUEST_ID_HEADER) requestId: string | undefined,
  ): Promise<LoginResult> {
    return this.org.login(body, toRequestMeta(ip, userAgent, requestId));
  }

  // ===== M1-12 刷新 =====

  @Public()
  @Post('account/refresh')
  @HttpCode(200) // 成功 200（→ §2.3）
  @ApiOperation({
    summary: '刷新令牌',
    description: '用 `refresh_token` 换一对新令牌；**重新装载**最新角色与管辖部门（撤销经理后立即收窄数据范围）',
  })
  @ApiOkResponse({ type: RefreshResultDto, description: '统一响应包的 `data` 即本结构' })
  refresh(@Body() body: RefreshDto): Promise<RefreshResult> {
    return this.org.refresh(body.refresh_token);
  }

  // ===== M1-10 我是谁 =====

  @Get('account/me')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '当前登录人',
    description: '返回角色 ＋ 管辖部门集合 ＋ 权限矩阵 ＋ 数据范围；`managed_dept_ids` 为空 = 非经理',
  })
  @ApiOkResponse({ type: UserVoDto, description: '统一响应包的 `data` 即 `UserVO`' })
  me(): Promise<UserVo> {
    return this.org.me();
  }

  // ===== M1-13 组织只读四接口 =====

  @Get('org/departments')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: '部门列表', description: '树形关系由 `parent_id` 自带，前端自行组树（含经理与关联产品线）' })
  @ApiOkResponse({ type: [DepartmentVoDto] })
  listDepartments(): ReturnType<OrgService['listDepartments']> {
    return this.org.listDepartments();
  }

  @Get('org/employees')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '员工列表',
    description:
      '**不含密码哈希**；含主/兼部门、关联产品线、直属经理与角色码。' +
      '**服务端按数据范围收敛**（管理员/总经理=全部；经理=管辖部门；销售=同部门，→ §4.2 G7）',
  })
  @ApiOkResponse({ type: [EmployeeVoDto] })
  listEmployees(): ReturnType<OrgService['listEmployees']> {
    return this.org.listEmployees();
  }

  @Get('org/roles')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: '角色列表', description: '内置 6 条（`is_builtin`，内置不可删）' })
  @ApiOkResponse({ type: [RoleVoDto] })
  listRoles(): ReturnType<OrgService['listRoles']> {
    return this.org.listRoles();
  }

  @Get('org/permissions')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: '权限矩阵', description: '`perm_key × role_code → level` 全量矩阵行' })
  @ApiOkResponse({ type: [PermissionVoDto] })
  listPermissions(): ReturnType<OrgService['listPermissions']> {
    return this.org.listPermissions();
  }
}

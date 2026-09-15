// =============================================================================
// A 域出参 DTO（M1-11 / M1-12 / M1-13）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.16 §5.2：
//       `POST /account/login` → `{access_token, refresh_token, user: UserVO}`
//       `GET /account/me` → `UserVO = {id, name, username?, role, dept:{id,name}, managed_dept_ids:[],
//                                      permissions:{"perm_key":"level"}}`
//   · 同 §5.3：部门 `{id,name,parent_id,service_enabled,status,manager_ids:[],product_line_ids:[]}`；
//       员工 `{id,work_no,name,phone,username?,primary_dept:{id,name},extra_depts:[],product_lines:[],
//              direct_manager:{id,name},roles:["sale"],status}`；
//       角色 `{code,name,is_builtin}`；权限矩阵行 `{perm_key,role_code,level}`。
//   · 同 §2.6：入参出参 **snake_case**。
//
// ★ 为什么 id 声明成 `String`（而 service 返回的运行时值是 `bigint`）：
//   主键是 `BigInt @db.UnsignedBigInt`，而 JS 的 JSON number 只有 53 位 —— 直接下发必丢精度
//   （→ `kernel/common/bigint.ts` 顶部注释）。**出口唯一收口**在 M0-33 统一响应拦截器
//   （它过一遍 `toJsonSafe`），故此处按**线上下发的形状**声明字符串。
//   ⚠ 这是「类型声明与运行时值故意不同」的一处，别把它当 bug 改掉：
//     `Swagger 描述的是前端收到的 JSON`，不是 Nest 内部的对象。
//
// ★ 为什么必须是 **class** 而不是 interface：interface 在运行时不留类型信息，
//   `SwaggerModule` 生不出 schema（→ `health/health.controller.ts` 的同类注释）。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';

/** `{id,name}` 引用对（部门 / 产品线 / 直属经理通用）；无值时上游给 `null` */
export class EntityRefDto {
  @ApiProperty({ type: String, description: '主键（十进制字符串，防 JSON 精度丢失）', example: '1' })
  id!: string;

  @ApiProperty({ description: '名称', example: '华东销售一部' })
  name!: string;
}

/** 当前登录人（→ §5.2 `UserVO`） */
export class UserVoDto {
  @ApiProperty({ type: String, example: '7' })
  id!: string;

  @ApiProperty({ example: '张三' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '登录账号名（**可空**：为空则只能手机号登录；→ §5.2）。服务端**始终下发该键**，无值给 `null`',
    example: 'zhangsan',
  })
  username!: string | null;

  @ApiProperty({
    description: '主角色码（一人多角色时取权限最大者；内置码见 A4）',
    example: 'sale',
  })
  role!: string;

  @ApiProperty({ type: EntityRefDto, nullable: true, description: '主部门；无部门数据时为 null' })
  dept!: EntityRefDto | null;

  @ApiProperty({
    type: [String],
    description: '管辖部门集合；**空数组 = 非经理**',
    example: ['1', '2'],
  })
  managed_dept_ids!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: '权限矩阵（perm_key → level），level ∈ visible / masked / denied',
    example: { 'customer.view': 'visible' },
  })
  permissions!: Record<string, string>;
}

/** 登录出参（→ §5.2） */
export class LoginResultDto {
  @ApiProperty({ description: '访问令牌（Bearer JWT，建议 2h）' })
  access_token!: string;

  @ApiProperty({ description: '刷新令牌' })
  refresh_token!: string;

  @ApiProperty({ type: UserVoDto, description: '当前登录人（前端据此渲染菜单 / 数据范围）' })
  user!: UserVoDto;
}

/** 刷新出参（→ §三 `/account/refresh`；规格未给字段名，与 §2.2 的键名保持一致） */
export class RefreshResultDto {
  @ApiProperty({ description: '新的访问令牌' })
  access_token!: string;

  @ApiProperty({ description: '新的刷新令牌' })
  refresh_token!: string;
}

/** 部门（→ §5.3） */
export class DepartmentVoDto {
  @ApiProperty({ type: String, example: '1' })
  id!: string;

  @ApiProperty({ example: '华东分公司' })
  name!: string;

  @ApiProperty({ type: String, description: '上级部门 id；`0` = 根（自引用不建外键）', example: '0' })
  parent_id!: string;

  @ApiProperty({ description: '客服开关', example: false })
  service_enabled!: boolean;

  @ApiProperty({ description: '状态（active / disabled）', example: 'active' })
  status!: string;

  @ApiProperty({ type: [String], description: '部门经理集合（→ A3 `dept_manager`，多对多）' })
  manager_ids!: string[];

  @ApiProperty({ type: [String], description: '关联产品线集合（由 A7 的 `dept_ids` 反向索引而来）' })
  product_line_ids!: string[];
}

/** 员工（→ §5.3；**不含密码哈希**） */
export class EmployeeVoDto {
  @ApiProperty({ type: String, example: '7' })
  id!: string;

  @ApiProperty({ description: '工号', example: 'A007' })
  work_no!: string;

  @ApiProperty({ example: '张三' })
  name!: string;

  @ApiProperty({ description: '手机号（主入口唯一键）', example: '13800000000' })
  phone!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '登录账号名（可空：为空则只能手机号登录）',
    example: 'zhangsan',
  })
  username!: string | null;

  @ApiProperty({ type: EntityRefDto, nullable: true, description: '主部门' })
  primary_dept!: EntityRefDto | null;

  @ApiProperty({ type: [EntityRefDto], description: '兼部门' })
  extra_depts!: EntityRefDto[];

  @ApiProperty({ type: [EntityRefDto], description: '关联产品线' })
  product_lines!: EntityRefDto[];

  @ApiProperty({ type: EntityRefDto, nullable: true, description: '直属经理（审批链）' })
  direct_manager!: EntityRefDto | null;

  @ApiProperty({ type: [String], description: '角色码集合（→ A5）', example: ['sale'] })
  roles!: string[];

  @ApiProperty({ description: '状态（active / resigned / disabled）', example: 'active' })
  status!: string;
}

/** 角色（→ §5.3） */
export class RoleVoDto {
  @ApiProperty({ description: '角色码（内置 6 条）', example: 'sale' })
  code!: string;

  @ApiProperty({ example: '销售' })
  name!: string;

  @ApiProperty({ description: '是否内置（内置不可删）', example: true })
  is_builtin!: boolean;
}

/** 权限矩阵行（→ §5.3） */
export class PermissionVoDto {
  @ApiProperty({ description: '权限键', example: 'customer.view' })
  perm_key!: string;

  @ApiProperty({ description: '角色码', example: 'sale' })
  role_code!: string;

  @ApiProperty({ description: '档位（visible / masked / denied）', example: 'visible' })
  level!: string;
}

// =============================================================================
// 访问令牌（JWT）声明契约（M0-32 前置）—— 签发方（M1 登录）与校验方（鉴权守卫）的唯一事实源
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.12 §2.2：登录返回 `access_token`（Bearer JWT，**建议 2h**）
//     ＋ `refresh_token`；请求头 `Authorization: Bearer <access_token>`。
//   · 《销售CRM架构设计说明》V1.1 §7.1：`RequestContext = { employeeId, deptIds, roleCodes,
//     dataScope: { type, deptIds } }`，且 ★ 「横切层只读上下文、**不查数据库**」——
//     故「我是谁」必须**随令牌带进来**，守卫里绝不许回查 org 域（否则就是「A 域调权限、
//     权限查 A 域」的循环依赖）。
//   · 同 §7.2：dataScope 三档 `self` / `dept` / `all`。
//   · 《数据架构文档》：主键一律 `BigInt @db.UnsignedBigInt` —— 令牌里的 id **一律十进制字符串**
//     （与 M0-25 同一条口径：JSON 的 number 存不下 bigint，落了 Number 就永久丢精度）。
//
// ⚠ 规格**只定义了令牌的用法与上下文的形状，没有定义 JWT 的声明名**，故声明名是本项目的技术口径：
//   一律 snake_case（与《接口API文档》§2.6「入参出参 snake_case」同源），`sub` 是 JWT 标准声明、按标准用。
//   签发与校验**都必须走本文件的 `toClaims` / `fromClaims`**，不许各自手搓键名 ——
//   否则「签发写 employeeId、校验读 sub」这类错位要等到联调才炸。
//
// 分层约束（架构 §5.4）：`kernel/**` 零业务 —— 本文件**不许 import `modules/*`**。
// =============================================================================
import { AppError, ErrorCode } from '../errors/app-error';
import { type DataScope, type DataScopeType, type RequestContext } from './request-context';

/** 访问令牌有效期（→ API §2.2「建议 2h」）：签发（M1）与守卫共用这一处，避免两处各写一个数 */
export const ACCESS_TOKEN_TTL = '2h';

/** 数据范围档位白名单（→ 架构 §7.2；`DATA_SCOPE_TYPES` 同时用于校验令牌内容） */
const DATA_SCOPE_TYPES: readonly DataScopeType[] = ['self', 'dept', 'all'];

/** 令牌里的「我能看到谁」（→ §7.1） */
export interface AccessTokenScopeClaims {
  type: DataScopeType;
  /** `type='dept'` 时＝管辖部门集合；`self` / `all` 时为空数组（**空数组与缺字段不是一回事**：后者视为非法令牌） */
  dept_ids: string[];
}

/** 访问令牌声明（签发 / 校验的唯一契约） */
export interface AccessTokenClaims {
  /** 当前登录员工 `employee.id`，**十进制字符串** */
  sub: string;
  /** 我所属 / 管辖的部门 id（十进制字符串集合） */
  dept_ids: string[];
  /** 角色码（`role.code`，如 sales / dept_manager / gm） */
  roles: string[];
  /** 我能看到谁 */
  scope: AccessTokenScopeClaims;
  /** 签发时间 / 过期时间（Unix 秒）：由 `@nestjs/jwt` 签发时写入、校验时返回，非手工维护 */
  iat?: number;
  exp?: number;
}

/** 十进制非负整数串：主键是 `UnsignedBigInt`，故不收负号、不收小数、不收科学计数法 */
const DECIMAL_ID = /^[0-9]+$/;

/**
 * 鉴权失败统一 401 / 20002（→ API §2.4）。
 * **刻意不区分**「没带 token」与「token 形状坏掉」：对外同一句人话，细节只进 `constraint` 供日志定位
 * —— 不给探测者「你的 token 有效但内容不对」这类信息。
 */
function unauthorized(reason: string): AppError {
  return new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', { constraint: reason });
}

/** 校验并归一「十进制 id 串」 */
function normalizeIdString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DECIMAL_ID.test(value)) {
    throw unauthorized(`令牌声明 ${field} 不是十进制 id 串`);
  }
  return value;
}

/** 校验 id 串数组（**必须是数组**：缺字段＝签发方与校验方口径漂了，早炸早发现） */
function normalizeIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw unauthorized(`令牌声明 ${field} 不是数组`);
  }
  return value.map((item, index) => normalizeIdString(item, `${field}[${index}]`));
}

/** 校验角色码数组（角色码是 `role.code`，非数字，故不套 id 规则；空串视为脏数据） */
function normalizeRoleArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw unauthorized(`令牌声明 ${field} 不是数组`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item === '') {
      throw unauthorized(`令牌声明 ${field}[${index}] 不是角色码`);
    }
    return item;
  });
}

/** 校验 `scope`（形状与档位白名单） */
function normalizeScope(value: unknown): AccessTokenScopeClaims {
  if (typeof value !== 'object' || value === null) {
    throw unauthorized('令牌声明 scope 缺失或不是对象');
  }
  const raw = value as { type?: unknown; dept_ids?: unknown };
  if (typeof raw.type !== 'string' || !DATA_SCOPE_TYPES.includes(raw.type as DataScopeType)) {
    throw unauthorized('令牌声明 scope.type 不是 self / dept / all');
  }
  return {
    type: raw.type as DataScopeType,
    dept_ids: normalizeIdArray(raw.dept_ids, 'scope.dept_ids'),
  };
}

/**
 * 上下文 → 令牌声明（**签发方**用，→ M1 登录）：
 * `bigint` 在这里转成十进制字符串，**唯一一处**做这个转换，杜绝签发侧漏转。
 */
export function toClaims(context: RequestContext): AccessTokenClaims {
  return {
    sub: context.employeeId.toString(),
    dept_ids: context.deptIds.map((id) => id.toString()),
    roles: [...context.roleCodes],
    scope: {
      type: context.dataScope.type,
      dept_ids: context.dataScope.deptIds.map((id) => id.toString()),
    },
  };
}

/**
 * 令牌声明 → 上下文（**校验方**用，→ M0-32 守卫）。
 *
 * ★ 形状非法 / id 非法一律 **401 / 20002**，不是 500：**令牌的问题是调用方的问题**，
 *   不是服务端异常；抛 500 会把「伪造/过期 token」记成系统故障，污染告警。
 * ⚠ 本函数**只校验形状，不校验签名与有效期** —— 那两件事由 `JwtService.verify` 负责（先 verify 再调本函数）。
 */
export function fromClaims(payload: unknown): RequestContext {
  if (typeof payload !== 'object' || payload === null) {
    throw unauthorized('令牌载荷不是对象');
  }
  const raw = payload as Record<string, unknown>;
  const scope = normalizeScope(raw.scope);
  const dataScope: DataScope = {
    type: scope.type,
    deptIds: scope.dept_ids.map((id) => BigInt(id)),
  };
  return {
    employeeId: BigInt(normalizeIdString(raw.sub, 'sub')),
    deptIds: normalizeIdArray(raw.dept_ids, 'dept_ids').map((id) => BigInt(id)),
    roleCodes: normalizeRoleArray(raw.roles, 'roles'),
    dataScope,
  };
}

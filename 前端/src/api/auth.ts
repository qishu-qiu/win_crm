import type { components } from './types'
import request from './request'

/**
 * 认证接口封装（→《销售CRM接口API文档》§5.2）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（M0-57 判据：禁止手写）。
 */
export type LoginInput = components['schemas']['LoginDto']
export type LoginResult = components['schemas']['LoginResultDto']
export type UserVo = components['schemas']['UserVoDto']

/**
 * 登录：`account` ＝ **手机号 或 登录账号名**（服务端判别），两通道共用同一密码。
 * 失败一律 401 / 20002，且**不区分**「账号不存在」与「密码错」（→ §5.2）。
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const { data } = await request.post<LoginResult>('/account/login', input)
  return data
}

/**
 * 当前登录人（`GET /account/me`）：刷新令牌**不带 user**，前端要用户信息就调这里。
 */
export async function fetchMe(): Promise<UserVo> {
  const { data } = await request.get<UserVo>('/account/me')
  return data
}

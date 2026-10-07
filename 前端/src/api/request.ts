import axios, {
  AxiosHeaders,
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { message } from 'ant-design-vue'

import type { components } from './types'

/**
 * 后端统一包格式（→《销售CRM接口API文档》§2.3 / §2.4）。
 * HTTP 200 不代表业务成功；必须检查 `body.code === 0`。
 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  request_id?: string
  data: T
}

/** 出参类型一律取自 OpenAPI 生成物（禁止手写对接，→ M0-57） */
type RefreshResult = components['schemas']['RefreshResultDto']

const ACCESS_KEY = 'crm_access_token'

/**
 * 登录 / 刷新接口路径（→ API §5.2）。
 * ⚠ M0-56 骨架里写的是 `/auth/refresh` ＋ `{refreshToken}` ＋ `{accessToken}` ——
 *   那是**照通行做法猜的**，与规格不符（规格：`/account/refresh`、入参走 **HttpOnly Cookie**、
 *   出参 `access_token`；refresh 经 Set-Cookie 轮换）。此处按规格改回，否则刷新链路第一次 401 就会失效。
 */
const LOGIN_PATH = '/account/login'
const REFRESH_PATH = '/account/refresh'

/**
 * 登录态失效事件：刷新失败时派发，由 `App.vue` 监听后退回 `/login`。
 * ★ 本层**不 import router**（请求层不依赖路由层；且刷新失败时路由未必已就绪）—— 故走事件。
 */
export const UNAUTHORIZED_EVENT = 'crm:unauthorized'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
  withCredentials: true, // 允许浏览器自动携带 / 回写 HttpOnly 刷新 Cookie（→ 审计报告 CODE-001）
  headers: { 'Content-Type': 'application/json' },
})

// ===== 请求拦截：自动附加 Bearer access_token =====
request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

let isRefreshing = false
let waitQueue: Array<{
  config: AxiosRequestConfig
  resolve: (value: AxiosResponse<unknown>) => void
  reject: (reason?: unknown) => void
}> = []

/** 是否登录 / 刷新自身（这两条失败由页面自己表达，不弹全局提示、不触发刷新） */
function isAuthPath(url: string | undefined): boolean {
  return url !== undefined && (url.includes(LOGIN_PATH) || url.includes(REFRESH_PATH))
}

/**
 * 刷新请求独立超时：裸 axios 不复用 request 的 15000ms 超时，
 * 避免后端挂死 / 网络闪断时 `doRefresh` 永远 pending ——
 * 否则 `isRefreshing` 卡死为 true、后续所有 401 请求无限堆积在 `waitQueue`（审计报告 CODE-003）。
 * 超时抛错后由下方响应拦截器的 catch 统一 `waitQueue.forEach(reject)` 释放并退回登录页。
 */
const REFRESH_TIMEOUT_MS = 5000

async function doRefresh(): Promise<string> {
  // 刷新令牌走 **HttpOnly Cookie**（后端自动随同源请求带上，JS 读不到，→ 审计报告 CODE-001），
  // 故此处不再从 localStorage 取、也不再在 body 里传 refresh_token。
  // ★ 请求体给 `undefined`（不发 body）：后端 `/account/refresh` **没有入参 DTO**
  //   （令牌在 Cookie 里），此前这里发 `{}` 并引用一个并不存在的 `RefreshDto` 类型 ——
  //   `gen:types` 重生成后那段类型消失，`vue-tsc` 直接编译不过（2026-10-07 实测）。
  // 用裸 axios：绝不能走 request 拦截器，否则刷新失败会递归触发刷新。
  const { data: body } = await axios.post<ApiResponse<RefreshResult>>(
    `${request.defaults.baseURL}${REFRESH_PATH}`,
    undefined,
    { timeout: REFRESH_TIMEOUT_MS },
  )

  if (body.code !== 0) throw new Error(body.message || '刷新失败')

  // 仅落 access_token；refresh 已由后端经 Set-Cookie 写入 HttpOnly Cookie
  setTokens(body.data.access_token)
  return body.data.access_token
}

function retryQueue(token: string): void {
  waitQueue.forEach(({ config, resolve, reject }) => {
    const headers = new AxiosHeaders(
      (config.headers as Record<string, string> | undefined) || undefined,
    )
    headers.set('Authorization', `Bearer ${token}`)
    request({ ...config, headers }).then(resolve).catch(reject)
  })
  waitQueue = []
}

// ===== 响应拦截：统一包解析 + 401 自动刷新 + 错误提示 =====
request.interceptors.response.use(
  (response: AxiosResponse<unknown>) => {
    const body = response.data as ApiResponse
    if (body.code !== 0) {
      message.error(body.message || '请求失败')
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    // 拆包：调用方直接拿 data
    response.data = body.data
    return response
  },
  async (error: AxiosError<ApiResponse>) => {
    const original = error.config
    if (!original) return Promise.reject(error)

    const url = original.url
    const text = error.response?.data?.message || error.message || '网络错误'

    // 登录 / 刷新自身失败：只有「账号或密码不对」「刷新令牌失效」两种可能，
    // 交给页面做内联错误态（§4.6「错误文案置于控件下」），不弹全局提示、不进刷新链路。
    if (isAuthPath(url)) return Promise.reject(new Error(text))

    if (error.response?.status === 401) {
      if (!isRefreshing) {
        isRefreshing = true
        try {
          const newToken = await doRefresh()
          isRefreshing = false
          retryQueue(newToken)
        } catch (refreshError) {
          isRefreshing = false
          waitQueue.forEach(({ reject }) => reject(refreshError))
          waitQueue = []
          clearTokens()
          // 回到登录页：派事件给 App（请求层不直接跳路由）
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
          return Promise.reject(refreshError instanceof Error ? refreshError : new Error(text))
        }
      }
      // 刷新进行中：挂起等新令牌（避免并发多次刷新）
      return new Promise((resolve, reject) => {
        waitQueue.push({ config: original, resolve, reject })
      })
    }

    message.error(text)
    return Promise.reject(new Error(text))
  },
)

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY)
}

export function setTokens(access: string): void {
  localStorage.setItem(ACCESS_KEY, access)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY)
}

export default request

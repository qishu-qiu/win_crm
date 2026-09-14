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
 * 后端统一包格式（→《销售CRM接口API文档》V1.13 §2.3 / §2.4）。
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
type RefreshInput = components['schemas']['RefreshDto']

const ACCESS_KEY = 'crm_access_token'
const REFRESH_KEY = 'crm_refresh_token'

/**
 * 登录 / 刷新接口路径（→ API §5.2）。
 * ⚠ M0-56 骨架里写的是 `/auth/refresh` ＋ `{refreshToken}` ＋ `{accessToken}` ——
 *   那是**照通行做法猜的**，与规格不符（规格：`/account/refresh`、入参 `refresh_token`、
 *   出参 `access_token` / `refresh_token`）。此处按规格改回，否则刷新链路第一次 401 就会失效。
 */
const LOGIN_PATH = '/account/login'
const REFRESH_PATH = '/account/refresh'

/** 登录态失效事件：刷新失败时派发，由 App 回到登录页（本骨架**不引 router**，故用事件而不是跳路由） */
export const UNAUTHORIZED_EVENT = 'crm:unauthorized'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
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

async function doRefresh(): Promise<string> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) throw new Error('缺少刷新令牌')

  // 用裸 axios：绝不能走 request 拦截器，否则刷新失败会递归触发刷新
  const payload: RefreshInput = { refresh_token: refreshToken }
  const { data: body } = await axios.post<ApiResponse<RefreshResult>>(
    `${request.defaults.baseURL}${REFRESH_PATH}`,
    payload,
  )

  if (body.code !== 0) throw new Error(body.message || '刷新失败')

  setTokens(body.data.access_token, body.data.refresh_token)
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
          // 回到登录页：本骨架无 router，用事件让 App 切视图
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

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export default request

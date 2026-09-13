import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

/**
 * 后端统一包格式（→《销售CRM接口API文档》V1.12 §2.3 / §2.4）。
 * HTTP 200 不代表业务成功；必须检查 body.code === 0。
 */
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

const ACCESS_KEY = 'crm_access_token'
const REFRESH_KEY = 'crm_refresh_token'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// ===== 请求拦截：自动附加 Bearer access_token =====
request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(ACCESS_KEY)
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

function showError(message: string): void {
  // M0-56 占位：等 ant-design-vue ConfigProvider / message 组件接入后，
  // 替换为 message.error(message)。目前先在控制台输出，避免阻塞链路。
  // eslint-disable-next-line no-console
  console.error('[API Error]', message)
}

async function doRefresh(): Promise<string> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) throw new Error('缺少刷新令牌')

  const { data: body } = await axios.post<
    ApiResponse<{ accessToken: string; refreshToken: string }>
  >(`${request.defaults.baseURL}/auth/refresh`, { refreshToken })

  if (body.code !== 0) throw new Error(body.message || '刷新失败')

  localStorage.setItem(ACCESS_KEY, body.data.accessToken)
  localStorage.setItem(REFRESH_KEY, body.data.refreshToken)
  return body.data.accessToken
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
      showError(body.message || '请求失败')
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    response.data = body.data
    return response
  },
  async (error: AxiosError<ApiResponse>) => {
    const original = error.config
    if (!original) return Promise.reject(error)

    const status = error.response?.status
    const isRefreshRequest = original.url?.includes('/auth/refresh')

    if (status === 401 && !isRefreshRequest) {
      if (!isRefreshing) {
        isRefreshing = true
        try {
          const newToken = await doRefresh()
          isRefreshing = false
          retryQueue(newToken)
        } catch (refreshErr) {
          isRefreshing = false
          waitQueue.forEach(({ reject }) => reject(refreshErr))
          waitQueue = []
          clearTokens()
          window.location.href = '/login'
          return Promise.reject(refreshErr)
        }
      }
      return new Promise((resolve, reject) => {
        waitQueue.push({ config: original, resolve, reject })
      })
    }

    const msg = error.response?.data?.message || error.message || '网络错误'
    showError(msg)
    return Promise.reject(error)
  },
)

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export default request

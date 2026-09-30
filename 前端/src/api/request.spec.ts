import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 刷新令牌链路单测（→ 审计报告 CODE-003 / CODE-001）。
 *
 * 重点锁住两件极易回归、又最该有测试保护的事：
 *   ① 两个并发 401 只触发**一次** refresh，且 `waitQueue` 全部被重试 resolve；
 *   ② 后端挂死（refresh 超时）时 `waitQueue` 被**释放**、`isRefreshing` 复位、退回登录页，
 *      绝不会让整页永久 loading。
 *   ③ refresh 请求**不再带 `refresh_token`**（已改 HttpOnly Cookie，→ CODE-001）。
 *
 * 用 `vi.hoisted` 把 axios 的假实例提到 mock 工厂外，便于在用例里断言调用次数与入参。
 */
const hoisted = vi.hoisted(() => {
  const refreshPost = vi.fn()
  const instanceCalls = vi.fn()
  let responseErrorHandler: ((error: unknown) => unknown) | null = null

  // request 实例既是可被调用（`request(config)` 用于重试）又是带 interceptors/defaults 的对象
  const instance = function (config: unknown) {
    return instanceCalls(config)
  } as unknown as Record<string, unknown> & ((c: unknown) => unknown)
  ;(instance as Record<string, unknown>).defaults = { baseURL: '/api' }
  ;(instance as Record<string, unknown>).interceptors = {
    request: { use: vi.fn() },
    response: {
      use: (_onSuccess: unknown, onError: (error: unknown) => unknown) => {
        responseErrorHandler = onError
      },
    },
  }
  ;(instance as Record<string, unknown>).post = vi.fn()

  const AxiosHeaders = class {
    set(): this {
      return this
    }
  }

  return {
    refreshPost,
    instanceCalls,
    getResponseErrorHandler: () => responseErrorHandler,
    instance,
    AxiosHeaders,
  }
})

vi.mock('axios', () => ({
  default: {
    create: () => hoisted.instance,
    post: hoisted.refreshPost,
  },
  AxiosHeaders: hoisted.AxiosHeaders,
}))

// 动态导入，便于每个用例 `vi.resetModules()` 后拿到干净的模块级状态（isRefreshing / waitQueue）
let api: typeof import('./request')

function make401(config: { url: string }): unknown {
  return {
    config,
    response: { status: 401, data: { message: '未认证' } },
    message: '未认证',
    isAxiosError: true,
  }
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  hoisted.refreshPost.mockReset()
  hoisted.instanceCalls.mockReset()
  api = await import('./request')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('刷新令牌链路', () => {
  it('两个并发 401 只触发一次 refresh，且 waitQueue 全部被重试 resolve', async () => {
    hoisted.refreshPost.mockResolvedValue({
      data: { code: 0, data: { access_token: 'new-access' } },
    })

    const handler = hoisted.getResponseErrorHandler()!
    const p1 = handler(make401({ url: '/relations' })) as Promise<unknown>
    const p2 = handler(make401({ url: '/relations' })) as Promise<unknown>

    await expect(p1).resolves.toBeUndefined()
    await expect(p2).resolves.toBeUndefined()

    // 只刷新一次；两个被挂起的请求都通过重试路径重发
    expect(hoisted.refreshPost).toHaveBeenCalledTimes(1)
    expect(hoisted.instanceCalls).toHaveBeenCalledTimes(2)
    // 新 access_token 已落 localStorage
    expect(api.getAccessToken()).toBe('new-access')
  })

  it('refresh 请求体为空、不再携带 refresh_token（→ CODE-001 HttpOnly Cookie）', async () => {
    hoisted.refreshPost.mockResolvedValue({
      data: { code: 0, data: { access_token: 'new-access' } },
    })

    const handler = hoisted.getResponseErrorHandler()!
    await handler(make401({ url: '/relations' }))

    expect(hoisted.refreshPost).toHaveBeenCalledWith(
      '/api/account/refresh',
      {},
      expect.objectContaining({ timeout: 5000 }),
    )
  })

  it('后端挂死（refresh 超时）时 waitQueue 被释放、退回登录页，不永久 loading（→ CODE-003）', async () => {
    const timeoutError = new Error('timeout')
    ;(timeoutError as { code?: string }).code = 'ECONNABORTED'
    hoisted.refreshPost.mockRejectedValue(timeoutError)

    const unauthorizedEvents: string[] = []
    window.addEventListener(api.UNAUTHORIZED_EVENT, () => unauthorizedEvents.push(api.UNAUTHORIZED_EVENT))

    const handler = hoisted.getResponseErrorHandler()!
    const p1 = handler(make401({ url: '/relations' })) as Promise<unknown>
    const p2 = handler(make401({ url: '/relations' })) as Promise<unknown>

    // 两条都因刷新失败而 reject（不再永久 pending）
    await expect(p1).rejects.toBeDefined()
    await expect(p2).rejects.toBeDefined()

    expect(hoisted.refreshPost).toHaveBeenCalledTimes(1)
    // 派发了未授权事件（App 据此退回登录页）
    expect(unauthorizedEvents).toContain(api.UNAUTHORIZED_EVENT)
    // 前端 token 已清（不再残留可被续期的会话）
    expect(api.getAccessToken()).toBeNull()
  })
})

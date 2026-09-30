import { ref } from 'vue'

import { fetchMe, updatePreferences, type PreferencesInput, type UserVo } from './api/auth'
import { clearTokens, getAccessToken } from './api/request'
import { logout } from './api/auth'
import { applyAccountTheme } from './theme'

/**
 * 登录态（M6-05）—— **全应用唯一一份「我是谁」**。
 *
 * ★ 为什么不引 pinia：本项目只此一个跨页状态（当前登录人），引一整个状态库属**新增依赖**
 *   （要单独的执行令，→ `前端/README.md`）。等真的出现第二、第三个跨页状态再引不迟 ——
 *   那时改动也只在本文件与调用方。
 *
 * ★ 为什么 `restoreSession()` 要**调 `GET /account/me`** 而不是「有 token 就当已登录」：
 *   token 可能已过期 / 被撤销 / 账号被停用 —— 直接进空壳会出现「看着已登录、一操作全是 401」
 *   （→ 原 `App.vue` 同款判断，此处只是把逻辑从组件里搬出来，行为不变）。
 */
export const currentUser = ref<UserVo | null>(null)

/** 启动自检是否跑完（跑完前不渲染任何页面，避免「先闪一下登录页又跳走」） */
export const sessionReady = ref(false)

/**
 * 启动 / 刷新页面时恢复登录态。
 * @returns 是否**确实已登录**（`false` ＝ 调用方该把用户送回登录页）
 */
export async function restoreSession(): Promise<boolean> {
  if (getAccessToken() === null) {
    sessionReady.value = true
    return false
  }
  try {
    currentUser.value = await fetchMe()
    applyAccountTheme(currentUser.value.theme)
    return true
  } catch {
    // me 失败（含刷新链路失败）→ 清干净：不带着坏 token 往下走
    clearTokens()
    currentUser.value = null
    return false
  } finally {
    sessionReady.value = true
  }
}

/** 登录成功后写入（token 由调用方 `setTokens` 落 localStorage） */
export function signIn(user: UserVo): void {
  currentUser.value = user
  sessionReady.value = true
  applyAccountTheme(user.theme)
}

/**
 * 把偏好推给服务端（`PUT /account/preferences`）—— **全应用唯一的偏好发送口**。
 *
 * ★ 为什么返回值直接写进 `currentUser`：该端点的出参就是**更新后的整个 `UserVO`**
 *   （→ 接口 §4.14.9），交给调用方各自拼"旧值 ∪ 新值"就是在权威形状之外再养一份状态。
 * ★ 失败**不吞**：调用方（页 28 / 外壳）按自己的场景决定要不要提示用户；
 *   这里不做 toast —— 那是展示层的事，写在会话层会让它也依赖 AntD。
 */
export async function pushPreferences(input: PreferencesInput): Promise<void> {
  currentUser.value = await updatePreferences(input)
}

/**
 * 退出 / 会话失效：清后端 HttpOnly 刷新 Cookie + 前端 access_token，再清当前人。
 * ★ 退出**必须**清刷新 Cookie：否则只清 access 会被 refresh 续上，会话删不掉（→ 审计报告 CODE-001）。
 * 清 Cookie 失败不阻塞前端登出（本地 access 仍清掉）。
 */
export async function signOut(): Promise<void> {
  try {
    await logout()
  } catch {
    // 后端清 Cookie 失败（如 access 已过期）不阻塞前端登出
  }
  clearTokens()
  currentUser.value = null
  sessionReady.value = true
}

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { fetchMe, type UserVo } from './api/auth'
import { UNAUTHORIZED_EVENT, clearTokens, getAccessToken } from './api/request'
import LoginView from './views/LoginView.vue'
import WorkbenchView from './views/WorkbenchView.vue'

/**
 * 应用外壳（M1-18 · 方案 A 最小页）：登录页 ⇄ 首屏空壳。
 *
 * ★ 为什么**不引 router**：M0-54 ~ M0-57 落的前端骨架只有 vue ＋ ant-design-vue ＋ axios；
 *   引 vue-router 属**新增依赖**（要单独的执行令），而 M1-18 的判据只要「浏览器里能登录」。
 *   故这里用「有无登录人」这一条状态切两个视图 —— 等真正多页（§五 的 29 个路由）时
 *   再按拍板引 router，届时本文件是唯一要改的地方。
 *
 * ★ 启动时为什么先调 `GET /account/me` 而不是「有 token 就当已登录」：
 *   token 可能已过期 / 被撤销 / 账号被停用 —— 直接进空壳会出现「看着已登录、一操作全是 401」。
 *   用一次 me 把真实状态问清楚，失败就干净地回登录页。
 */
const user = ref<UserVo | null>(null)
const booting = ref(true)

async function restoreSession(): Promise<void> {
  if (!getAccessToken()) {
    booting.value = false
    return
  }
  try {
    user.value = await fetchMe()
  } catch {
    // me 失败（含刷新链路失败）→ 清干净回登录页：不带着坏 token 往下走
    clearTokens()
    user.value = null
  } finally {
    booting.value = false
  }
}

function onLoggedIn(next: UserVo): void {
  user.value = next
}

function onLogout(): void {
  clearTokens()
  user.value = null
}

onMounted(() => {
  window.addEventListener(UNAUTHORIZED_EVENT, onLogout)
  void restoreSession()
})

onUnmounted(() => {
  window.removeEventListener(UNAUTHORIZED_EVENT, onLogout)
})
</script>

<template>
  <div v-if="booting" class="app-booting">正在进入…</div>
  <LoginView v-else-if="user === null" @logged-in="onLoggedIn" />
  <WorkbenchView v-else :user="user" @logout="onLogout" />
</template>

<style scoped>
.app-booting {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--crm-color-text-tertiary);
  background: var(--crm-color-bg-layout);
}
</style>

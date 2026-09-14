<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { fetchMe, type UserVo } from './api/auth'
import { UNAUTHORIZED_EVENT, clearTokens, getAccessToken } from './api/request'
import { homeNameOf, roleNameOf } from './home'
import EntryView from './views/EntryView.vue'
import LoginView from './views/LoginView.vue'
import WorkbenchView from './views/WorkbenchView.vue'

/**
 * 应用外壳（M1-18 登录页 ＋ M2-17 建档页）：顶栏（身份 / 导航 / 退出）＋ 视图切换。
 *
 * ★ 为什么**不引 router**：M0-54 ~ M0-57 落的前端骨架只有 vue ＋ ant-design-vue ＋ axios；
 *   引 vue-router 属**新增依赖**（要单独的执行令）。故这里用「登录人 ＋ 一条 view 状态」切换视图
 *   —— 等真正多页（§五 的 29 个路由）时再按拍板引 router，届时本文件是唯一要改的地方。
 *
 * ★ 启动时为什么先调 `GET /account/me` 而不是「有 token 就当已登录」：
 *   token 可能已过期 / 被撤销 / 账号被停用 —— 直接进空壳会出现「看着已登录、一操作全是 401」。
 *   用一次 me 把真实状态问清楚，失败就干净地回登录页。
 *
 * ★ 顶栏放在**外壳**而不是各页面里：页面只管自己的正文，身份 / 导航只写一处
 *   （写两处必然出现「一个页面的导航比另一个少一项」）。
 */
type ViewKey = 'workbench' | 'entry'

const user = ref<UserVo | null>(null)
const booting = ref(true)
const view = ref<ViewKey>('workbench')

/** 导航项：首屏名取自规格（§4.1 角色表「主入口」列），不写「首页 / 主页」这类自造名 */
const navItems = computed<Array<{ key: ViewKey; label: string }>>(() => [
  { key: 'workbench', label: homeNameOf(user.value?.role ?? '') },
  { key: 'entry', label: '建档' },
])

const roleName = computed(() => roleNameOf(user.value?.role ?? ''))
const deptName = computed(() => user.value?.dept?.name ?? '未分配部门')

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
  view.value = 'workbench'
}

function onLogout(): void {
  clearTokens()
  user.value = null
  view.value = 'workbench'
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

  <div v-else class="shell">
    <header class="shell-header">
      <div class="shell-identity">
        <span class="shell-name">{{ user.name }}</span>
        <span class="shell-meta">{{ roleName }}</span>
        <span class="shell-meta">{{ deptName }}</span>
      </div>

      <nav class="shell-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': view === item.key }"
          :aria-current="view === item.key ? 'page' : undefined"
          @click="view = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <a-button type="text" @click="onLogout">退出登录</a-button>
    </header>

    <main class="shell-body">
      <WorkbenchView v-if="view === 'workbench'" :user="user" />
      <EntryView v-else />
    </main>
  </div>
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

.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--crm-color-bg-layout);
}

.shell-header {
  display: flex;
  align-items: center;
  gap: var(--crm-space-lg);
  height: 56px;
  padding: 0 var(--crm-space-lg);
  background: var(--crm-color-bg-container);
  border-bottom: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.shell-identity {
  display: flex;
  align-items: center;
  gap: var(--crm-space-sm);
}

.shell-name {
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

/** 角色 / 部门用中性小标（§4.4「状态统一用圆点+文字」；此处是身份标，不占语义色） */
.shell-meta {
  padding: 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-xs);
  line-height: 20px;
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-fill-alter);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
}

.shell-nav {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  margin-right: auto;
}

.shell-nav-item {
  padding: 0 var(--crm-space-sm);
  height: 32px;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--crm-radius-sm);
  cursor: pointer;
}

.shell-nav-item:hover {
  color: var(--crm-color-text);
  background: var(--crm-color-fill-alter);
}

/** 当前页：主色文字 ＋ 浅底（不靠加粗 / 下划线堆层级） */
.shell-nav-item.is-active {
  color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

.shell-body {
  flex: 1;
  padding: var(--crm-space-xl) var(--crm-space-lg);
}
</style>

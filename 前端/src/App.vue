<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

import { UNAUTHORIZED_EVENT } from './api/request'
import { homeNameOf, roleNameOf } from './home'
import { currentUser, restoreSession, sessionReady, signOut } from './session'

/**
 * 应用外壳（M1-18 登录页 ＋ M2-17 建档页 ＋ **M6-05 路由收口**）——
 * 顶栏（身份 / 导航 / 退出）＋ `<router-view>` 页面出口。
 *
 * ★ **M6-05 起引入 `vue-router`**（新增依赖，2026-09-16 七叔执行令）：
 *   原先用「一条 `view` 状态 ＋ `v-if`」手切三个视图 —— 那是骨架期的临时做法
 *   （当时引 router 属新增依赖、要单独拿令，所以刻意没引）。现在页面到 4 个
 *   （后续还有 25 页）＋ 要按角色**不下发路由**（§四.2），手切撑不住了。
 *
 * ★ 三处分工（**别混**）：
 *   · **进不进得来** ＝ 路由守卫（`router/index.ts`，读 token、同步、零网络）；
 *   · **这个会话还算不算数** ＝ `session.restoreSession()`（`GET /account/me`），失败即送回 `/login`；
 *   · **401 会话失效** ＝ `api/request.ts` 派发 `UNAUTHORIZED_EVENT`，本文件监听后退回登录页
 *     （★ `api/` **不 import router** —— 那会让「请求层」依赖「路由层」，刷新失败时还可能
 *       路由尚未就绪）。
 *
 * ★ 顶栏放在**外壳**而不是各页面里：页面只管自己的正文，身份 / 导航只写一处
 *   （写两处必然出现「一个页面的导航比另一个少一项」）。
 */
const router = useRouter()

/** 导航项：首屏名取自规格（§4.1 角色表「主入口」列），不写「首页 / 主页」这类自造名 */
const navItems = computed<Array<{ to: string; label: string }>>(() => [
  { to: '/', label: homeNameOf(currentUser.value?.role ?? '') },
  { to: '/entry', label: '建档' },
  { to: '/relations', label: '业务关系' },
  { to: '/contacts', label: '联系人' },
])

const roleName = computed(() => roleNameOf(currentUser.value?.role ?? ''))
const deptName = computed(() => currentUser.value?.dept?.name ?? '未分配部门')

function onLogout(): void {
  signOut()
  void router.replace('/login')
}

async function bootstrap(): Promise<void> {
  const authenticated = await restoreSession()
  if (!authenticated) await router.replace('/login')
}

onMounted(() => {
  window.addEventListener(UNAUTHORIZED_EVENT, onLogout)
  void bootstrap()
})

onUnmounted(() => {
  window.removeEventListener(UNAUTHORIZED_EVENT, onLogout)
})
</script>

<template>
  <div v-if="!sessionReady" class="app-booting">正在进入…</div>

  <!-- 未登录：只可能是登录页（守卫保证），全屏、无顶栏 -->
  <router-view v-else-if="currentUser === null" />

  <!-- 已登录：顶栏 ＋ 页面出口 -->
  <div v-else class="shell">
    <header class="shell-header">
      <div class="shell-identity">
        <span class="shell-name">{{ currentUser.name }}</span>
        <span class="shell-meta">{{ roleName }}</span>
        <span class="shell-meta">{{ deptName }}</span>
      </div>

      <nav class="shell-nav">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="shell-nav-item"
          active-class="is-active"
          exact-active-class="is-active"
        >
          {{ item.label }}
        </router-link>
      </nav>

      <a-button type="text" @click="onLogout">退出登录</a-button>
    </header>

    <main class="shell-body">
      <router-view />
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

/** 导航项是 `<router-link>`（渲染成 `<a>`）—— 底色 / 下划线一律重置，样式口径与按钮一致 */
.shell-nav-item {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--crm-space-sm);
  height: 32px;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
  text-decoration: none;
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

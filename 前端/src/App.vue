<script setup lang="ts">
import { message, type MenuProps } from 'ant-design-vue'
import { computed, h, onMounted, onUnmounted, ref, watch, type VNode } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  firstVisiblePathOf,
  isPageVisible,
  navGroupsOf,
  navItemsOf,
  type NavGroup,
  type PageKey,
} from './access'
import { UNAUTHORIZED_EVENT } from './api/request'
import { roleNameOf } from './home'
import { currentUser, restoreSession, sessionReady, signOut } from './session'
import { antdThemeConfig } from './theme'

/**
 * 应用外壳（M1-18 登录页 ＋ M2-17 建档页 ＋ **M6-05 路由收口** ＋ **M6-11 主题**
 * ＋ **2026-09-18 顶栏横排 → 侧边栏**）。
 *
 * 结构＝**左侧导航栏** ＋ 右侧（顶栏 ＋ `<router-view>` 页面出口）。
 *
 * ★ 为什么改侧边栏（2026-09-18 七叔执行令）：《销售CRM业务需求文档》§13.4「全局框架规范」
 *   与《销售CRM前端页面与交互文档》§四.1 要的形态就是**侧边栏 ＋ 可折叠子菜单 ＋ 子项数量徽标**；
 *   此前顶栏横排是骨架期的简化版（→ 欠账 D-36）。★ **越晚换越贵**：等二三十页铺开再换，
 *   要重新走查每一页对"顶部 56px ＋ 正文内边距"的布局假设；现在换只动本文件。
 *
 * ★ **页面文件一个都不用改**：§13.4 把分工定死了 —— 页面只管自己的正文，身份 / 导航只写一处
 *   （写两处必然出现「一个页面的导航比另一个少一项」）。
 *
 * ★ 三处分工（**别混**）：
 *   · **进不进得来** ＝ 路由守卫（`router/index.ts`，读 token、同步、零网络）；
 *   · **这个会话还算不算数** ＝ `session.restoreSession()`（`GET /account/me`），失败即送回 `/login`；
 *   · **401 会话失效** ＝ `api/request.ts` 派发 `UNAUTHORIZED_EVENT`，本文件监听后退回登录页
 *     （★ `api/` **不 import router** —— 那会让「请求层」依赖「路由层」，刷新失败时还可能
 *       路由尚未就绪）。
 *
 * ★ 「哪些项出现」仍是 `access.ts` 那张矩阵说了算（M6-10）：本文件**只渲染**它下发的分组，
 *   **不在这里写任何角色判断**（写了就是第二套真相源）。
 */
const route = useRoute()
const router = useRouter()

/**
 * 侧栏展开状态的本机持久化键。
 * ⚠ 规格 §13.4 写的是「折叠状态**按账号**持久化」—— 那要存服务端（接口 §4.14.9
 *   `PUT /account/preferences`），而该端点**服务端尚未实现**、数据架构里也没有落点
 *   ⇒ 本轮只能先存**本机**（与 M6-11 主题同一处根因，→《欠账登记表》D-37）。
 *   **别在前端自造账号侧存储。**
 */
const NAV_OPEN_STORAGE_KEY = 'crm_nav_open'

/** 读本机存下的展开分组；脏值 / 读不到一律回落空数组（**不让脏数据把侧栏卡死**） */
function readStoredOpenKeys(): string[] {
  try {
    const raw = localStorage.getItem(NAV_OPEN_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

const role = computed(() => currentUser.value?.role ?? '')

/** 侧栏分组（已按角色过滤；纯分组子项全不可见则整组不出现） */
const navGroups = computed<NavGroup[]>(() => navGroupsOf(role.value))

/** 展开的分组（受控 —— 交给 AntD 自己管，刷新后会随机展开） */
const openKeys = ref<string[]>(readStoredOpenKeys())

/** 当前页所在分组的键（当前页不属任何分组时＝`undefined`，如 `/me/appearance`） */
const currentGroupKey = computed<string | undefined>(() => {
  const page = route.meta.page as PageKey | undefined
  if (page === undefined) return undefined
  return navGroups.value.find((group) => group.children.some((leaf) => leaf.page === page))?.key
})

/**
 * 「**默认仅展开当前分组**」（→ 需求 §13.4）：进页 / 换页时，把当前页所在分组补进展开集合。
 * ⚠ 只在**当前分组变了**时补，**不覆盖**用户手动收起别的分组的意图；
 *   本机存了"全收起"也会被这条补回当前组 —— 因为"当前页在收起的分组里看不见"是更糟的事。
 */
watch(
  currentGroupKey,
  (key) => {
    if (key !== undefined && !openKeys.value.includes(key)) {
      openKeys.value = [...openKeys.value, key]
    }
  },
  { immediate: true },
)

watch(openKeys, (keys) => {
  try {
    localStorage.setItem(NAV_OPEN_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // 存不了（隐私模式 / 被禁）→ 本次会话内照样生效，只是刷新后回默认
  }
})

/** 当前选中项：按路由 `meta.page` 反查（关系详情 `/relations/:id` 也算「业务关系」选中） */
const selectedKeys = computed<string[]>(() => {
  const page = route.meta.page as PageKey | undefined
  if (page === undefined) return []
  const leaf = navItemsOf(role.value).find((item) => item.page === page)
  return leaf === undefined ? [] : [leaf.path]
})

/**
 * 分组标题：**收起时**在组名后带一个「子项数量」小标（→ 需求 §13.4 末句）。
 *
 * ★ 不用 AntD `Badge`：它默认**红底**，而设计规范 §三.1 B5「**红只给逾期 / 风险**」——
 *   这里只是一个"下面还有几项"的中性提示，故自绘小标（底 / 字 / 圆角 / 字号全取 token，
 *   不引入任何新视觉语言）。
 */
function renderGroupLabel(group: NavGroup): VNode | string {
  if (openKeys.value.includes(group.key)) return group.label
  return h('span', { class: 'shell-group' }, [
    h('span', group.label),
    h('span', { class: 'shell-group-count' }, String(group.children.length)),
  ])
}

/** 菜单项（AntD `Menu` 的数据形态；叶子项 `key` 就是路由路径） */
const menuItems = computed<MenuProps['items']>(() =>
  navGroups.value.map((group) =>
    group.children.length === 0
      ? { key: group.path ?? group.key, label: group.label }
      : {
          key: group.key,
          label: renderGroupLabel(group),
          children: group.children.map((leaf) => ({ key: leaf.path, label: leaf.label })),
        },
  ),
)

/** 点叶子 → 跳转；点分组只展开 / 收起（由 AntD 处理，故这里按"是不是路径"分流） */
function onMenuClick(info: { key: string | number }): void {
  const path = String(info.key)
  if (path.startsWith('/')) void router.push(path)
}

function onOpenChange(keys: string[]): void {
  openKeys.value = keys
}

/**
 * 「外观」入口的可见性（**M6-11**）：同样问 `access.ts` 那张矩阵，不在这里手写角色判断。
 * 现状＝5 类角色全可见（§4.2「登录 / 消息中心 / 个人中心」一行）；写成计算属性是为了
 * **将来改矩阵时不必回来改壳**（壳里散一个角色判断＝第二套真相源）。
 * ⚠ §4.1 把「个人中心 / 外观设置」挂在**顶部头像菜单**，头像菜单本身（含消息铃铛）属后续收口
 *   （→ 欠账 D-36）；本轮先在顶栏放一个**直达**项 —— 落点页是真的，不是假入口。
 */
const canSeeAppearance = computed(() => isPageVisible(currentUser.value?.role ?? '', 'appearance'))

const roleName = computed(() => roleNameOf(currentUser.value?.role ?? ''))
const deptName = computed(() => currentUser.value?.dept?.name ?? '未分配部门')

function onLogout(): void {
  signOut()
  void router.replace('/login')
}

async function bootstrap(): Promise<void> {
  const authenticated = await restoreSession()
  if (!authenticated) {
    await router.replace('/login')
    return
  }
  // ★ `await router.isReady()` **不能省**：挂载瞬间 `router.currentRoute.value` 还是
  //   初始占位（`START_LOCATION`，`meta.page` 为空），此时校正会**整个落空** ——
  //   2026-09-18 浏览器走查实测到过：交付账号手输 `/entry`（完整加载）会**停在录入页**。
  //   页内跳转不走这条路（那时守卫已经能判角色了）。
  await router.isReady()
  await ensureVisibleRoute()
}

/**
 * 首屏（刷新 / 深链 / 登录后）落点校正（**M6-10**）。
 *
 * 守卫是**同步、零网络**的（管"能不能进来"），判角色要等 `GET /account/me` ——
 * 首屏时守卫跑在 `me` 之前，判不了角色，故在这里补一次；之后守卫就能判了。
 * ⚠ **只有这一处补**，别在页面里各判一次（那是第二套规则，迟早分叉）。
 */
async function ensureVisibleRoute(): Promise<void> {
  const user = currentUser.value
  if (user === null) return
  const page = router.currentRoute.value.meta.page as PageKey | undefined
  if (page !== undefined && !isPageVisible(user.role, page)) {
    message.warning('该页面当前账号无权访问')
    await router.replace(firstVisiblePathOf(user.role))
  }
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
  <!--
    AntD 也要跟着换主题（**M6-11**）：`--crm-*` 变量只管本项目自己的样式，
    AntD 组件（**含本页的菜单** / 表格 / 抽屉 / 按钮 / 弹层…）的观感由它自己的
    algorithm ＋ token 决定。`antdThemeConfig` 把 tokens.css 的当前值搬给它 ——
    数值仍只有一个落点。
  -->
  <a-config-provider :theme="antdThemeConfig">
    <div v-if="!sessionReady" class="app-booting">正在进入…</div>

    <!-- 未登录：只可能是登录页（守卫保证），全屏、无外壳 -->
    <router-view v-else-if="currentUser === null" />

    <!-- 已登录：左侧导航 ＋ 右侧（顶栏 ＋ 页面出口） -->
    <div v-else class="shell">
      <aside class="shell-sidebar">
        <!--
          用 AntD `Menu`（**基础件，不自己写**，→ 架构 §4.4）：展开 / 收起、选中态、
          键盘与无障碍都由它自带（→ 前端文档 §9.5）。宽度 / 项高一律 AntD 官方默认值
          （→ 设计规范 §一.2「数值不凭感觉」）。
        -->
        <a-menu
          class="shell-nav"
          mode="inline"
          :items="menuItems"
          :selected-keys="selectedKeys"
          :open-keys="openKeys"
          @click="onMenuClick"
          @open-change="onOpenChange"
        />
      </aside>

      <div class="shell-main">
        <header class="shell-header">
          <div class="shell-identity">
            <span class="shell-name">{{ currentUser.name }}</span>
            <span class="shell-meta">{{ roleName }}</span>
            <span class="shell-meta">{{ deptName }}</span>
          </div>

          <router-link
            v-if="canSeeAppearance"
            to="/me/appearance"
            class="shell-appearance"
            active-class="is-active"
          >
            外观
          </router-link>

          <a-button type="text" @click="onLogout">退出登录</a-button>
        </header>

        <main class="shell-body">
          <router-view />
        </main>
      </div>
    </div>
  </a-config-provider>
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

/* 外壳＝左右两栏：左导航（定宽）＋ 右内容（自适应） */
.shell {
  min-height: 100vh;
  display: flex;
  background: var(--crm-color-bg-layout);
}

/**
 * 侧边栏：宽度取 AntD `Sider` 官方默认值 200px（→ 设计规范 §一.2）；
 * `sticky` ＋ 自身滚动 —— 页面很长时导航不跟着滚走。
 */
.shell-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  flex: none;
  width: 200px;
  background: var(--crm-color-bg-container);
  border-right: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

/* AntD Menu 自带一条右边框，会和侧栏自己的边框叠成两道 —— 去掉它那条 */
.shell-nav {
  border-inline-end: none;
}

/** 分组收起时的「子项数量」小标（中性色，**不用红色** —— B5 红只给逾期 / 风险） */
.shell-group {
  display: inline-flex;
  align-items: center;
}

.shell-group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 var(--crm-space-xxs);
  margin-left: var(--crm-space-xs);
  font-size: var(--crm-font-size-xs);
  line-height: 1;
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-fill-alter);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-pill);
}

/* 右栏：顶栏 ＋ 正文（`min-width: 0` 防宽表格把 flex 子项撑破） */
.shell-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
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

/** 「外观」是**账号级**入口（不属一级菜单）：推到右侧、与「退出登录」成一组 */
.shell-appearance {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  padding: 0 var(--crm-space-sm);
  height: var(--crm-control-height);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
  text-decoration: none;
  border-radius: var(--crm-radius-sm);
}

.shell-appearance:hover {
  color: var(--crm-color-text);
  background: var(--crm-color-fill-alter);
}

/** 当前页：主色文字 ＋ 浅底（不靠加粗 / 下划线堆层级） */
.shell-appearance.is-active {
  color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

.shell-body {
  flex: 1;
  padding: var(--crm-space-xl) var(--crm-space-lg);
}
</style>

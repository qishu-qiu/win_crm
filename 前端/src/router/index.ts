import { message } from 'ant-design-vue'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { firstVisiblePathOf, isPageVisible, type PageKey } from '../access'
import { getAccessToken } from '../api/request'
import { currentUser } from '../session'

/**
 * 路由表（M6-05「路由收口」＋ **M6-10 角色矩阵落地**）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM前端页面与交互文档》§五 页面清单（29 页）与 §四.2 角色矩阵
 *     （菜单与按钮可见性由 `role ＋ permission_matrix` 决定，**不可见的页面不下发路由**）；
 *   · 《销售CRM架构设计说明》§4.4 前端目录与组件约定：页面放 `views/`、**跨页复用件放
 *     `components/`**、取数放 `api/`、展示口径放 `src/*.ts`（**依赖单向**：组件不许直接连 `api`）。
 *     ⚠ 本行原写「§四 目录树」—— 架构说明 §四 当时**只有服务端**，属**错引**（→ 欠账 D-18）；§4.4 补齐后改正。
 *
 * ★ **只收已建成的页面**（登录 / 工作台 / 建档 / 业务关系列表 / 关系详情 / **联系人档案** /
 *   **外观设置**）—— 页面清单里其余页面属后续里程碑，**不在这里先注册空路由**
 *   （注册了就是"点了报错"的假入口）。（M6-05 立的规矩，M6-08 / M6-09 / M6-11 加页面时沿用。）
 *
 * ★ 组件用**动态 import**（懒加载）：首屏不必等全部页面，`bundle` 也随之分包
 *   （交接说明「bundle 1.53 MB」的欠账随之缓解一部分）。
 *
 * ★ 未登录拦截放在**守卫**（读 token，同步、零网络）：token 失效的**真判定**由
 *   `session.ts` 的 `restoreSession()`（`GET /account/me`）做，失败后 App 会把用户送回 `/login`。
 *   **两处分工别混**：守卫管"能不能进来"，`me` 管"这个会话还算不算数"。
 *
 * ★ **M6-10 越权拦截（2026-09-18）**：路由各自声明 `meta.page`，守卫拿 `access.ts` 的
 *   **同一张矩阵**判「这个角色看不看得到这一页」——不可见即送回其**首个可见页**。
 *   ⚠ 唯一空窗：**首屏刷新 / 深链**时守卫跑在 `GET /account/me` 之前（守卫同步、零网络，
 *   这是刻意的），此时 `currentUser` 还是 null、判不了角色 —— 由 `App.vue` 的 `bootstrap()`
 *   在拿到「我是谁」之后补一次落点校正（**只有这一处补，别在页面里各判一次**）。
 */

/** 页面键 → 路由（`meta.page` 是路由与《前端文档》§4.2 矩阵的唯一挂钩点） */
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'workbench',
    component: () => import('../views/WorkbenchView.vue'),
    meta: { page: 'workbench' },
  },
  {
    path: '/entry',
    name: 'entry',
    component: () => import('../views/EntryView.vue'),
    meta: { page: 'entry' },
  },
  {
    path: '/relations',
    name: 'relations',
    component: () => import('../views/RelationListView.vue'),
    meta: { page: 'relations' },
  },
  {
    path: '/relations/:id',
    name: 'relation-detail',
    component: () => import('../views/RelationDetailView.vue'),
    meta: { page: 'relationDetail' },
  },
  {
    path: '/contacts',
    name: 'contacts',
    component: () => import('../views/ContactListView.vue'),
    meta: { page: 'contacts' },
  },
  {
    // 外观设置（§五 页 28）：**主题（白天 / 夜间）的切换落点**（M6-11）；
    // §4.1 的入口是「顶部头像菜单」——头像菜单本身属后续收口（→ 欠账 D-36），
    // 本轮先在顶栏放一个直达项（见 `App.vue`），**不摆"点了没用"的入口**。
    path: '/me/appearance',
    name: 'appearance',
    component: () => import('../views/AppearanceView.vue'),
    meta: { page: 'appearance' },
  },
  // 未知路径 → 回工作台（**不留在白屏**；登录与否由守卫先处理，角色可见性由守卫兜底）
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach((to) => {
  const authenticated = getAccessToken() !== null

  if (!authenticated && to.meta.public !== true) {
    // 记下原本要去的页：登录后一步回到原处（带不必要的信息就不带 —— `/` 是默认落点）
    return { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }

  // 已登录还去登录页 → 回自己的首个可见页（角色还未知时先回 `/`，由 App 校正）
  if (authenticated && to.meta.public === true) {
    const role = currentUser.value?.role
    return { path: role === undefined ? '/' : firstVisiblePathOf(role) }
  }

  // ★ M6-10：访问「对本角色不可见」的页面 → 送回首个可见页，并说明一句
  //   （前端能表达"越权被拒"的唯一位置；**真正的拒绝**仍由后端 403 / 20003 兜底）
  const role = currentUser.value?.role
  const page = to.meta.page as PageKey | undefined
  if (role !== undefined && page !== undefined && !isPageVisible(role, page)) {
    message.warning('该页面当前账号无权访问')
    return { path: firstVisiblePathOf(role) }
  }

  return true
})

export default router

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { getAccessToken } from '../api/request'

/**
 * 路由表（M6-05 —— 「路由收口」）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM前端页面与交互文档》§五 页面清单（29 页）与 §四.2 角色矩阵
 *     （菜单/按钮可见性由 `role ＋ permission_matrix` 决定，**不可见的页面不下发路由**）；
 *   · 《销售CRM架构设计说明》§4.4 前端目录与组件约定：页面放 `views/`、**跨页复用件放
 *     `components/`**、取数放 `api/`、展示口径放 `src/*.ts`（**依赖单向**：组件不许直接连 `api`）。
 *     ⚠ 本行原写「§四 目录树」—— 架构说明 §四 当时**只有服务端**，属**错引**（→ 欠账 D-18）；§4.4 补齐后改正。
 *
 * ★ **只收已建成的页面**（登录 / 工作台 / 建档 / 业务关系列表 / **关系详情**）——
 *   页面清单里其余页面属后续里程碑，**不在这里先注册空路由**（注册了就是"点了报错"的假入口）。
 *   （M6-05 立的规矩，M6-08 加详情页时沿用。）
 *
 * ★ 组件用**动态 import**（懒加载）：首屏不必等全部页面，`bundle` 也随之分包
 *   （交接说明「bundle 1.53 MB」的欠账随之缓解一部分）。
 *
 * ★ 未登录拦截放在**守卫**（读 token，同步、零网络）：token 失效的**真判定**由
 *   `session.ts` 的 `restoreSession()`（`GET /account/me`）做，失败后 App 会把用户送回 `/login`。
 *   **两处分工别混**：守卫管"能不能进来"，`me` 管"这个会话还算不算数"。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  { path: '/', name: 'workbench', component: () => import('../views/WorkbenchView.vue') },
  { path: '/entry', name: 'entry', component: () => import('../views/EntryView.vue') },
  { path: '/relations', name: 'relations', component: () => import('../views/RelationListView.vue') },
  {
    path: '/relations/:id',
    name: 'relation-detail',
    component: () => import('../views/RelationDetailView.vue'),
  },
  // 未知路径 → 回工作台（**不留在白屏**；登录与否由守卫先处理）
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

  // 已登录还去登录页 → 回工作台（否则登录后刷新会停在登录页）
  if (authenticated && to.meta.public === true) {
    return { path: '/' }
  }

  return true
})

export default router

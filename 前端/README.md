# 前端（销售 CRM）

Vue 3 + TypeScript + Vite ＋ Ant Design Vue ＋ **Vue Router**（→《销售CRM架构设计说明》V1.5 §四）。

## 命令

```bash
npm run dev      # 开发（默认 5173；/api 代理到后端 3000，见 vite.config.ts）
npm run build    # 类型检查（vue-tsc）＋ 打包
npm run preview  # 预览打包产物
```

## 约定（别绕开）

- **接口类型不手写**：`src/api/types.ts` 由后端 OpenAPI 生成 —— 在 `服务端/` 内起服（默认 3000）后跑
  `npm run gen:types`。手写对接＝双真相源（本项目一号坑）。
- **视觉数值走 token**：`src/styles/tokens.css`（＝《销售CRM设计规范》V1.0 §二）；组件一律用 Ant Design，
  禁自定义视觉语言（设计规范 §3.2）。
- **主题（白天 / 夜间）**：唯一落点是 `src/theme.ts`（`setTheme`）＋ `styles/tokens.css` 的
  `[data-theme='dark']` 块 ＋ `index.html` 的内联预置脚本（**Vue 起来前先定主题＝无闪烁**）。
  `theme.ts` 还会把 tokens.css 的当前值**原样喂给 AntD 的 ConfigProvider**（不新增色值）——
  改了 token 就别再在组件里另设颜色，否则夜间会出现两套色。
- **后端统一包**：`HTTP 200` 不等于成功，判 `body.code === 0`；统一在 `src/api/request.ts` 收口
  （401 自动刷新；登录/刷新自身的失败不做全局提示，由页面做内联错误态）。

## 现有页面与路由

| 路由 | 页面 | 文件 | 状态 |
| --- | --- | --- | --- |
| `/login` | 登录 | `src/views/LoginView.vue` | M1-18 ＋ M6-05 打磨（一个输入框＝手机号或登录账号名 ＋ 密码） |
| `/` | 工作台（今日动线） | `src/views/WorkbenchView.vue` | **M6-06 补全**（今日概览 3 数 ＋ 今日安排 ＋ 同类合并；动作条只放「写跟进」） |
| `/entry` | 建档 | `src/views/EntryView.vue` | M2-17 最小版 |
| `/relations` | 业务关系列表 | `src/views/RelationListView.vue` | M3-14 最小版（**M6-07 补全**） |
| `/relations/:id` | 业务关系详情 | `src/views/RelationDetailView.vue` | M6-08（详情 ＋ 成员；8 Tab 数据未就绪 → 欠账 D-22） |
| `/contacts` | 联系人档案 | `src/views/ContactListView.vue` | M6-09 片 2（列表 ＋ 未关联筛选；详情随 M9 → 欠账 D-03） |
| `/me/appearance` | 外观设置 | `src/views/AppearanceView.vue` | **M6-11**（白天 / 夜间主题切换；个人资料 / 改密 / 通知偏好未建 → 欠账 D-37） |

- **路由**：`src/router/index.ts`（**M6-05 引入 `vue-router`**，2026-09-16 拍板）。**未登录拦截在守卫**
  （读 token、同步、零网络）；**会话是否还有效**由 `src/session.ts` 的 `restoreSession()`
  （`GET /account/me`）判定，失败即回 `/login`。两处分工别混。
- **登录态**：`src/session.ts` ＝ **唯一一份「我是谁」**。⚠ **仍未引入 pinia**：只此一个跨页状态，
  引整个状态库不值当；真出现第二、第三个跨页状态再引（届时只改本文件与调用方）。
- 页面清单共 **29 页**（前端文档 §五），其余属后续里程碑 —— **不先注册空路由**（注册了就是"点了报错"的假入口）。

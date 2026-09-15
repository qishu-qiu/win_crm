# 前端（销售 CRM）

Vue 3 + TypeScript + Vite ＋ Ant Design Vue（→《销售CRM架构设计说明》V1.4 §四）。

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
- **后端统一包**：`HTTP 200` 不等于成功，判 `body.code === 0`；统一在 `src/api/request.ts` 收口
  （401 自动刷新；登录/刷新自身的失败不做全局提示，由页面做内联错误态）。

## 现有页面

| 页面 | 文件 | 状态 |
| --- | --- | --- |
| 登录 `/login` | `src/views/LoginView.vue` | M1-18 ✅（一个输入框＝手机号或账号名 ＋ 密码） |
| 首屏空壳 | `src/views/WorkbenchView.vue` | M1-18 ✅（按角色显示规格里的首屏名，不填假数据） |

> ⚠ 尚未引入 vue-router / pinia：M1-18 是方案 A 最小页，视图切换在 `src/App.vue` 用一条登录态完成
> （引依赖需单独拍板）。§五 的 29 个路由开始时再引入。

// =============================================================================
// 前端 ESLint 配置（2026-09-16 立 · 七叔拍板「装 ESLint」）
//
// **目的只有一个**：把《销售CRM架构设计说明》**§4.4 前端目录与组件约定**里的
//   「**依赖单向**」从"靠人守"变成**机械卡点**。
//   依据：大厂（字节）与本项目服务端的共同结论 —— **靠工具，不靠自觉**
//   （服务端同款做法：`服务端/eslint.config.mjs` 用 `no-restricted-imports` 硬卡七域）。
//
// ★ 本版**只启用目录方向卡点**，**不铺开** recommended 全家桶：
//   一次引入全套规则会当场冒出成百条历史告警，把「提交前必跑」变成噪音，反而没人看 ——
//   先让**这一条**真的守住（§4.4 只要求这一条），其余规则后续按需**渐进**开启
//   （与服务端当年「先卡边界、后补规则」的节奏一致）。
//
// ⚠ 依赖只用**已装**的三个：`eslint` / `typescript-eslint` / `eslint-plugin-vue`
//   （`vue-eslint-parser` 随 plugin 带入）。**别引 `@eslint/js`** 之类没装的包。
// =============================================================================
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

/** 目录卡点提示语统一带 §号，看到报错就知道该翻哪一节 */
const msg = (text) => `[架构说明 §4.4 前端目录与组件约定] ${text}`;

export default tseslint.config(
  // 产物与依赖不 lint；`src/api/types.ts` 是 `gen:types` 生成物（手改无意义，也别让格式告警刷屏）
  { ignores: ['dist/**', 'node_modules/**', 'src/api/types.ts'] },

  // 让 eslint 能解析 `.vue`（其 `<script setup>` 内是 TS）与 `.ts`
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    },
  },

  // ★ 约定 1：**跨页复用件不许反向依赖**
  {
    files: ['src/components/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/views/*', '../views/*', './views/*', '@/views/*'],
              message: msg('组件**不许** import 页面（views）—— 依赖必须是单向的：页面 → 组件。'),
            },
            {
              group: ['**/api/*', '../api/*', './api/*', '@/api/*'],
              message: msg(
                '组件**不许**直接 import `api/` —— 数据由**页面喂进来**；' +
                  '组件自己连接口＝每个页面各配一次取数逻辑（又一份真相源）。',
              ),
            },
          ],
        },
      ],
    },
  },

  // ★ 约定 1（另一半）：**页面之间不许互相 import** —— 要共用就搬进 `components/`
  {
    files: ['src/views/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../views/*', './views/*', '**/views/*', '@/views/*'],
              message: msg(
                '页面之间**不许**互相 import —— 重复出现的东西按「**第二次出现就搬进 `components/`**」处理。',
              ),
            },
          ],
        },
      ],
    },
  },
);

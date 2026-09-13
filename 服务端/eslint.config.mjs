// =============================================================================
// ESLint 扁平配置（flat config）—— M0-39 基础版
//
// ★ 只启 typescript-eslint 推荐集：本机已装的 linter 依赖只有
//   `eslint@10.10.0` ＋ `typescript-eslint@8.70.0`（peer 兼容已实测）；
//   **不 import `@eslint/js` / `globals` / `eslint-plugin-prettier`** —— 这三个都没装，
//   引了就是「未声明依赖」（现在能跑只因 node_modules 扁平化，换个安装方式就炸）。
//
// ★ 模块边界硬卡（架构说明 §5.4 的 `no-restricted-imports` 那五条）＝ M0-40 ~ M0-44，
//   按计划**分批加**；本文件先只做基础。每加一条规则都必须做 T1-3 负向自检
//   （故意写一次越界 import → lint 必须报错 → 立即回滚），负向不报错就等于没卡。
// =============================================================================
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 不参与 lint：构建产物 / 依赖 / Prisma 生成物 / 覆盖率产物
    // （src/generated 已被根 .gitignore 忽略 —— 它是 `prisma generate` 的产物，随 schema 可再生）
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      // NestJS 全程 CJS（tsconfig `module: commonjs`），显式声明避免把 require / module.exports 误判
      sourceType: 'commonjs',
    },
  },
);

import { defineConfig, env } from 'prisma/config';

// =============================================================================
// Prisma 配置（CLI 中枢）：schema 位置 / migrations 目录 / 数据源连接串
// 参考：https://www.prisma.io/docs/orm/reference/prisma-config-reference （v7）
//
// ⚠ 本文件存在的原因 = v7 的两处破坏性变更（2026-09-13 实测确证）：
//   1. schema 里的 `datasource { url = env("DATABASE_URL") }` 已被移除 —— 保留会直接报
//      P1012「The datasource property `url` is no longer supported in schema files」。
//      连接串改由本文件 datasource.url 承载（供 migrate status / deploy / resolve / diff 用）。
//      注意：这与「运行时」是两回事 —— NestJS 里的 PrismaClient 需要传 driver adapter
//      （MySQL → @prisma/adapter-mariadb，见 prisma/README.md）。
//   2. .env 不再自动加载（v6 会自动读并打印 Environment variables loaded from .env）——
//      故本文件顶部显式加载。
//
// .env 加载方式：Node 内置 process.loadEnvFile（Node ≥ 20.12；本项目钉 Node 24），
//   不引入 dotenv 依赖。⚠ 该 API 按「当前工作目录」找 .env，
//   故 prisma 命令一律在 `服务端/` 目录内执行（与 CODEBUDDY.md / prisma/README.md 口径一致）。
// =============================================================================

try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（如 CI 只用真实环境变量）→ 交给下方 env() 报缺失，避免静默空串连库
}

export default defineConfig({
  // 路径按「本文件所在目录」解析（与从哪个目录执行 CLI 无关）
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // env() 在变量缺失时抛 PrismaConfigEnvError（比空串安全）——
    // 即：缺 DATABASE_URL 时 prisma 命令直接报错，不会静默连到空串
    url: env('DATABASE_URL'),
  },
});

// =============================================================================
// Web 进程入口（M0-08 最小版 ＋ M0-38 接入横切装配）
// 只做三件事：加载 .env → 建应用 → 监听端口。
//
// · 根模块暂为占位空模块 BootstrapModule —— **M0-49 换成 app.module.ts**（组装 kernel + shared + prisma）。
// · ★ M0-38：横切四件套（守卫 / 拦截器 / 过滤器 / 管道）由 `SharedModule` 用 `APP_*` 令牌全局注册，
//   main.ts 只需 import 该模块 —— **不在这里 useGlobalGuards/...**，理由见 shared.module.ts 顶部注释
//   （走 DI 才能注入 JwtService / ContextService；且四件套的生效顺序要一处可见）。
// · `.env` 加载口径与 Prisma 侧一致，见 `服务端/prisma.config.ts`（process.loadEnvFile，不引 dotenv）；
//   入口文件负责把 .env 灌进 process.env，运行时的 DATABASE_URL / REDIS_URL / JWT_SECRET 都从这里来。
//   ⚠ 顺序要紧：loadEnvFile **必须先于** NestFactory.create —— SharedModule 的 JwtModule 工厂
//   在 DI 初始化期读 JWT_SECRET，早于此刻会读到 undefined 而拒绝启动。
// · Worker 入口见 `worker.ts`：结构同源，但**不监听端口**，且**刻意不 import SharedModule**
//   （Worker 没有 HTTP 请求可鉴权/包装；它要「有人」时由各任务显式造系统上下文）。
// =============================================================================
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { SharedModule } from './shared/shared.module';

try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（如 CI 只注入真实环境变量）→ 交给下面的默认值兜底
}

// 占位根模块：M0-49 建立 app.module.ts 后删除（届时由 app.module 继续 import SharedModule）
@Module({ imports: [SharedModule] })
class BootstrapModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(BootstrapModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

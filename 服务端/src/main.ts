// =============================================================================
// Web 进程入口（M0-08 最小版）
// 只做三件事：加载 .env → 建应用 → 监听端口。
//
// · 根模块暂为占位空模块 BootstrapModule —— **M0-49 换成 app.module.ts**（组装 kernel + shared + prisma）。
// · `.env` 加载口径与 Prisma 侧一致，见 `服务端/prisma.config.ts`（process.loadEnvFile，不引 dotenv）；
//   入口文件负责把 .env 灌进 process.env，运行时的 DATABASE_URL / REDIS_URL / JWT_SECRET 都从这里来。
// · Worker 入口见 `worker.ts`：结构同源，但**不监听端口**（架构设计说明 §六）。
// =============================================================================
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（如 CI 只注入真实环境变量）→ 交给下面的默认值兜底
}

// 占位根模块：M0-49 建立 app.module.ts 后删除
@Module({})
class BootstrapModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(BootstrapModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

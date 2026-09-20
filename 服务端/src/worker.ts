// =============================================================================
// Worker 进程入口（M0-09 最小版 → **M7-01 换成 worker.module.ts**）
// 与 main.ts 同源（先 loadEnvFile、再建应用），差别只有两点：
//   ① 用 `createApplicationContext` —— **不监听任何端口**（没有 HTTP）；
//   ② 根模块是 `WorkerModule`（装 prisma ＋ jobs），**不 import Web 的 `AppModule`**
//      —— 否则定时任务会被 Web 多开的实例各跑一遍（架构 §六：Worker 恒 1 实例）。
//
// ★ 事件循环由 `jobs/` 的定时器持有（→ `job-scheduler.service.ts` 的 ★注释）：
//   M0 那句占位 `setInterval(() => undefined, 2 ** 31 - 1)` 随本片**已删除**。
// · `.env` 加载口径见 `服务端/prisma.config.ts`；Worker 同样需要 DATABASE_URL
//   （PrismaService 在 DI 初始化期读它 —— 故 loadEnvFile 必须先于 NestFactory.create）。
// =============================================================================
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（如 CI 只注入真实环境变量）→ 保持空环境即可
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);

  // 让 onModuleDestroy 真正被调用：JobScheduler 清定时器、PrismaService 断连接池。
  // ⚠ 缺了它，Ctrl+C / SIGTERM 会直接掐断，定时器与连接池都不会优雅收尾。
  app.enableShutdownHooks();

  new Logger('Worker').log('Worker 已启动（不监听端口；定时任务由 jobs/ 持有事件循环）');
}

void bootstrap();

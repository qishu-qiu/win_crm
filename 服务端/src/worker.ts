// =============================================================================
// Worker 进程入口（M0-09 最小版）
// 与 main.ts 同源，但用 createApplicationContext —— **不监听任何端口**。
//
// ★ 纪律（架构设计说明 §六）：Worker 全局只允许 1 个实例，否则定时任务重复执行。
// · 根模块暂为占位空模块 BootstrapModule —— **M7-01 换成 worker.module.ts**（jobs 只被 Worker 加载）。
// · `.env` 加载口径见 `服务端/prisma.config.ts`；Worker 同样需要 DATABASE_URL / REDIS_URL。
// =============================================================================
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（如 CI 只注入真实环境变量）→ 保持空环境即可
}

// 占位根模块：M7-01 建立 worker.module.ts 后删除
@Module({})
class BootstrapModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(BootstrapModule);
  app.enableShutdownHooks();

  const logger = new Logger('Worker');
  logger.log('Worker 已启动（不监听端口，等待定时任务接入 —— M7-01）');

  // 最小常驻手段：此刻还没有任何定时任务持有事件循环，不加这句进程会立刻退出。
  // M7-01 接入 jobs/ 后由定时任务持有句柄，届时删除本行。
  setInterval(() => undefined, 2 ** 31 - 1);
}

void bootstrap();

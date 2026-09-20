// =============================================================================
// Worker 根模块（M7-01）—— **只装 Worker 自己要跑的活儿**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§四 目录树：`worker.module.ts` ＝ 「Worker 组装：只挂需要的域」；
//     §六 进程模型：Worker 装 `kernel ＋ jobs ＋ 用到的域（engine / sea / org / trade）`，
//     启动方式 `NestFactory.createApplicationContext(WorkerModule)`、**不监听端口**、**恒 1 实例**。
//   · 《过程产出/开发计划-V1.md》M7-01 判据逐字：「Worker 单独跑起来，无端口占用」。
//
// ★ 与 `app.module.ts` 的关系：**两个根模块，各装各的**，不许互相 import。
//   Web 挂全部 7 域（处理请求）；Worker 只挂"要跑的任务依赖的那几个域"。
//
// ⚠ **刻意不 import 的东西**（每一条都有理由，不是忘了）：
//   · `SharedModule`（守卫 / 拦截器 / 过滤器 / 管道）—— 那些是**给 HTTP 请求**用的，
//     Worker 没有请求可鉴权、可包装（→ `main.ts` 头注同款口径）；
//   · `ContextModule`（请求上下文）—— Worker 里没有"当前登录人"，任务用的是系统身份；
//   · 全部业务域 —— 本片只有心跳任务（探活），**用不到域**。将来哪个任务要读业务数据，
//     再**按需**把那个域加进 `imports`（架构 §六 列举的 engine / sea / org / trade 是"可能用到"，不是"现在就装"）。
//
// ★ `PrismaModule` 是 `@Global`，但这里**仍然显式列一次**：与 `app.module.ts` 同款理由 ——
//   `@Global` 只解决 DI 解析，装配知识要**在本文件一眼可见**（"这个进程装了 Prisma"不该靠翻别处）。
// =============================================================================
import { Module } from '@nestjs/common';

import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, JobsModule],
})
export class WorkerModule {}

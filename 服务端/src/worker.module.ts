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
//   · `ContextModule`（请求上下文）—— Worker 里没有"当前登录人"，任务用的是系统身份。
//
// ★ **kernel 里必须装的那两件：`EventBusModule` ＋ `AuditModule`**（M7-03 **真机实测**补上）：
//   架构 §六 的 Worker 组成是「**kernel** ＋ jobs ＋ 用到的域」—— 这两个都是 kernel 的
//   `@Global()` **装配点**，且**装配发生在根模块**（两个 `.module.ts` 头注都这么写；Web 那边在
//   `app.module.ts`）⇒ Worker 的根模块就是本文件，必须在这儿装。
//   ⚠ 漏了**起不来**，两道错都是真机跑出来的（三绿当时全绿）：
//     ① `Nest can't resolve dependencies of the SeaService (SeaRepository, RelationService, ?)`
//        —— F 域 `SeaService` 要发 `RelationClaimed`（C 域 `RelationService` 也要发 `RelationCreated`）；
//     ② `Nest can't resolve dependencies of the OrgService (…, ?, PrismaService)`
//        —— A / B / C 域的写路径都注入 `AuditService` 留痕。
//   ⇒ **三绿 ≠ 能跑**：只有真起一次进程才看得见（→《AI执行清单》#15）。
//
// ★ **按需装的业务域**（架构 §六：「Worker 装 kernel ＋ jobs ＋ **用到的域**」）：
//   · `SeaModule`（F）—— **M7-03 掉海预警**要读 `sea_rule` ＋ 通过 C 域出口读有主关系。
//     ⚠ 这里**显式列一次**（虽然 `JobsModule` 也 import 了它）：与 `PrismaModule` 同款理由 ——
//     "这个进程装了哪些域"应当在本文件一眼可见，而不是顺着任务反查依赖链。
//   · 将来哪条任务要读别的域，同样按需加行（架构 §六 列的 engine / org / trade 是"可能用到"，
//     不是"现在就装"）。
//
// ★ `PrismaModule` 是 `@Global`，但这里**仍然显式列一次**：与 `app.module.ts` 同款理由 ——
//   `@Global` 只解决 DI 解析，装配知识要**在本文件一眼可见**（"这个进程装了 Prisma"不该靠翻别处）。
// =============================================================================
import { Module } from '@nestjs/common';

import { JobsModule } from './jobs/jobs.module';
import { AuditModule, EventBusModule } from './kernel/index';
import { SeaModule } from './modules/sea/sea.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [EventBusModule, AuditModule, PrismaModule, SeaModule, JobsModule],
})
export class WorkerModule {}

// =============================================================================
// Web 根模块（M0-49）—— 一处看清「这个进程装了哪些东西」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M0-49：`app.module.ts`（**组装 kernel ＋ shared ＋ prisma**）；
//     判据逐字＝「`start:web` 起且 `/docs` 有」。
//   · 《销售CRM架构设计说明》V1.1 §四 目录树：`app.module.ts` ＝ Web 组装全部域的那一层。
//     ⚠ 七域（`modules/*`）自 M1 起逐个进来；M0 这里只有「地基三块 ＋ 健康检查」。
//
// ★ 三个 import 各自的角色（顺序＝依赖方向，别写反）：
//   ① `ContextModule` —— kernel 的请求上下文（`@Global`）：当前人 / 角色 / 管辖部门 / 数据范围，横切层与业务域都读它；
//   ② `PrismaModule`  —— 数据库访问（`@Global`）：**只有数据访问层该注入它**（`domain/**` 与业务域禁碰，ESLint 硬卡）；
//   ③ `SharedModule`  —— 横切四件套：靠 `APP_GUARD / APP_INTERCEPTOR / APP_FILTER / APP_PIPE` **全局生效**。
//      ⚠ 业务域**不许 import 它**（M0-44c 硬卡），所以「挂上去」这件事只能在根模块发生 —— 本行即唯一入口。
//
// · `ContextModule` 内部已被 `SharedModule` import（为让横切层自给自足）。此处**再显式列一次**：
//   Nest 按**模块类**去重，不会产生第二个实例，但能让「本进程装了 kernel」在根模块**一眼可见**
//   —— 符合「装配知识一处可见」的口径（同 shared.module.ts 用 APP_* 令牌而非 useGlobalXxx 的理由）。
//
// · Worker 的根模块是**另一个**（`worker.module.ts`，M7-01）：jobs 只被 Worker 加载，
//   别把定时任务挂到这里 —— 否则 Web 多开几份就会重复执行（架构说明 §六）。
// =============================================================================
import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { ContextModule } from './kernel/index';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [ContextModule, PrismaModule, SharedModule],
  controllers: [HealthController],
})
export class AppModule {}

// =============================================================================
// jobs 模块（M7-02）—— **"这个进程到底跑了哪些定时任务"的唯一落点**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§四 目录树：`src/jobs/` ＝ 定时任务，**只被 Worker 加载**；
//     §六：Worker 装 `kernel ＋ jobs ＋ 用到的域`。
//   · 《过程产出/开发计划-V1.md》M7-02：「`jobs/` 约定 + `job_run_log` 写入（每次跑留痕）」。
//
// ★ 新增一个任务 ＝ **两处**：写一个 `*.job.ts` ＋ 在下面 `providers` / `useFactory` 各加一行。
//   特意不做"扫目录自动注册"：装配知识要**一处可见**（同 `app.module.ts` 的既有口径）——
//   自动扫描会让"这个进程跑了什么"藏进约定里，读代码看不出来。
//
// ★ **任务清单 ＝《数据架构》§十二 的清单，多一个都不留**：`heartbeat`（M7-02 的探活探针）
//   于 **2026-09-20 按拍板 P-09 删除** —— 它**不在** §十二 清单里，当初唯一的理由
//   （证明「jobs 约定 ＋ `job_run_log` 留痕」这条链路通）已被**掉海预警每小时那一行**取代
//   （→《欠账登记表》D-55；M7-02 的判据「跑一次后表中有记录」现由掉海预警自证）。
//
// ⚠ **不许把本模块挂进 `app.module.ts`**（Web 进程）：Web 可扩到 N 个实例，
//   定时任务会在每个实例上各跑一遍（架构 §六：Worker 恒 1 实例）。这条**已上 ESLint 硬卡**
//   （→ `eslint.config.mjs` 的 `appModuleBlock`），不是靠自觉。
// =============================================================================
import { Module } from '@nestjs/common';

import { SeaModule } from '../modules/sea/sea.module';
import { JobRunner } from './job-runner.service';
import { JobScheduler } from './job-scheduler.service';
import { SeaWarningJob } from './sea-warning.job';
import { SCHEDULED_JOBS } from './job.types';

@Module({
  // 掉海预警（M7-03）要读业务数据 ⇒ 按需装上 **F 域**（架构 §六：Worker 装"用到的域"）。
  // ★ F 域自己会带进它依赖的 C / B / A 域（Nest 的模块依赖，不是本层操心的事）
  imports: [SeaModule],
  providers: [
    JobRunner,
    JobScheduler,
    SeaWarningJob,
    {
      // ★ 任务清单**只在这里列一次**：调度器按数组注入，新增任务不必改它的构造函数
      provide: SCHEDULED_JOBS,
      useFactory: (seaWarning: SeaWarningJob) => [seaWarning],
      inject: [SeaWarningJob],
    },
  ],
  // 本片没有别的模块要调 jobs；导出 runner 供后续（如"手动触发一次"的运维口）复用
  exports: [JobRunner],
})
export class JobsModule {}

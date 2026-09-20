// =============================================================================
// 任务调度器（M7-02）—— 按固定间隔触发已注册的任务
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§六：Worker **永远只跑 1 个实例** ⇒ 调度天然单点，
//     **不需要分布式锁**（多开会重复跑，这才是"恒 1 实例"这条硬约束在防的事）。
//   · 《销售CRM数据架构文档》§十二 定时任务清单：频次写的是「每小时 / 每日 05:00」——
//     ⚠ **本层只支持"固定间隔"**（`intervalMs`）。「每日 05:00」这种**定点**语气要等
//     M7-03 落第一个真任务时再确认口径（届时是否引 cron 解析**要单独拍板**，→《欠账登记表》）；
//     现在先把跑不起来的"06:00:00 整点"假装支持，等于给后面对一个假契约。
//
// ★ 为什么用 `setInterval` 而不是引 `@nestjs/schedule`：本项目纪律「引依赖要单独拍板」，
//   而本阶段只需要"按间隔跑"这一件事（Node 自带即够，且少一层生命周期要维护）。
// ★ 定时器**不 `unref()`**：Worker 进程没有 HTTP、没有别的常驻句柄，
//   正是靠这些定时器持有事件循环才"起得来且不退出"（原 `worker.ts` 里那句占位
//   `setInterval(() => undefined, …)` 就是干这个的，本层落地后**已删除**）。
//   ⚠ 反过来：若一个任务都没注册，`createApplicationContext` 会**直接退出** ——
//     这是如实表现（没有活要干），故 `onModuleInit` 里显式告警。
// =============================================================================
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { JobRunner } from './job-runner.service';
import { SCHEDULED_JOBS, type ScheduledJob } from './job.types';

@Injectable()
export class JobScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobScheduler.name);

  /** 每个任务一个定时器句柄（`onModuleDestroy` 逐个清掉，别留悬挂定时器） */
  private readonly timers: NodeJS.Timeout[] = [];

  /** 正在跑的任务名 —— 防**重叠执行**（见 `trigger` 的 ★） */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly runner: JobRunner,
    @Inject(SCHEDULED_JOBS) private readonly jobs: ScheduledJob[],
  ) {}

  onModuleInit(): void {
    if (this.jobs.length === 0) {
      this.logger.warn(
        '没有注册任何定时任务：Worker 进程将因为没有常驻句柄而退出（检查 jobs.module.ts 的 providers）',
      );
      return;
    }

    for (const job of this.jobs) {
      this.timers.push(
        setInterval(() => {
          void this.trigger(job);
        }, job.intervalMs),
      );

      this.logger.log(
        `已注册任务 ${job.name}：间隔 ${formatInterval(job.intervalMs)}` +
          (job.runOnStart === true ? ' ＋ 启动即跑一次' : ''),
      );

      if (job.runOnStart === true) void this.trigger(job);
    }
  }

  /** 关服（配合入口的 `enableShutdownHooks`）——清干净定时器，进程才能真的退出 */
  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /**
   * 触发一次（**吞掉一切异常**：调度链不能因为一个任务失败而停摆）。
   *
   * ★ **重叠执行的处理＝跳过，不排队**：上一次还没跑完（如掉海扫描慢了）时，
   *   排队会在恢复后"补跑一堆"，而这类扫描任务**跑一次就是全量对状态**（幂等），
   *   补跑没有意义、只会把库压更狠。故本次直接跳过并在日志里说明。
   */
  private async trigger(job: ScheduledJob): Promise<void> {
    if (this.inFlight.has(job.name)) {
      this.logger.warn(`任务 ${job.name} 上一次尚未跑完，跳过本次（不并发、不排队）`);
      return;
    }

    this.inFlight.add(job.name);
    try {
      // JobRunner 内部已把"任务失败"落成 job_run_log.failed 并返回（不抛）；
      // 这里 catch 的是**留痕本身失败**（连不上库）那类情况
      await this.runner.run(job);
    } catch (error) {
      this.logger.error(
        `任务 ${job.name} 未能开始（留痕失败）：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inFlight.delete(job.name);
    }
  }
}

/** 间隔人话（日志用）：60000 → `60s`；不足 1 秒按毫秒打 */
function formatInterval(intervalMs: number): string {
  return intervalMs >= 1000 ? `${Math.round(intervalMs / 1000)}s` : `${intervalMs}ms`;
}

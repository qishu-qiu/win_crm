// =============================================================================
// 任务执行器（M7-02）—— **唯一写 `job_run_log` 的地方**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》A13：`status` 取值 `running / success / failed`（三态**是设计本意**：
//     先落 `running` 再改终态，进程若在中途被杀，表里会留下一条 `running` —— 这正是排查
//     「昨天 05:00 的日汇总为什么没出来」要看的东西）。
//   · 同 §十三 硬口径 2：`job_run_log` **按月分区**，主键 `(id, run_at)`（`0001_init` 里
//     `ADD PRIMARY KEY (id, run_at)` ＋ `PARTITION BY RANGE (YEAR(run_at)*100+MONTH(run_at))`）——
//     故本层**显式写 `run_at`**（不用 DB 默认值），让"这次跑"的时刻与分区归属都由调用方确定。
//
// ★ 为什么失败**不向外抛**：一次任务失败（如某条数据脏）不该让 Worker 进程崩、更不该
//   让后续调度停摆 —— 失败详情落 `job_run_log.error` ＋ 进程日志，人去看日志即可
//   （《架构说明》§六：Worker 恒 1 实例，它挂了没有人接班）。
//   ⚠ 但**留痕本身失败**（写 `running` 就失败＝库不可用）**照旧抛**：那种情况下任务也跑不动，
//     由调度器记一行错误日志，别把"库连不上"静默成"任务跑过了"。
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { JobRunResult, ScheduledJob } from './job.types';

/** `error` 列存 TEXT 无长度限制，但仍截断：堆栈动辄上万字符，排查时只需要前几屏 */
const MAX_ERROR_CHARS = 2000;

/** 异常 → 可读文本（含堆栈）；超长截断并**显式标注**，免得看日志的人以为只有这么点 */
function toErrorMessage(error: unknown): string {
  const text =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  return text.length > MAX_ERROR_CHARS
    ? `${text.slice(0, MAX_ERROR_CHARS)}…（已截断，完整堆栈见进程日志）`
    : text;
}

@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 跑一个任务，并把这次执行留痕到 `job_run_log`。
   * 返回 `JobRunResult`（失败时 `rowsAffected: 0`）—— **不抛**，见文件头 ★。
   */
  async run(job: ScheduledJob): Promise<JobRunResult> {
    const runAt = new Date();
    const startedMs = Date.now();

    // ① 先落 `running`（A13 三态的第一态）—— 这一步失败＝库不可用，直接抛给调度器
    const row = await this.prisma.jobRunLog.create({
      data: { job_name: job.name, run_at: runAt, status: 'running' },
    });

    try {
      const result = await job.run();
      const costMs = Date.now() - startedMs;

      // ② 成功态：把任务自己报的 `rowsAffected` / `watermark` 一并落库
      await this.prisma.jobRunLog.update({
        where: { id: row.id },
        data: {
          status: 'success',
          rows_affected: result.rowsAffected ?? 0,
          cost_ms: costMs,
          watermark: result.watermark ?? null,
        },
      });
      this.logger.log(
        `任务 ${job.name} 成功：rows=${result.rowsAffected ?? 0} cost=${costMs}ms`,
      );
      return result;
    } catch (error) {
      const costMs = Date.now() - startedMs;
      const message = toErrorMessage(error);

      // ③ 失败态：**错误信息必须落库**（A13 的 `error` 列就是为它准备的）
      await this.prisma.jobRunLog.update({
        where: { id: row.id },
        data: { status: 'failed', cost_ms: costMs, error: message },
      });
      this.logger.error(`任务 ${job.name} 失败（已留痕，未中断调度）：${message}`);
      return { rowsAffected: 0 };
    }
  }
}

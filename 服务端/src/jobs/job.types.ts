// =============================================================================
// jobs/ 约定（M7-02）—— **定时任务的统一形状**（只被 Worker 加载，→ 架构 §四 目录树 / §六）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§四 目录树：`src/jobs/` ＝ 定时任务，**只被 Worker 加载**；
//     §六 进程模型：Worker 装 `kernel ＋ jobs ＋ 用到的域`，`NestFactory.createApplicationContext(WorkerModule)`，
//     **不监听端口**，且 **永远只跑 1 个实例**（多开＝定时任务重复执行）。
//   · 《过程产出/开发计划-V1.md》M7-02 判据逐字：「`jobs/` 约定 + `job_run_log` 写入（每次跑留痕）」；
//     M7-01 判据：「Worker 单独跑起来，无端口占用」。
//   · 《销售CRM数据架构文档》A13：`job_run_log` ＝ 定时任务执行日志（`job_name` / `run_at` /
//     `status`(running|success|failed) / `rows_affected` / `cost_ms` / `watermark` / `error`）——
//     与 `operation_log` **分工固定**：它记「系统任务自身跑得怎么样」，不记「人对业务做了什么」。
//
// ★ 为什么把"形状"单独放一个文件而不用抽象基类：
//   新增一个任务的成本应该只有「写一个类 ＋ 往 `jobs.module.ts` 加一行」——
//   基类会把"注册"藏进继承链里，读 `jobs.module.ts` 就看不全「这个进程到底跑了哪几个任务」。
//
// ⚠ 调度**不引第三方依赖**（`@nestjs/schedule` 等）：本项目纪律是「引依赖要单独拍板」，
//   而本阶段只需要"按固定间隔跑"这一件事 —— Node 自带 `setInterval` 足够，
//   引一个包反而多一层版本与生命周期要维护（真要 cron 表达式时再拍板，→ 台账）。
// =============================================================================
import type { InjectionToken } from '@nestjs/common';

/**
 * 全部任务的**统一注入令牌**（数组形式注入，→ `job-scheduler.service.ts`）。
 * ★ 为什么不逐个注入：调度器只关心"有哪些任务"，新增任务不该改调度器的构造函数签名。
 */
export const SCHEDULED_JOBS: InjectionToken = Symbol('SCHEDULED_JOBS');

/**
 * 一次执行的结果 —— 只映射 `job_run_log` 里那两列，**多一个字段都不收**：
 * 「跑得怎么样」（耗时 / 状态 / 错误）由执行器自己算，任务不必也不许自己写日志。
 */
export interface JobRunResult {
  /** 本次处理了多少条（写进 `rows_affected`；不处理数据的任务给 0／不传） */
  rowsAffected?: number;
  /** 处理水位线（增量依据，写进 `watermark`；如"扫到哪个 biz_date"） */
  watermark?: string | null;
}

/**
 * 一个定时任务的形状。**实现类本身不碰日志表** —— 留痕统一由 `JobRunner` 写
 * （否则每个任务各写一份 `job_run_log`，字段口径迟早分叉）。
 */
export interface ScheduledJob {
  /** 任务名：写进 `job_run_log.job_name`（VARCHAR(64)），**与《数据架构》§十二 清单里的任务名对齐** */
  readonly name: string;
  /** 执行间隔（毫秒）——《数据架构》§十二 给的是"每小时 / 每日 05:00"这类人话，换算在此处声明 */
  readonly intervalMs: number;
  /**
   * 进程启动时**是否立即跑一次**（默认否）。
   * ★ 语义是「任务自己声明」，不是全局开关：掉海预警这类"启动就扫一遍"的任务显式开；
   *   日汇总这类"必须等到 05:00"的任务必须**保持关闭**（否则每次重启都重算一遍当天数据）。
   */
  readonly runOnStart?: boolean;
  /** 干活。抛错＝本次失败（执行器会落 `status=failed` ＋ `error`，**不会把 Worker 拖垮**） */
  run(): Promise<JobRunResult>;
}

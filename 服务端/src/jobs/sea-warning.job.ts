// =============================================================================
// 掉海预警任务（M7-03）—— **Worker 的第一个真业务任务**（每小时）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》§十二（定时任务清单）第 6 行逐字：
//     「**掉海预警（私海→公海）｜每小时**｜按 sea_rule：≤3 天进动线；到期前 24h 推销售；
//       6h 标红+推经理；超期落 sea_record 转**公司公海**（部门映射保留，仍显示于部门公海）」
//     —— ⚠ **末句"超期落 sea_record"不在本片**：《开发计划-V1》M7-05 判据＝「**只告警、不真掉**
//       （不写 `sea_record`、不清 owner）」，真掉海 ＋ reason 码属 **M9-F**。
//   · 《销售CRM业务需求文档》§6.3 预警节奏表（三档时点的唯一落点）。
//   · 《开发计划-V1》M7-03 判据逐字：「日志可见扫描结果与命中数」。
//
// ★ 任务名**与 §十二 清单里的名字同字**（`job_run_log.job_name` 是"这条是哪任务"的检索键，
//   清单里叫什么、表里就该叫什么；括号内是清单自带注解，一并保留）。
// ★ **间隔取 1 小时**：§十二 写死「每小时」。本层只需要"固定间隔"这一件事，
//   `setInterval` 足够（不引 cron 解析，见 `job-scheduler.service.ts` 头注）。
// ★ `runOnStart = true`：`job.types.ts` 里点名的用例 —— Worker 一起来就先扫一遍，
//   免得"刚重启完的两小时内没人被提醒"。
//
// ⚠ 本任务**不写任何业务数据**（唯一落库动作是 `JobRunner` 写的 `job_run_log`）——
//   详细口径见 `SeaService.scanSeaWarning` 方法头 ⚠⚠ 段。
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';

import { SeaService } from '../modules/sea/sea.service';
import type { JobRunResult, ScheduledJob } from './job.types';

/** 1 小时（《数据架构》§十二：掉海预警「每小时」） */
const SEA_WARNING_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class SeaWarningJob implements ScheduledJob {
  /** ★ 与 §十二 清单第 6 行同名（→ 文件头 ★） */
  readonly name = '掉海预警（私海→公海）';
  readonly intervalMs = SEA_WARNING_INTERVAL_MS;
  readonly runOnStart = true;

  private readonly logger = new Logger(SeaWarningJob.name);

  constructor(private readonly sea: SeaService) {}

  /**
   * 干活 ＝ 交给 F 域扫一遍（规则解析 / 分档 / 日志都在那边，本层不写业务判断）。
   *
   * @returns `rowsAffected` ＝ **命中条数**。⚠ 这是**有意**的：本任务**零写**（M7-05），
   *          "改了几行"恒为 0、留在表里等于什么都看不出来；而 M7-03 的判据就是"命中数"，
   *          故把命中数落在 `rows_affected` 上，让人**只看 `job_run_log` 也能复盘每一轮扫出几条**。
   *          检查过的候选条数（`scanned`）留在进程日志的扫描汇总行里。
   */
  async run(): Promise<JobRunResult> {
    const now = new Date();
    const summary = await this.sea.scanSeaWarning(now);

    this.logger.log(
      `掉海预警：扫描 ${summary.scanned} 条（生效规则 ${summary.rules} 条）→ 命中 ${summary.hits} 条`,
    );

    return { rowsAffected: summary.hits, watermark: now.toISOString() };
  }
}

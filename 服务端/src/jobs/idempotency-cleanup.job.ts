// =============================================================================
// 幂等键过期行清理任务（M9 · jobs）—— **全库唯一一张没有保留策略的表的回收**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§2.5（幂等键）：行按 **24h 有效**，查询已忽略过期行（幂等行为正确），
//     但**没有任何任务删除它们** ⇒ 行数随写请求**只增不减**（每个「登录人 × 端点 × key」一行）。
//   · 《销售CRM数据架构文档》§十二（定时任务清单）＋ §A15（末行"清理任务尚未建"，→《欠账登记表》D-60）。
//   · 保留窗口 ＋ 批次大小（→ D-60 建议，2026-09-29 拍定）：**保留 48h、每小时 `DELETE ... LIMIT 5000`**。
//
// ★ 为什么 48h 而非 24h：查询已忽略 24h 前的行（幂等判定只看有效期内），多留一天只是给
//   「跨时区 / 时钟漂移 / 运维回看」留缓冲，**不影响幂等语义**（过期行本就不参与判定）。
// ★ 为什么 LIMIT 5000 循环：Prisma 的 `deleteMany` 不支持 `take`，大表一次性 DELETE 会锁久、
//   易长事务；按 5000 一批循环到删干净，**避免单条语句持锁过久**（→ D-60「避免长事务」）。
// ★ 用 `$executeRaw`（不是 `$queryRaw`）：DELETE 返回受影响行数（`number`），正好用来判断"是否还有得删"。
//   ⚠ 表名用 `@@map` 后的 `idempotency_key`（不是 Prisma 模型名 `IdempotencyKey`）。
//
// ★ 任务名与《数据架构》§十二 清单同字（`job_run_log.job_name` 检索键，→ `sea-warning.job.ts` 头 ★）。
// ⚠ 这不是业务写动作、是系统回收 ⇒ **不写 `operation_log`**（与 `job_run_log` 分工固定，A13），
//   也不标 `@Audit`（那是人对业务的动作，→ 架构 §7.4）。
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { JobRunResult, ScheduledJob } from './job.types';

/** 保留窗口：过期行留 48h（查询只认 24h 内，多留一天纯缓冲，不影响幂等语义，→ 文件头 ★） */
const RETENTION_MS = 48 * 60 * 60 * 1000;
/** 每小时跑一次（《数据架构》§十二 清单口径：清理类＝每小时） */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
/** 单批删除上限：循环删到干净，避免长事务 / 持锁过久（→ D-60） */
const BATCH_SIZE = 5000;

@Injectable()
export class IdempotencyCleanupJob implements ScheduledJob {
  /** ★ 与 §十二 清单同字 */
  readonly name = '幂等键过期行清理';
  readonly intervalMs = CLEANUP_INTERVAL_MS;

  private readonly logger = new Logger(IdempotencyCleanupJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 干活 ＝ 循环 `DELETE ... LIMIT 5000` 直到没有过期行。
   * @returns `rowsAffected` ＝**本次删除的总行数**；`watermark` ＝本次清理的时间水位（早于它的行已删）。
   */
  async run(): Promise<JobRunResult> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    let total = 0;

    for (;;) {
      const affected = await this.prisma.$executeRaw`
        DELETE FROM idempotency_key
        WHERE created_at < ${cutoff}
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
      `;

      total += affected;
      // 本批没删满上限 ⇒ 没有更多过期行了，收工
      if (affected < BATCH_SIZE) break;
    }

    this.logger.log(
      `幂等键清理：删除 ${total} 行（早于 ${cutoff.toISOString()}；保留窗口 48h）`,
    );

    return { rowsAffected: total, watermark: cutoff.toISOString() };
  }
}

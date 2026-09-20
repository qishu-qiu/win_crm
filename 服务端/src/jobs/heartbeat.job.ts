// =============================================================================
// 心跳任务（M7-02）—— **骨架自检探针**，不是《数据架构》§十二 清单里的任务
//
// 它存在的唯一理由：《开发计划-V1》M7-02 的判据是「**跑一次后表中有记录**」——
//   要证明「jobs 约定 ＋ `job_run_log` 留痕」这条链路真的通，就必须有一个**能跑的任务**；
//   而 M7-03（掉海预警）是**下一片**的事，本片不能抢跑。
//
// ★ 它做什么：`SELECT 1` —— 确认"Worker 进程真的连得上库"。
//   这不是业务逻辑，是**探活**：runner 会把成功 / 失败连同耗时落进 `job_run_log`，
//   于是「Worker 起没起来、库通不通」在表里一目了然（M7-01 ＋ M7-02 两条判据的合并自证）。
//
// ⚠ **去留待定（已登记台账）**：M7-03 落掉海预警后，它**可能**仍然有用（Worker 存活探针），
//   也可能该删（免得每小时白写一行日志）。届时按"还有没有第二个用途"判，**本轮不作主张**。
//
// ★ 间隔取 1 小时：与 §十二 里频率最高的那档（掉海预警"每小时"）同频 ——
//   将来对比"心跳行"与"预警行"就能看出"是任务没跑，还是调度压根没起来"。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { JobRunResult, ScheduledJob } from './job.types';

/** 1 小时（《数据架构》§十二 最高频档） */
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class HeartbeatJob implements ScheduledJob {
  readonly name = 'heartbeat';
  readonly intervalMs = HEARTBEAT_INTERVAL_MS;
  /** 启动即跑一次：Worker 一起来就能在 `job_run_log` 里看到"我起过、库通" */
  readonly runOnStart = true;

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<JobRunResult> {
    // 探活：不读任何业务表（探针不该有业务副作用），也不改任何业务数据
    await this.prisma.$queryRaw`SELECT 1`;
    // `rowsAffected: 0` 是**诚实的**：它没处理任何一条业务数据（`rows_affected` 说的是那个）
    return { rowsAffected: 0 };
  }
}

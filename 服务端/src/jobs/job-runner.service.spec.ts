// =============================================================================
// JobRunner 用例（M7-02）—— **假数据，不连库**
//
// 判据（《开发计划-V1》M7-02）：「`jobs/` 约定 + `job_run_log` 写入（**每次跑留痕**）」——
//   故这里逐条钉住 A13 那几列的**落库形态**：三态（running → success|failed）、
//   `rows_affected` / `cost_ms` / `watermark` / `error`，以及「任务失败不中断调度」。
// =============================================================================
import type { PrismaService } from '../prisma/prisma.service';
import { JobRunner } from './job-runner.service';
import type { JobRunResult, ScheduledJob } from './job.types';

/** 造一个只带 `jobRunLog` 的 PrismaService 替身（够本层用，多了反而是假的） */
function makePrisma(): {
  prisma: PrismaService;
  create: jest.Mock;
  update: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue({ id: 1n });
  const update = jest.fn().mockResolvedValue({ id: 1n });
  const prisma = { jobRunLog: { create, update } } as unknown as PrismaService;
  return { prisma, create, update };
}

/** 造一个任务替身 */
function makeJob(overrides: Partial<ScheduledJob> & { run: jest.Mock }): ScheduledJob {
  return { name: 'probe', intervalMs: 1000, ...overrides } as ScheduledJob;
}

describe('JobRunner（M7-02 · job_run_log 留痕）', () => {
  it('成功：先落 running，再改 success，并把 rows_affected / cost_ms / watermark 一并写回', async () => {
    const { prisma, create, update } = makePrisma();
    const runner = new JobRunner(prisma);
    const job = makeJob({
      run: jest.fn().mockResolvedValue({ rowsAffected: 7, watermark: '2026-09-20' }),
    });

    const result = await runner.run(job);

    // ① 第一态：running（A13 的三态是设计本意 —— 进程被杀时表里留 running，正是排查入口）
    expect(create).toHaveBeenCalledTimes(1);
    const created = create.mock.calls[0][0].data;
    expect(created.job_name).toBe('probe');
    expect(created.status).toBe('running');
    // ★ `run_at` **显式写**（分区键，别依赖 DB 默认值）
    expect(created.run_at).toBeInstanceOf(Date);

    // ② 终态：success
    expect(update).toHaveBeenCalledTimes(1);
    const saved = update.mock.calls[0][0];
    expect(saved.where).toEqual({ id: 1n });
    expect(saved.data.status).toBe('success');
    expect(saved.data.rows_affected).toBe(7);
    expect(saved.data.watermark).toBe('2026-09-20');
    expect(typeof saved.data.cost_ms).toBe('number');
    expect(saved.data.cost_ms).toBeGreaterThanOrEqual(0);

    expect(result).toEqual<JobRunResult>({ rowsAffected: 7, watermark: '2026-09-20' });
  });

  it('成功但任务不报水位线：`watermark` 落 null（不是空串、不是 undefined）', async () => {
    const { prisma, update } = makePrisma();
    const runner = new JobRunner(prisma);

    await runner.run(makeJob({ run: jest.fn().mockResolvedValue({}) }));

    const saved = update.mock.calls[0][0];
    expect(saved.data.watermark).toBeNull();
    // 没报 rowsAffected ＝ 0（"没处理数据"与"没报"同义，A13 该列 NOT NULL DEFAULT 0）
    expect(saved.data.rows_affected).toBe(0);
  });

  it('失败：落 failed ＋ error（含原始信息），**不向外抛**（一次失败不得中断调度）', async () => {
    const { prisma, create, update } = makePrisma();
    const runner = new JobRunner(prisma);
    const job = makeJob({
      run: jest.fn().mockRejectedValue(new Error('掉海扫描炸了')),
    });

    // ★ 不抛：Worker 恒 1 实例，进程崩了没人接班（架构 §六）
    const result = await runner.run(job);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    const saved = update.mock.calls[0][0];
    expect(saved.data.status).toBe('failed');
    expect(saved.data.error).toContain('掉海扫描炸了');
    expect(typeof saved.data.cost_ms).toBe('number');
    expect(result).toEqual<JobRunResult>({ rowsAffected: 0 });
  });

  it('失败：非 Error 抛出物（如字符串）也要落成可读文本，而不是 `[object Object]`', async () => {
    const { prisma, update } = makePrisma();
    const runner = new JobRunner(prisma);

    await runner.run(makeJob({ run: jest.fn().mockRejectedValue('字符串异常') }));

    expect(update.mock.calls[0][0].data.error).toContain('字符串异常');
  });

  it('失败：超长堆栈**截断并标注**（别让一行日志塞进几万字符）', async () => {
    const { prisma, update } = makePrisma();
    const runner = new JobRunner(prisma);

    await runner.run(makeJob({ run: jest.fn().mockRejectedValue(new Error('x'.repeat(5000))) }));

    const saved = update.mock.calls[0][0].data;
    expect(saved.error).toContain('已截断');
    expect(saved.error.length).toBeLessThan(2200);
  });

  it('★ 留痕本身失败（写 running 就失败＝库不可用）→ **照旧抛**，不许静默成"跑过了"', async () => {
    const create = jest.fn().mockRejectedValue(new Error('库连不上'));
    const update = jest.fn();
    const prisma = { jobRunLog: { create, update } } as unknown as PrismaService;
    const runner = new JobRunner(prisma);
    const job = makeJob({ run: jest.fn().mockResolvedValue({}) });

    await expect(runner.run(job)).rejects.toThrow('库连不上');
    // 任务**没被执行**（拿不到留痕行就没有"这次跑"可言），也自然没有第二次写
    expect(job.run).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

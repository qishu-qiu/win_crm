// =============================================================================
// JobScheduler 用例（M7-02）—— **假时钟，不连库**
//
// 钉住三件事：① 按间隔触发；② `runOnStart` 启动即跑一次；③ 关服清定时器；
//   ④ **重叠执行＝跳过**（不并发、不排队）；⑤ 调度链吞异常（一次失败不停摆）。
// =============================================================================
import { JobScheduler } from './job-scheduler.service';
import type { JobRunner } from './job-runner.service';
import type { JobRunResult, ScheduledJob } from './job.types';

/** 造一个 JobRunner 替身（`run` 默认立即成功） */
function makeRunner(run?: jest.Mock): { runner: JobRunner; run: jest.Mock } {
  const runMock = run ?? jest.fn().mockResolvedValue({ rowsAffected: 0 } satisfies JobRunResult);
  return { runner: { run: runMock } as unknown as JobRunner, run: runMock };
}

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: 'probe',
    intervalMs: 1000,
    run: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('JobScheduler（M7-02 · 调度）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('按声明间隔触发（默认不"启动即跑"）', async () => {
    const { runner, run } = makeRunner();
    const scheduler = new JobScheduler(runner, [makeJob()]);

    scheduler.onModuleInit();
    expect(run).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler.onModuleDestroy();
  });

  it('`runOnStart: true` → 启动立即跑一次，随后按间隔继续', async () => {
    const { runner, run } = makeRunner();
    const scheduler = new JobScheduler(runner, [makeJob({ runOnStart: true })]);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('关服（onModuleDestroy）后**不再触发** —— 定时器必须清干净，否则进程退不掉', async () => {
    const { runner, run } = makeRunner();
    const scheduler = new JobScheduler(runner, [makeJob()]);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('★ 重叠执行＝**跳过**（上一次没跑完时不并发、也不排队补跑）', async () => {
    let release!: () => void;
    const run = jest.fn().mockImplementation(
      () =>
        new Promise<JobRunResult>((resolve) => {
          release = () => resolve({ rowsAffected: 0 });
        }),
    );
    const { runner } = makeRunner(run);
    const scheduler = new JobScheduler(runner, [makeJob()]);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    // 第一次还挂着（promise 未 resolve），第二个间隔到了 → 跳过
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    // 放行后，下一次间隔照常触发（"跳过"不影响后续）
    release();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('留痕失败（runner 抛）→ 调度链**吞掉异常**继续跑，不产生 unhandled rejection', async () => {
    const { runner, run } = makeRunner(
      jest.fn().mockRejectedValue(new Error('库连不上')) as jest.Mock,
    );
    const scheduler = new JobScheduler(runner, [makeJob()]);

    scheduler.onModuleInit();
    await expect(jest.advanceTimersByTimeAsync(2000)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('一个任务都没注册：只告警、不抛（Worker 会因无常驻句柄而退出，属如实表现）', () => {
    const { runner } = makeRunner();
    const scheduler = new JobScheduler(runner, []);

    expect(() => scheduler.onModuleInit()).not.toThrow();
    scheduler.onModuleDestroy();
  });
});

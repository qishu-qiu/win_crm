// =============================================================================
// 掉海预警任务用例（M7-03 / M7-05）—— **假件，不连库**
//
// 钉两件事（都是**判据级**的，不是形式）：
//   ① 任务形状与《数据架构》§十二 对齐：名字同字、**每小时**、启动即跑一次；
//   ② **只告警、不真掉**（M7-05）：本任务的整个触面就是"调一次 F 域扫描 ＋ 回一个计数"——
//      假件里**只有读口**，一旦哪天有人往这条链上加写动作，用例会因为"没有这个方法"当场炸。
// =============================================================================
import { SeaWarningJob } from './sea-warning.job';
import type { SeaService, SeaWarningScanResult } from '../modules/sea/sea.service';

const SUMMARY: SeaWarningScanResult = {
  scanned: 12,
  rules: 2,
  skippedNoRule: 3,
  skippedNoFreq: 1,
  hits: 5,
  tiers: { overdue: 1, alert_manager: 1, notify_owner: 1, agenda: 2, none: 3 },
};

function createJob(summary: SeaWarningScanResult = SUMMARY) {
  // ★ 假件**只给读口**（`scanSeaWarning`）：写动作（`markClaimed` 之类）**根本不存在** ——
  //   这就是 M7-05「只告警不真掉」在单测层的机械卡点。
  const sea = {
    scanSeaWarning: jest.fn<Promise<SeaWarningScanResult>, [Date]>(async () => summary),
  };

  return { job: new SeaWarningJob(sea as unknown as SeaService), sea };
}

describe('SeaWarningJob：任务形状（→ 数据架构 §十二「掉海预警（私海→公海）｜每小时」）', () => {
  it('任务名与清单**同字**（`job_run_log.job_name` 是检索键，歪一个字就查不到历史）', () => {
    expect(createJob().job.name).toBe('掉海预警（私海→公海）');
  });

  it('每小时一次，且**启动即跑一次**', () => {
    const { job } = createJob();
    expect(job.intervalMs).toBe(60 * 60 * 1000);
    expect(job.runOnStart).toBe(true);
  });
});

describe('SeaWarningJob：跑一次（M7-03 判据＝命中数可见；M7-05 判据＝零写）', () => {
  it('只调一次 F 域扫描，并带上"这一次"的时刻（与 `job_run_log.run_at` 同源，不许各自读钟）', async () => {
    const { job, sea } = createJob();
    await job.run();

    expect(sea.scanSeaWarning).toHaveBeenCalledTimes(1);
    const passed = sea.scanSeaWarning.mock.calls[0]?.[0];
    expect(passed).toBeInstanceOf(Date);
  });

  it('`rowsAffected` ＝ **命中数**（本任务零写，记"改了几行"毫无信息量）', async () => {
    const { job } = createJob();
    const result = await job.run();

    expect(result.rowsAffected).toBe(5);
    expect(result.watermark).toEqual(expect.any(String));
  });

  it('一条没命中照样成功返回（`0` 也要落 `job_run_log`：这才看得出"任务跑了、只是没事"）', async () => {
    const { job } = createJob({
      ...SUMMARY,
      hits: 0,
      tiers: { overdue: 0, alert_manager: 0, notify_owner: 0, agenda: 0, none: 12 },
    });
    const result = await job.run();

    expect(result.rowsAffected).toBe(0);
  });
});

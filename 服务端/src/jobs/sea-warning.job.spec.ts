// =============================================================================
// 掉海预警任务用例（M7-03 / **M9-F**）—— **假件，不连库**
//
// 钉两件事（都是**判据级**的，不是形式）：
//   ① 任务形状与《数据架构》§十二 对齐：名字同字、**每日一次**、启动即跑一次；
//      （★ 2026-09-21 口径变更：原「每小时」作废 —— 最小单位是天，→《废止口径登记表》#41）
//   ② 本任务的触面**恒定只有一个**：调一次 F 域扫描 ＋ 回一个计数 —— 写库（掉海）全在
//      F 域 service 里，本层**不自己碰库**（假件只给 `scanSeaWarning` 一个口；
//      哪天有人往这条链上塞第二个调用，用例会因为"没有这个方法"当场炸）。
//      ⚠ **别再把它写成"零写"**：M7-05 那层的判据已被 M9-F 接棒（→ `sea.service.spec.ts` 同簇用例）。
// =============================================================================
import { SeaWarningJob } from './sea-warning.job';
import type { SeaService, SeaWarningScanResult } from '../modules/sea/sea.service';

const SUMMARY: SeaWarningScanResult = {
  scanned: 12,
  rules: 2,
  skippedNoRule: 3,
  skippedNoFreq: 1,
  hits: 5,
  dropped: 1,
  dropSkipped: 0,
  tiers: { overdue: 1, alert_manager: 1, notify_owner: 1, agenda: 2, none: 3 },
};

function createJob(summary: SeaWarningScanResult = SUMMARY) {
  // ★ 假件**只给扫描这一个口**：写库（掉海）在 F 域 service 里，本层不碰 ——
  //   哪天有人往这条链上塞第二个调用，用例会因为"没有这个方法"当场炸。
  const sea = {
    scanSeaWarning: jest.fn<Promise<SeaWarningScanResult>, [Date]>(async () => summary),
  };

  return { job: new SeaWarningJob(sea as unknown as SeaService), sea };
}

describe('SeaWarningJob：任务形状（→ 数据架构 §十二「掉海预警（私海→公海）｜每日」）', () => {
  it('任务名与清单**同字**（`job_run_log.job_name` 是检索键，歪一个字就查不到历史）', () => {
    expect(createJob().job.name).toBe('掉海预警（私海→公海）');
  });

  it('**每日一次**（24h；原「每小时」已作废 → 废止口径 #41），且**启动即跑一次**', () => {
    const { job } = createJob();
    expect(job.intervalMs).toBe(24 * 60 * 60 * 1000);
    expect(job.runOnStart).toBe(true);
  });
});

describe('SeaWarningJob：跑一次（M7-03 判据＝命中数可见；M9-F 判据＝真掉的条数落 `rows_affected`）', () => {
  it('只调一次 F 域扫描，并带上"这一次"的时刻（与 `job_run_log.run_at` 同源，不许各自读钟）', async () => {
    const { job, sea } = createJob();
    await job.run();

    expect(sea.scanSeaWarning).toHaveBeenCalledTimes(1);
    const passed = sea.scanSeaWarning.mock.calls[0]?.[0];
    expect(passed).toBeInstanceOf(Date);
  });

  it('`rowsAffected` ＝ **真掉的条数**（M9-F 起本任务真的写库 ⇒ 这一列回到"改了几行"的本义）', async () => {
    const { job } = createJob();
    const result = await job.run();

    expect(result.rowsAffected).toBe(1);
    expect(result.watermark).toEqual(expect.any(String));
  });

  it('一条没掉照样成功返回（`0` 也要落 `job_run_log`：这才看得出"任务跑了、只是没事"）', async () => {
    const { job } = createJob({
      ...SUMMARY,
      hits: 0,
      dropped: 0,
      tiers: { overdue: 0, alert_manager: 0, notify_owner: 0, agenda: 0, none: 12 },
    });
    const result = await job.run();

    expect(result.rowsAffected).toBe(0);
  });
});

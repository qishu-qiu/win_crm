import path from 'node:path';

import { PrismaService } from '../../prisma/prisma.service';
import { ReportRepository } from './report.repository';
import { SeaRepository } from '../sea/sea.repository';

/**
 * ★ 这是**真库集成探针**（D-02 看板）：跑真实 SQL、只打印 OK/FAIL，不断言正确性。
 * 无 `DATABASE_URL` 时 `PrismaService` 构造即抛错 —— 不应拖垮单元套件，故**无库则整体 skip**
 * （→ `npm test` 默认不含真库；需验看板时显式带 `DATABASE_URL` 跑本文件）。
 */
const probeDbUrl = (() => {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), '.env'));
  } catch {
    // ignore
  }
  return typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
})();

describe('probe dashboard queries', () => {
  it('runs each report query and prints errors', async () => {
    if (!probeDbUrl) return; // 无 DATABASE_URL：集成探针跳过（不拖垮单元套件）
    const prisma = new PrismaService();
    await prisma.$connect();

    const repo = new ReportRepository(prisma);
    const sea = new SeaRepository(prisma);

    const now = new Date();
    const day = { start: now, end: now };
    const months = { thisStart: now, thisEnd: now, lastStart: now, lastEnd: now };

    const cases: Array<[string, () => Promise<unknown>]> = [
      ['countTodayNew', () => repo.countTodayNew(null, day)],
      ['countTodayTodo', () => repo.countTodayTodo(null, day)],
      ['sumMonthSigned', () => repo.sumMonthSigned(null, months)],
      ['listPendingTodo', () => repo.listPendingTodo(null, day)],
      ['listContractExpire', () => repo.listContractExpire(null, now, now, 10)],
      ['listNewBiz', () => repo.listNewBiz(null, now, 10)],
      ['listTopSales', () => repo.listTopSales(null, months, 10)],
      ['listZombieWeekly', () => repo.listZombieWeekly(null, now, now, 10)],
      ['listDeptCompare', () => repo.listDeptCompare(null, months)],
      ['sea.listSeaManagerTodo', () => sea.listSeaManagerTodo(null)],
    ];

    for (const [name, fn] of cases) {
      try {
        const r = await fn();
        console.log(`OK   ${name} ->`, JSON.stringify(r).slice(0, 120));
      } catch (e) {
        console.log(`FAIL ${name} ->`, (e as Error).message);
        console.log((e as Error).stack?.split('\n').slice(0, 4).join('\n'));
      }
    }

    await prisma.$disconnect();
    expect(true).toBe(true);
  });
});

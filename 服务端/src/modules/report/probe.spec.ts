import path from 'node:path';

import { PrismaService } from '../../prisma/prisma.service';
import { ReportRepository } from './report.repository';
import { SeaRepository } from '../sea/sea.repository';

describe('probe dashboard queries', () => {
  it('runs each report query and prints errors', async () => {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), '.env'));
    } catch {
      // ignore
    }
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
        // eslint-disable-next-line no-console
        console.log(`OK   ${name} ->`, JSON.stringify(r).slice(0, 120));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(`FAIL ${name} ->`, (e as Error).message);
        // eslint-disable-next-line no-console
        console.log((e as Error).stack?.split('\n').slice(0, 4).join('\n'));
      }
    }

    await prisma.$disconnect();
    expect(true).toBe(true);
  });
});

import { SeaService } from './sea.service.js';

describe('SeaService.evaluate —— 铁律：掉公海时间逻辑', () => {
  const svc = new SeaService();
  const rule = { noFollowUpDays: 3 };
  const DAY = 86_400_000;
  const now = new Date('2026-09-05T00:00:00Z');

  it('超阈值无跟单 → 掉部门公海', () => {
    const res = svc.evaluate(
      {
        maintainerRole: 'sales',
        lastFollowUpAt: new Date(now.getTime() - 4 * DAY),
        createdAt: new Date(now.getTime() - 10 * DAY),
        now,
      },
      rule,
    );
    expect(res.status).toBe('dept_sea');
  });

  it('客服岗位维护 → 永不掉落', () => {
    const res = svc.evaluate(
      {
        maintainerRole: 'customer_service',
        lastFollowUpAt: new Date(now.getTime() - 100 * DAY),
        createdAt: new Date(now.getTime() - 200 * DAY),
        now,
      },
      rule,
    );
    expect(res.status).toBe('private');
  });

  it('到期前 24h 推销售；前 6h 推经理', () => {
    const r24 = svc.evaluate(
      {
        maintainerRole: 'sales',
        lastFollowUpAt: new Date(now.getTime() - 2 * DAY),
        createdAt: new Date(now.getTime() - 10 * DAY),
        now,
      },
      rule,
    );
    expect(r24.shouldWarnSales).toBe(true);
    const r6 = svc.evaluate(
      {
        maintainerRole: 'sales',
        lastFollowUpAt: new Date(now.getTime() - 2.8 * DAY),
        createdAt: new Date(now.getTime() - 10 * DAY),
        now,
      },
      rule,
    );
    expect(r6.shouldWarnManager).toBe(true);
  });

  it('未到阈值 → 私海', () => {
    const res = svc.evaluate(
      {
        maintainerRole: 'sales',
        lastFollowUpAt: new Date(now.getTime() - 1 * DAY),
        createdAt: new Date(now.getTime() - 10 * DAY),
        now,
      },
      rule,
    );
    expect(res.status).toBe('private');
  });
});

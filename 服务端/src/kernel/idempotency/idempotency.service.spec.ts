// =============================================================================
// 幂等键存取用例（D-06 · 2026-09-20 拍板）
// 判据：① find 按「登录人 × 端点 × key」查、且**带 24h 下界**（过期的当没有）；
//      ② save 命中唯一冲突（P2002）**吞掉返回 false、不抛**（并发同 key 的取舍）；
//      ③ 其他错误照抛（不吞异常 —— 那会让人以为写成功了）。
// ⚠ 假件只实现本服务真正用到的两个方法（多给字段只会让用例假绿 → 铁律坑 16 / 21）。
// =============================================================================
import type { PrismaService } from '../../prisma/prisma.service';
import { IDEMPOTENCY_TTL_MS, IdempotencyService } from './idempotency.service';

interface Row {
  request_hash: string;
  status_code: number;
  response_body: unknown;
}

function createService(options: { row?: Row | null; createError?: unknown } = {}): {
  service: IdempotencyService;
  calls: { findWhere?: Record<string, unknown>; created?: Record<string, unknown> };
} {
  const calls: { findWhere?: Record<string, unknown>; created?: Record<string, unknown> } = {};
  const prisma = {
    idempotencyKey: {
      findFirst: (args: { where: Record<string, unknown> }) => {
        calls.findWhere = args.where;
        return Promise.resolve(options.row ?? null);
      },
      create: (args: { data: Record<string, unknown> }) => {
        calls.created = args.data;
        if (options.createError !== undefined) return Promise.reject(options.createError);
        return Promise.resolve({});
      },
    },
  } as unknown as PrismaService;
  return { service: new IdempotencyService(prisma), calls };
}

const SCOPE = { employeeId: 7n, endpoint: 'POST /relations', idemKey: 'key-0001' };

describe('幂等键存取（D-06 / 接口 §2.5）', () => {
  it('命中：按「登录人 × 端点 × key」查，返回首次结果的三个字段', async () => {
    const { service, calls } = createService({
      row: { request_hash: 'abc', status_code: 200, response_body: { id: '5' } },
    });

    const hit = await service.find(SCOPE);

    expect(hit).toEqual({ requestHash: 'abc', statusCode: 200, responseBody: { id: '5' } });
    expect(calls.findWhere).toMatchObject({
      employee_id: 7n,
      endpoint: 'POST /relations',
      idem_key: 'key-0001',
    });
  });

  it('★ 查询带 **24h 下界**（拍板③）：过期行当没有 —— 下界 ≈ now - TTL', async () => {
    const { service, calls } = createService({ row: null });

    const before = Date.now();
    await service.find(SCOPE);
    const after = Date.now();

    const gte = (calls.findWhere?.['created_at'] as { gte: Date }).gte;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - IDEMPOTENCY_TTL_MS);
    expect(gte.getTime()).toBeLessThanOrEqual(after - IDEMPOTENCY_TTL_MS);
  });

  it('未命中（null）→ 返回 null（不是抛异常、也不是空对象）', async () => {
    const { service } = createService({ row: null });
    await expect(service.find(SCOPE)).resolves.toBeNull();
  });

  it('save：三个入参原样落库（作用域 / 指纹 / 响应码 / 出参）', async () => {
    const { service, calls } = createService();

    const ok = await service.save(SCOPE, 'hash-1', 200, { id: '9' });

    expect(ok).toBe(true);
    expect(calls.created).toMatchObject({
      employee_id: 7n,
      endpoint: 'POST /relations',
      idem_key: 'key-0001',
      request_hash: 'hash-1',
      status_code: 200,
      response_body: { id: '9' },
    });
  });

  it('★ save 撞唯一冲突（P2002 / uk_idem_scope）→ **返回 false、不抛**（并发同 key 的取舍）', async () => {
    const { service } = createService({ createError: { code: 'P2002', meta: {} } });

    await expect(service.save(SCOPE, 'hash-1', 200, {})).resolves.toBe(false);
  });

  it('save 遇到**非唯一冲突**错误 → 照抛（吞了会让人以为首次结果已存下）', async () => {
    const { service } = createService({ createError: new Error('connection lost') });

    await expect(service.save(SCOPE, 'hash-1', 200, {})).rejects.toThrow('connection lost');
  });

  it('save 收到 `null` 出参 → 走 `Prisma.JsonNull`（不是 JS null：JSON 列 NOT NULL，DbNull 会被拒）', async () => {
    const { service, calls } = createService();

    await service.save(SCOPE, 'hash-1', 200, null);

    expect(calls.created?.['response_body']).not.toBeNull();
    expect(calls.created?.['response_body']).not.toBeUndefined();
  });
});

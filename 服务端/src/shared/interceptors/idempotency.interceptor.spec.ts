// =============================================================================
// 幂等切面用例（D-06 · 2026-09-20 拍板）
// 判据（→ 接口 §2.5 ＋ 拍板五条）：
//   ① 不带 `Idempotency-Key` 的写请求**放行**；② GET / Worker 不经本层；
//   ③ 首次 → 执行业务、成功后落库；④ 重放同 key 同入参 → **不执行 handler**、返回首次结果；
//   ⑤ 同 key 但入参不同 → **409 / 20004**；⑥ 键超长 → **400 / 20001**；
//   ⑦ 端点是**路由模板**（`POST /relations`，不是 `/relations/5`）。
//
// ★ 指纹（`request_hash`）**不在用例里重算**：先跑一次"首次"、从落库记录里取回真实指纹，
//   再喂给命中记录 —— 用例若自己实现一份 SHA-256，就成第二真相源（算法一改，用例假绿）。
// =============================================================================
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, type Observable } from 'rxjs';

import { AppError, ErrorCode, runWithContext, type RequestContext } from '../../kernel';
import type { IdempotencyHit, IdempotencyService } from '../../kernel/idempotency/idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

interface RecordedSave {
  scope: { employeeId: bigint; endpoint: string; idemKey: string };
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
}

interface ProgrammableStore {
  store: IdempotencyService;
  saved: RecordedSave[];
  findCalls: () => number;
  /** 让下一次 `find` 返回这个命中（`null` ＝ 未命中） */
  setHit: (hit: IdempotencyHit | null) => void;
}

/** 假存取件：`find` 返回可编程命中；`save` 只记录、不落库 */
function programmableStore(initial: IdempotencyHit | null = null): ProgrammableStore {
  const saved: RecordedSave[] = [];
  let hit = initial;
  let findCalls = 0;
  const store = {
    find: () => {
      findCalls += 1;
      return Promise.resolve(hit);
    },
    save: (
      scope: RecordedSave['scope'],
      requestHash: string,
      statusCode: number,
      responseBody: unknown,
    ) => {
      saved.push({ scope, requestHash, statusCode, responseBody });
      return Promise.resolve(true);
    },
  } as unknown as IdempotencyService;
  return {
    store,
    saved,
    findCalls: () => findCalls,
    setHit: (next) => {
      hit = next;
    },
  };
}

interface RequestLike {
  method?: string;
  body?: unknown;
  headers?: Record<string, unknown>;
  baseUrl?: string;
  path?: string;
  route?: { path?: unknown };
}

function createHttpContext(request: RequestLike): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function rpcContext(): ExecutionContext {
  return { getType: () => 'rpc' } as unknown as ExecutionContext;
}

/** 数「handle 被调用了几次」—— 判据④（重放不执行业务）就靠它 */
function countingHandler(data: unknown): { handler: CallHandler; calls: () => number } {
  let count = 0;
  const handler: CallHandler = {
    handle: (): Observable<unknown> => {
      count += 1;
      return of(data);
    },
  };
  return { handler, calls: () => count };
}

const CONTEXT: RequestContext = {
  employeeId: 7n,
  deptIds: [1n],
  roleCodes: ['sale'],
  dataScope: { type: 'self', deptIds: [] },
};

// ★ 本 spec **没有** `await flush()` 这类"等落库"的让步：拦截器是**等落库完成才放响应**的
//   （2026-09-20 真库实测修正 —— 原先 fire-and-forget 会让"响应已回、键未落"的重试漏过幂等），
//   故 `runOnce` 返回后键必已落库，断言直接看 `saved` 即可。

/** 「带幂等头的 POST」这一种请求（端点取路由模板 `/relations`） */
function postWithKey(body: unknown): ExecutionContext {
  return createHttpContext({
    method: 'POST',
    headers: { 'idempotency-key': 'key-0001' },
    body,
    baseUrl: '',
    route: { path: '/relations' },
  });
}

/** 跑一次并等出参（首次路径） */
async function runOnce(
  interceptor: IdempotencyInterceptor,
  context: ExecutionContext,
  handler: CallHandler,
): Promise<unknown> {
  const observable = await runWithContext(CONTEXT, () => interceptor.intercept(context, handler));
  return firstValueFrom(observable);
}

/** 跑一次并抓抛出的异常（期望失败路径） */
async function catchError(
  interceptor: IdempotencyInterceptor,
  context: ExecutionContext,
  handler: CallHandler,
): Promise<unknown> {
  let caught: unknown;
  await runWithContext(CONTEXT, async () => {
    try {
      await interceptor.intercept(context, handler);
    } catch (error) {
      caught = error;
    }
  });
  return caught;
}

describe('幂等切面（D-06 / 接口 §2.5）', () => {
  it('Worker（非 HTTP）：不经本层，直接放行', async () => {
    const { store, findCalls } = programmableStore();
    const { handler, calls } = countingHandler({ ok: 1 });

    await firstValueFrom(
      await new IdempotencyInterceptor(store).intercept(rpcContext(), handler),
    );

    expect(calls()).toBe(1);
    expect(findCalls()).toBe(0);
  });

  it('GET（天然幂等）：即使带了幂等头，也不查库、不落库', async () => {
    const { store, findCalls, saved } = programmableStore();
    const { handler } = countingHandler({ ok: 1 });

    await runOnce(
      new IdempotencyInterceptor(store),
      createHttpContext({ method: 'GET', headers: { 'idempotency-key': 'key-0001' } }),
      handler,
    );

    expect(findCalls()).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('★ 拍板①：写请求**没带** `Idempotency-Key` → 放行（不查库）', async () => {
    const { store, findCalls } = programmableStore();
    const { handler, calls } = countingHandler({ id: '5' });

    await runOnce(
      new IdempotencyInterceptor(store),
      createHttpContext({ method: 'POST', body: { name: 'x' } }),
      handler,
    );

    expect(calls()).toBe(1);
    expect(findCalls()).toBe(0);
  });

  it('带了头但**没有登录人**（如登录端点）→ 放行（作用域的一半是"谁"）', async () => {
    const { store, findCalls } = programmableStore();
    const { handler, calls } = countingHandler({ ok: 1 });

    // 刻意**不**包 `runWithContext`：模拟守卫没填上下文的路径
    await firstValueFrom(
      await new IdempotencyInterceptor(store).intercept(postWithKey({}), handler),
    );

    expect(calls()).toBe(1);
    expect(findCalls()).toBe(0);
  });

  it('⑥ 幂等键超长（> 64）→ **400 / 20001**，且**不静默截断**', async () => {
    const { store } = programmableStore();
    const { handler } = countingHandler({ ok: 1 });

    const caught = await catchError(
      new IdempotencyInterceptor(store),
      createHttpContext({
        method: 'POST',
        headers: { 'idempotency-key': 'k'.repeat(65) },
        body: {},
      }),
      handler,
    );

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).httpStatus).toBe(400);
    expect((caught as AppError).code).toBe(ErrorCode.PARAM_INVALID);
  });

  it('③ 首次（未命中）：执行业务 ＋ 落库；端点取**路由模板**、出参 bigint 已转字符串', async () => {
    const { store, saved } = programmableStore();
    const { handler } = countingHandler({ id: 9n, name: '张三' });

    await runOnce(new IdempotencyInterceptor(store), postWithKey({ name: 'x' }), handler);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.scope).toEqual({
      employeeId: 7n,
      endpoint: 'POST /relations',
      idemKey: 'key-0001',
    });
    expect(saved[0]?.statusCode).toBe(200);
    // bigint → string：不过 `toJsonSafe` 的话，这一行在 JSON 列写入时直接炸
    expect(saved[0]?.responseBody).toEqual({ id: '9', name: '张三' });
    expect(saved[0]?.requestHash).toHaveLength(64);
  });

  it('★ 判据④：重放（同 key 同入参）→ **不执行 handler**，原样返回首次结果', async () => {
    const { store, saved, setHit } = programmableStore();
    const interceptor = new IdempotencyInterceptor(store);
    const body = { name: 'x' };

    // ① 先跑一次「首次」，取回服务端真实算出的指纹与出参
    await runOnce(interceptor, postWithKey(body), countingHandler({ id: '5' }).handler);
    const firstHash = saved[0]?.requestHash ?? '';
    const firstBody = saved[0]?.responseBody;
    expect(firstHash).toHaveLength(64);

    // ② 让 find 命中「首次结果」，再发一次**同一份入参**
    setHit({ requestHash: firstHash, statusCode: 200, responseBody: firstBody });
    const replay = countingHandler({ id: '999', name: '不该出现' });

    await expect(runOnce(interceptor, postWithKey(body), replay.handler)).resolves.toEqual(firstBody);
    expect(replay.calls()).toBe(0);
  });

  it('⑤ 同 key 但**入参不同** → **409 / 20004**（静默回旧结果会让人以为这次写成功了）', async () => {
    const { store } = programmableStore({ requestHash: 'hash-首次', statusCode: 200, responseBody: {} });
    const { handler, calls } = countingHandler({ ok: 1 });

    const caught = await catchError(
      new IdempotencyInterceptor(store),
      postWithKey({ name: '改过的入参' }),
      handler,
    );

    expect(calls()).toBe(0);
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).httpStatus).toBe(409);
    expect((caught as AppError).code).toBe(ErrorCode.UNIQUE_CONFLICT);
    expect((caught as AppError).constraint).toBe('uk_idem_scope');
  });

  it('出参为 `undefined`（无返回体的写端点）→ 落库记 `null`、不炸', async () => {
    const { store, saved } = programmableStore();

    await runOnce(new IdempotencyInterceptor(store), postWithKey({}), countingHandler(undefined).handler);

    expect(saved[0]?.responseBody).toBeNull();
  });
});

// =============================================================================
// 写操作审计切面用例（M5-07 · 2026-09-15）
//
// 判据（→ 交接说明 §四 / 开发计划 M5-07）：
//   · **所有增删改**成功后都有 log（七叔口径「符合等保：所有的增删改都有迹可查」）；
//   · 业务失败（抛异常）**不写** —— 与「业务失败回滚后无 log」同一条；
//   · 查看（GET）**不进本切面**（由 D 域出口单独写，→ `engine.service.spec.ts`）；
//   · **best-effort**：审计写失败**不许**把业务请求带崩。
//
// 假件按**真实形状**造（→ 铁律坑 16）：`ExecutionContext` 的 `getType / getHandler / switchToHttp`
//   一个不少；`handler` 用**真装饰器**标（不是手塞元数据），否则测不出「装饰器写歪了」。
// =============================================================================
import { RequestMethod, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import {
  Audit,
  AuditSkip,
  runWithContext,
  type AuditLogInput,
  type AuditService,
} from '../../kernel/index';
import { AuditLogInterceptor } from './audit-log.interceptor';

/** 造一个带真装饰器的 handler（元数据与生产代码走同一条路） */
class Handlers {
  @Audit('relation.activate', 'business_relation')
  decorated(): void {
    /* 只为取元数据 */
  }

  @AuditSkip()
  skipped(): void {
    /* 只为取元数据 */
  }

  undecorated(): void {
    /* 只为取元数据 */
  }
}

const handlers = new Handlers();

interface FakeRequest {
  method?: string;
  ip?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

function contextOf(handler: unknown, request: FakeRequest): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** 造一个「已登录」的请求上下文（切面在请求阶段取 `operator_id`） */
function asLoggedIn<T>(fn: () => T): T {
  return runWithContext(
    { employeeId: 7n, deptIds: [2n], roleCodes: ['sale'], dataScope: { type: 'self', deptIds: [] } },
    fn,
  );
}

/** 造切面 + 记录器（`recordStandalone` 的落库动作被记下来，供断言） */
function createInterceptor(): { interceptor: AuditLogInterceptor; records: AuditLogInput[] } {
  const records: AuditLogInput[] = [];
  const audit = {
    recordStandalone: (input: AuditLogInput): Promise<boolean> => {
      records.push(input);
      return Promise.resolve(true);
    },
  };
  return {
    interceptor: new AuditLogInterceptor(audit as unknown as AuditService),
    records,
  };
}

/** 跑一次拦截（`next` 返回给定数据）+ **冲掉 fire-and-forget 的微任务** */
async function run(
  interceptor: AuditLogInterceptor,
  context: ExecutionContext,
  next: CallHandler,
): Promise<void> {
  await lastValueFrom(interceptor.intercept(context, next));
  await new Promise((resolve) => setImmediate(resolve));
}

const DATA_OK: CallHandler = { handle: () => of({ id: 11n }) };

describe('M5-07 写操作审计切面', () => {
  it('POST ＋ `@Audit` → 写一条：动作名 / 对象类型 / 对象 id / 来源 / 操作人全带', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.decorated, {
      method: 'POST',
      ip: '10.0.0.9',
      headers: { 'user-agent': 'jest', 'x-request-id': 'r-1' },
    });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records).toEqual([
      {
        action: 'relation.activate',
        target_type: 'business_relation',
        target_id: 11n, // 路由无 :id → 取出参 `id`（新建类）
        operator_id: 7n,
        req_id: 'r-1',
        ip: '10.0.0.9',
        user_agent: 'jest',
      },
    ]);
  });

  it('GET（查看）→ **不进本切面**（查看留痕是 D 域出口的事，别在这里记）', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.decorated, { method: 'GET', headers: {} });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records).toHaveLength(0);
  });

  it('`@AuditSkip()`（语义是读的 POST，如撞库查重）→ 不写', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.skipped, { method: 'POST', headers: {} });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records).toHaveLength(0);
  });

  it('未标 `@Audit` 的写端点 → **仍留痕**（兜底名 `http.put`），且不因漏标而丢审计', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.undecorated, { method: 'PUT', headers: {} });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records).toHaveLength(1);
    expect(records[0].action).toBe('http.put');
    expect(records[0].target_id).toBe(11n);
  });

  it('路由参数 `:id` **优先**于出参 id（改 / 加成员类，对象是被改的那条）', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.decorated, {
      method: 'PUT',
      params: { id: '99' },
      headers: {},
    });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records[0].target_id).toBe(99n);
  });

  it('缺请求头（无 ip / ua / req_id）→ **不写空串**（缺省＝不写该列，与 AuditLogInput 一致）', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.undecorated, { method: 'POST', headers: {} });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records[0].ip).toBeUndefined();
    expect(records[0].user_agent).toBeUndefined();
    expect(records[0].req_id).toBeUndefined();
  });

  it('业务抛异常 → **不写**（与「业务失败回滚后无 log」同一口径）', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.decorated, { method: 'POST', headers: {} });
    const failing: CallHandler = { handle: () => throwError(() => new Error('业务失败')) };

    await expect(asLoggedIn(() => run(interceptor, context, failing))).rejects.toThrow('业务失败');
    expect(records).toHaveLength(0);
  });

  it('无请求上下文（守卫未跑）→ 切面**不抛**，业务照常返回（best-effort 不阻断）', async () => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.decorated, { method: 'POST', headers: {} });

    await run(interceptor, context, DATA_OK); // 不包 runWithContext

    expect(records).toHaveLength(1);
    expect(records[0].operator_id).toBeUndefined(); // 交给 AuditService 决定（无上下文的策略由它兜）
  });

  it('非 HTTP（Worker）→ 放行且不写', async () => {
    const { interceptor, records } = createInterceptor();
    const context = {
      getType: () => 'rpc',
      getHandler: () => handlers.decorated,
      switchToHttp: () => {
        throw new Error('不该走到这里');
      },
    } as unknown as ExecutionContext;

    await run(interceptor, context, DATA_OK);

    expect(records).toHaveLength(0);
  });
});

/** 顺带钉住「写方法集合」的口径：POST/PUT/PATCH/DELETE 记，GET/HEAD/OPTIONS 不记 */
describe('M5-07 切面覆盖的 HTTP 方法', () => {
  const cases: [RequestMethod, boolean][] = [
    [RequestMethod.POST, true],
    [RequestMethod.PUT, true],
    [RequestMethod.PATCH, true],
    [RequestMethod.DELETE, true],
    [RequestMethod.GET, false],
  ];

  it.each(cases)('method=%s → 留痕=%s', async (method, shouldAudit) => {
    const { interceptor, records } = createInterceptor();
    const context = contextOf(handlers.undecorated, {
      method: RequestMethod[method],
      headers: {},
    });

    await asLoggedIn(() => run(interceptor, context, DATA_OK));

    expect(records).toHaveLength(shouldAudit ? 1 : 0);
  });
});

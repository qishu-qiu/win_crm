// =============================================================================
// F 域服务用例（F-01 公海「领取到私海」）—— **假数据，不连库**
//
// 本文件钉的是**编排**（顺序 / 谁调谁 / 什么情况下不动库不发事件），不是规则：
//   权限 / 范围 / 定位 / 原子性全在 C 域出口（那边 8 条用例已钉）—— 这里只假造它的返回与异常。
//
// ★ 假件必须照**真实形状**给（→ 铁律坑 16「假红先修假件」）：
//   · C 域出口的返回＝ `{relation, prevStage, prevOwnerId}`（`relation` 是**读回的关系列表项**）；
//   · 仓储 `findLatestRecord` 可能回 `null`（＝从来没掉过海），这条路径**必须**有用例。
// =============================================================================
import {
  AppError,
  DomainEventName,
  ErrorCode,
  runWithContext,
  type DomainEvent,
  type EventBus,
  type RequestContext,
} from '../../kernel/index';
import type { RelationService, RelationVo } from '../relation/relation.service';
import type { SeaRepository } from './sea.repository';
import { SeaService } from './sea.service';

const ME = 7n;
const OTHER = 8n;
const COMPANY_ID = 3n;
const DEPT_ID = 2n;
const LINE_ID = 1n;
const RELATION_ID = 11n;
const RECORD_ID = 55n;

/** C 域出口读回的列表项（形状唯一落点在 C 域；这里照抄一份**真实形状**） */
function relationVo(overrides: Partial<RelationVo> = {}): RelationVo {
  return {
    id: RELATION_ID,
    company: { id: COMPANY_ID, name: '合肥测试建材有限公司' },
    dept: { id: DEPT_ID, name: '销售一部' },
    product_line: { id: LINE_ID, name: '标准线', color_key: 'blue' },
    stage: 1,
    urgency: 'gray',
    value_tier: null,
    customer_level: null,
    owner: { id: ME, name: '王海涛' },
    sea_status: 'private',
    last_event_at: null,
    next_action_hint: null,
    competition: null,
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-20T09:00:00.000Z',
    ...overrides,
  };
}

interface FakeOptions {
  /** C 域出口抛这个错（越权 / 被同事抢走 / 定位不到…） */
  claimError?: unknown;
  /** 最近一条入公海历史（**显式 `null`** ＝ 从来没掉过海） */
  latestRecord?: { id: bigint } | null;
  prevOwnerId?: bigint | null;
}

function createService(options: FakeOptions = {}) {
  const repository = {
    // ★ 形参类型用 `jest.fn<返回, [入参]>` 的**泛型**给（不写形参名）：
    //   这样 `mock.calls[i]` 仍带类型（能断言"传了什么"），又不会因为"形参没用到"被 lint 卡红。
    findLatestRecord: jest.fn<Promise<{ id: bigint } | null>, [bigint]>(async () =>
      options.latestRecord === undefined ? { id: RECORD_ID } : options.latestRecord,
    ),
    markClaimed: jest.fn<
      Promise<{ id: bigint; claimed_at: Date }>,
      [bigint, { claimedBy: bigint; claimedAt: Date }]
    >(async () => ({ id: RECORD_ID, claimed_at: new Date() })),
  };
  const relation = {
    claimCompanySeaRelation: jest.fn<
      Promise<{ relation: RelationVo; prevStage: number; prevOwnerId: bigint | null }>,
      [{ companyId: bigint; deptId: bigint; productLineId: bigint }]
    >(async () => {
      if (options.claimError !== undefined) throw options.claimError;
      return {
        relation: relationVo(),
        prevStage: 1,
        prevOwnerId: options.prevOwnerId ?? null,
      };
    }),
  };
  // 事件总线：单测只关心「发了什么」（落库 / 转承诺是 D 域订阅方的事）
  const events = { publish: jest.fn<Promise<void>, [DomainEvent]>(async () => undefined) };

  const service = new SeaService(
    repository as unknown as SeaRepository,
    relation as unknown as RelationService,
    events as unknown as EventBus,
  );

  return { service, repository, relation, events };
}

function contextOf(roleCodes: string[] = ['sale']): RequestContext {
  return {
    employeeId: ME,
    deptIds: [DEPT_ID],
    roleCodes,
    dataScope: { type: 'self', deptIds: [] },
  };
}

async function captureAppError(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('期望抛出 AppError，但调用成功返回了');
}

const CLAIM_DTO = { dept_id: DEPT_ID.toString(), product_line_id: LINE_ID.toString() };
const COMPANY_ID_TEXT = COMPANY_ID.toString();

describe('SeaService（F-01 公海「领取到私海」）', () => {
  it('成功：调 C 域出口 → 回填最近一条入公海历史 → 发 `RelationClaimed` → 出参＝列表项 ＋ `claimed_at`', async () => {
    const { service, repository, relation, events } = createService({ prevOwnerId: OTHER });

    const result = await runWithContext(contextOf(), () =>
      service.claimCompanySeaRelation(COMPANY_ID_TEXT, CLAIM_DTO),
    );

    // ① 认领本体全交给 C 域出口（那三张表是 C 域的表），**它自己一个事务**
    expect(relation.claimCompanySeaRelation).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      deptId: DEPT_ID,
      productLineId: LINE_ID,
    });
    // ② 回填本域历史：最近一条（不是"随便一条"），人 ＝ 领取人
    expect(repository.findLatestRecord).toHaveBeenCalledWith(RELATION_ID);
    const written = repository.markClaimed.mock.calls[0]?.[1];
    expect(repository.markClaimed).toHaveBeenCalledWith(RECORD_ID, {
      claimedBy: ME,
      claimedAt: expect.any(Date),
    });
    // ③ 承诺级联走领域事件（F / D 同层禁依赖）：聚合根是**关系**、操作人是**领取人**
    const published = events.publish.mock.calls[0]?.[0];
    expect(published?.name).toBe(DomainEventName.RelationClaimed);
    expect(published?.actorId).toBe(ME);
    expect(published?.aggregateId).toBe(RELATION_ID);
    expect(published?.payload).toEqual({
      companyId: COMPANY_ID,
      deptId: DEPT_ID,
      productLineId: LINE_ID,
      prevOwnerId: OTHER,
    });
    // 出参＝C 域列表项（**不新造形状**）＋ 与落库**同一个**时间戳
    expect(result.id).toBe(RELATION_ID);
    expect(result.owner).toEqual({ id: ME, name: '王海涛' });
    expect(result.sea_status).toBe('private');
    expect(result.claimed_at).toBe(written?.claimedAt.toISOString());
  });

  it('**从来没掉过海**（没有历史行）→ 不写任何记录、`claimed_at` 回 `null`，但事件**照发**', async () => {
    const { service, repository, events } = createService({ latestRecord: null });

    const result = await runWithContext(contextOf(), () =>
      service.claimCompanySeaRelation(COMPANY_ID_TEXT, CLAIM_DTO),
    );

    // ⛔ 不许现补一条「假装掉过海」的记录（掉海扫描属 M7 后续片，→ 仓储注释 ★）
    expect(repository.markClaimed).not.toHaveBeenCalled();
    expect(result.claimed_at).toBeNull();
    // ★ 承诺级联与「有没有掉海记录」无关：关系确实被领走了，承诺就该跟着换人
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('C 域出口抛错（越权 / 被抢 / 定位不到）→ **原样冒泡**，本域零写零事件', async () => {
    const conflict = new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '这条公海客户刚刚被同事领走了', {
      constraint: 'sea.claim_conflict',
    });
    const { service, repository, events } = createService({ claimError: conflict });

    const error = await runWithContext(contextOf(), () =>
      captureAppError(() => service.claimCompanySeaRelation(COMPANY_ID_TEXT, CLAIM_DTO)),
    );

    expect(error).toBe(conflict);
    expect(repository.findLatestRecord).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('拿不到请求上下文 → 401（**绝不兜底成「匿名」**），且**不调** C 域出口', async () => {
    const { service, relation } = createService();

    const error = await captureAppError(() =>
      service.claimCompanySeaRelation(COMPANY_ID_TEXT, CLAIM_DTO),
    );

    expect(error.httpStatus).toBe(401);
    expect(error.constraint).toBe('sea.no_context');
    expect(relation.claimCompanySeaRelation).not.toHaveBeenCalled();
  });
});

// =============================================================================
// F 域服务用例（F-01 公海「领取到私海」）—— **假数据，不连库**
//
// 本文件钉的是**编排**（顺序 / 谁调谁 / 什么情况下不动库不发事件），不是规则：
//   权限 / 范围 / 定位 / 原子性全在 C 域出口（那边 8 条用例已钉）—— 这里只假造它的返回与异常。
//
// ★ 假件必须照**真实形状**给（→ 铁律坑 16「假红先修假件」）：
//   · C 域领取出口的返回＝ `{relation, prevStage, prevOwnerId}`（`relation` 是**读回的列表项**）；
//   · 仓储 `findLatestRecord` 可能回 `null`（＝从来没掉过海），这条路径**必须**有用例；
//   · C 域**掉海出口**（M9-F）返回 `{ownerId} | null` —— **`null` ＝ 这条轮不到我掉**
//     （并发下刚被领走），那条分支**必须**有用例（否则会写出"没掉也记历史"的错）。
// =============================================================================
import {
  AppError,
  DomainEventName,
  ErrorCode,
  runWithContext,
  type AuditService,
  type DomainEvent,
  type EventBus,
  type RequestContext,
} from '../../kernel/index';
import type {
  RelationService,
  RelationVo,
  SeaWarningCandidate,
} from '../relation/relation.service';
import type { OrgService } from '../org/org.service';
import type { SeaRepository } from './sea.repository';
import { SeaService } from './sea.service';
import type { SeaRuleLike } from './domain/sea-warning';

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
  /** C 域领取出口抛这个错（越权 / 被同事抢走 / 定位不到…） */
  claimError?: unknown;
  /** 最近一条入公海历史（**显式 `null`** ＝ 从来没掉过海） */
  latestRecord?: { id: bigint } | null;
  prevOwnerId?: bigint | null;
  /** 生效中的公海规则（M7-03 扫描用；缺省＝没有规则） */
  rules?: readonly SeaRuleLike[];
  /** 预警候选私海（M7-03 扫描用；缺省＝空） */
  candidates?: readonly SeaWarningCandidate[];
  /** C 域**掉海出口**的返回（M9-F；缺省＝掉成；**显式 `null`** ＝ 这条轮不到我掉） */
  dropResult?: { ownerId: bigint } | null;
  /** 规则配置页要看的 `active` 行（M9-F 规则配置片；缺省＝空） */
  configRules?: readonly SeaRuleRowFixture[];
  /** 「部门 × 产品线」在途私海条数（C 域聚合出口；缺省＝空） */
  seaGroups?: readonly { deptId: bigint; productLineId: bigint; count: number }[];
  /** 部门 / 产品线的名字引用（跨域装配用；缺省＝照 id 造一个名字） */
  deptRefs?: readonly { id: bigint; name: string }[];
  productLineRefs?: readonly { id: bigint; name: string }[];
}

/** `listActiveRulesForConfig` 行的**真实形状**（列名照仓储的 select） */
interface SeaRuleRowFixture {
  id: bigint;
  level: number;
  dept_id: bigint | null;
  product_line_id: bigint | null;
  follow_freq_days: number | null;
  deal_cycle_days: number | null;
  stay_days: number | null;
  no_progress_max: number | null;
  effective_from: Date;
  status: string;
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
    // M7-03：读规则（**只读**）
    listActiveSeaRules: jest.fn<Promise<SeaRuleLike[]>, [Date]>(async () =>
      options.rules === undefined ? [] : [...options.rules],
    ),
    // M9-F 真掉海：写本域历史（→ F2 `sea_record`）
    createSeaRecord: jest.fn<
      Promise<{ id: bigint }>,
      [{ relationId: bigint; ownerId: bigint; reason: string; droppedAt: Date }]
    >(async () => ({ id: RECORD_ID })),
    // M9-F 规则配置：读 `active` 行（**含待生效**）
    listActiveRulesForConfig: jest.fn<Promise<SeaRuleRowFixture[]>, [readonly bigint[] | null]>(
      async () => (options.configRules === undefined ? [] : [...options.configRules]),
    ),
    // M9-F 规则配置：插新版本行 ＋ 旧行 disabled（**唯一写口**）
    replaceRuleVersion: jest.fn<
      Promise<SeaRuleRowFixture>,
      [
        {
          level: number;
          deptId: bigint | null;
          productLineId: bigint | null;
          followFreqDays: number | null;
          dealCycleDays: number | null;
          stayDays: number | null;
          noProgressMax: number | null;
          effectiveFrom: Date;
          operatorId: bigint;
        },
      ]
    >(async (input) => ({
      id: 99n,
      level: input.level,
      dept_id: input.deptId,
      product_line_id: input.productLineId,
      follow_freq_days: input.followFreqDays,
      deal_cycle_days: input.dealCycleDays,
      stay_days: input.stayDays,
      no_progress_max: input.noProgressMax,
      effective_from: input.effectiveFrom,
      status: 'active',
    })),
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
    // M7-03：候选私海（**只读**跨域出口）
    listSeaWarningCandidates: jest.fn<Promise<SeaWarningCandidate[]>, []>(async () =>
      options.candidates === undefined ? [] : [...options.candidates],
    ),
    // M9-F 真掉海：C 域掉海出口（缺省＝掉成；显式 `null` ＝ 这条轮不到我掉）
    dropPrivateSeaRelation: jest.fn<Promise<{ ownerId: bigint } | null>, [bigint]>(async () =>
      options.dropResult === undefined ? { ownerId: ME } : options.dropResult,
    ),
    // M9-F 规则配置：按部门 × 产品线的在途私海条数（**聚合数，不含客户明细**）
    countPrivateSeaByDeptLine: jest.fn<
      Promise<{ deptId: bigint; productLineId: bigint; count: number }[]>,
      [readonly bigint[] | null]
    >(async () => (options.seaGroups === undefined ? [] : [...options.seaGroups])),
  };
  // 事件总线：单测只关心「发了什么」（落库 / 转承诺是 D 域订阅方的事）
  const events = { publish: jest.fn<Promise<void>, [DomainEvent]>(async () => undefined) };
  // 审计（D-68②）：掉海是系统动作 → 走 `recordStandalone`；本文件只关心「写了什么」
  const audit = {
    recordStandalone: jest.fn<Promise<boolean>, [Parameters<AuditService['recordStandalone']>[0]]>(
      async () => true,
    ),
  };
  // A 域（L1）引用出口：规则出参要把部门 / 产品线 id 翻成名字（跨域不许查对方的表）
  const org = {
    getDeptRefs: jest.fn<Promise<{ id: bigint; name: string }[]>, [readonly bigint[]]>(async (ids) =>
      options.deptRefs === undefined
        ? ids.map((id) => ({ id, name: `部门${id.toString()}` }))
        : [...options.deptRefs],
    ),
    getProductLineRefs: jest.fn<
      Promise<{ id: bigint; name: string; color_key: string | null }[]>,
      [readonly bigint[]]
    >(async (ids) =>
      options.productLineRefs === undefined
        ? ids.map((id) => ({ id, name: `产品线${id.toString()}`, color_key: null }))
        : options.productLineRefs.map((ref) => ({ ...ref, color_key: null })),
    ),
  };

  const service = new SeaService(
    repository as unknown as SeaRepository,
    relation as unknown as RelationService,
    events as unknown as EventBus,
    audit as unknown as AuditService,
    org as unknown as OrgService,
  );

  return { service, repository, relation, events, audit, org };
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

// =============================================================================
// M7-03 / M7-05 掉海预警扫描
// =============================================================================
const NOW = new Date('2026-09-20T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** now 前 / 后 `ms` 毫秒（用例里只写"相对现在"，免得抄一屏时间戳） */
function before(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

/** 全局规则：10 天没有效跟进就到期（L1） */
const GLOBAL_RULE: SeaRuleLike = {
  level: 1,
  deptId: null,
  productLineId: null,
  followFreqDays: 10,
  effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
};

function candidate(overrides: Partial<SeaWarningCandidate>): SeaWarningCandidate {
  return {
    id: 11n,
    deptId: DEPT_ID,
    productLineId: LINE_ID,
    ownerId: ME,
    lastEventAt: before(1 * DAY),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SeaService.scanSeaWarning（M7-03：扫一遍 ＋ 分档 ＋ 只告警）', () => {
  it('四档齐全 ＋ 一档不报：到期日已过 / 到期当天 / 到期前 1 天 / ≤3天 各 1 条，另外 1 条还早（`none`）', async () => {
    const { service } = createService({
      rules: [GLOBAL_RULE],
      candidates: [
        // 规则＝10 天；`NOW` ＝ 上海 09-20 20:00 ⇒ 到期日 = 最后一次有效沟通那天 + 10 天
        candidate({ id: 1n, lastEventAt: before(12 * DAY) }), // 到期日 09-18（**已过**）→ overdue
        candidate({ id: 2n, lastEventAt: before(10 * DAY - 3 * HOUR) }), // 到期日 09-20（**当天**）→ alert_manager
        candidate({ id: 3n, lastEventAt: before(10 * DAY - 20 * HOUR) }), // 到期日 09-21（**前 1 天**）→ notify_owner
        candidate({ id: 4n, lastEventAt: null, createdAt: before(7 * DAY) }), // 没跟进过：建档＋10 天＝09-23（＋3 天）→ agenda
        candidate({ id: 5n, lastEventAt: before(1 * DAY) }), // 到期日 09-29（＋9 天）→ none
      ],
    });

    const summary = await service.scanSeaWarning(NOW);

    expect(summary).toMatchObject({
      scanned: 5,
      rules: 1,
      skippedNoRule: 0,
      skippedNoFreq: 0,
      hits: 4,
    });
    expect(summary.tiers).toEqual({
      overdue: 1,
      alert_manager: 1,
      notify_owner: 1,
      agenda: 1,
      none: 1,
    });
  });

  it('**一条规则都没有** ⇒ 一条都不判（不拿默认天数顶替），全部计入"跳过：无规则"', async () => {
    const { service } = createService({
      rules: [],
      candidates: [candidate({ id: 1n, lastEventAt: before(12 * DAY) })],
    });

    const summary = await service.scanSeaWarning(NOW);

    expect(summary.rules).toBe(0);
    expect(summary.hits).toBe(0);
    expect(summary.skippedNoRule).toBe(1);
    expect(summary.tiers).toEqual({ overdue: 0, alert_manager: 0, notify_owner: 0, agenda: 0, none: 0 });
  });

  it('规则**只有别部门**那一条 ⇒ 该关系"无规则"，不套用别人的天数', async () => {
    const { service } = createService({
      rules: [{ ...GLOBAL_RULE, level: 3, deptId: 99n, followFreqDays: 1 }],
      candidates: [candidate({ id: 1n, lastEventAt: before(12 * DAY) })],
    });

    const summary = await service.scanSeaWarning(NOW);

    expect(summary.skippedNoRule).toBe(1);
    expect(summary.hits).toBe(0);
  });

  it('规则**没配跟进天数** ⇒ 计入"跳过：未配跟进天数"（本片只有触发①，→ domain 文件头 ★）', async () => {
    const { service } = createService({
      rules: [{ ...GLOBAL_RULE, followFreqDays: null }],
      candidates: [candidate({ id: 1n, lastEventAt: before(12 * DAY) })],
    });

    const summary = await service.scanSeaWarning(NOW);

    expect(summary.skippedNoFreq).toBe(1);
    expect(summary.hits).toBe(0);
  });

  it('★★ M9-F：**只有「到期日已过」那一档真掉** —— 其余四档（含"还早"）一律零写', async () => {
    const { service, repository, relation, events, audit } = createService({
      rules: [GLOBAL_RULE],
      candidates: [
        candidate({ id: 1n, lastEventAt: before(12 * DAY) }), // 到期日 09-18（**已过**）⇒ **真掉**
        candidate({ id: 2n, lastEventAt: before(10 * DAY - 3 * HOUR) }), // 到期日 09-20（当天）→ alert_manager
        candidate({ id: 3n, lastEventAt: before(10 * DAY - 20 * HOUR) }), // 到期日 09-21（前 1 天）→ notify_owner
        candidate({ id: 4n, lastEventAt: before(9 * DAY) }), // 到期日 09-21（前 1 天）→ notify_owner
        candidate({ id: 5n, lastEventAt: before(1 * DAY) }), // 到期日 09-29（＋9 天）→ none
      ],
    });

    const summary = await service.scanSeaWarning(NOW);

    // ① 读：规则 ＋ 候选各一次（候选走 C 域出口，不直连别人的表）
    expect(repository.listActiveSeaRules).toHaveBeenCalledTimes(1);
    expect(relation.listSeaWarningCandidates).toHaveBeenCalledTimes(1);
    // ② 写：**只有到期那条** —— 一次掉海出口 ＋ 一条历史行，逐参数钉死
    expect(relation.dropPrivateSeaRelation).toHaveBeenCalledTimes(1);
    expect(relation.dropPrivateSeaRelation).toHaveBeenCalledWith(1n);
    expect(repository.createSeaRecord).toHaveBeenCalledTimes(1);
    expect(repository.createSeaRecord).toHaveBeenCalledWith({
      relationId: 1n,
      ownerId: ME,
      reason: 'follow_timeout', // ← F2 值域内的码（不是自己编的）
      droppedAt: NOW, // ← 用任务传进来的那一刻，不各自读钟
    });
    // ③ 计分：掉 1 条、未掉成 0 条
    expect(summary.dropped).toBe(1);
    expect(summary.dropSkipped).toBe(0);
    // ④ ★ 审计（D-68②）：**任务级一条** —— 系统动作（`operator_id=0`）＋ 批次明细进 `detail`
    expect(audit.recordStandalone).toHaveBeenCalledTimes(1);
    expect(audit.recordStandalone).toHaveBeenCalledWith({
      action: 'sea.drop',
      operator_id: 0n,
      occurred_at: NOW, // ← 与 `job_run_log.run_at` 同源（同一个 now，不各自读钟）
      detail: expect.objectContaining({
        reason: 'follow_timeout',
        dropped: 1,
        relation_ids: ['1'],
      }),
    });
    // ⑤ ⛔ 其余动作一律不碰：另两条触发 / 通知 / 动线 / 承诺级联都不属本片
    expect(repository.markClaimed).not.toHaveBeenCalled();
    expect(relation.claimCompanySeaRelation).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('★ 到期但**没掉成**（C 域出口回 `null`：并发下刚被同事领走）⇒ **不写历史行**、计入 `dropSkipped`', async () => {
    const { service, repository, relation, audit } = createService({
      rules: [GLOBAL_RULE],
      candidates: [candidate({ id: 1n, lastEventAt: before(12 * DAY) })],
      dropResult: null,
    });

    const summary = await service.scanSeaWarning(NOW);

    // 关系压根没掉 ⇒ 就不该有"掉海"这条历史（凭空编业务事实＝本项目一号坑），更不该有审计
    expect(relation.dropPrivateSeaRelation).toHaveBeenCalledWith(1n);
    expect(repository.createSeaRecord).not.toHaveBeenCalled();
    expect(audit.recordStandalone).not.toHaveBeenCalled();
    expect(summary.dropped).toBe(0);
    expect(summary.dropSkipped).toBe(1);
  });

  it('★ 一条都没到期（全在预警档）⇒ **一次都不碰** C 域掉海出口，也**不写审计**（没有增删改就不留痕）', async () => {
    const { service, repository, relation, audit } = createService({
      rules: [GLOBAL_RULE],
      candidates: [candidate({ id: 1n, lastEventAt: before(1 * DAY) })], // ＋9 天 → none
    });

    const summary = await service.scanSeaWarning(NOW);

    expect(relation.dropPrivateSeaRelation).not.toHaveBeenCalled();
    expect(repository.createSeaRecord).not.toHaveBeenCalled();
    expect(audit.recordStandalone).not.toHaveBeenCalled();
    expect(summary.hits).toBe(0);
    expect(summary.dropped).toBe(0);
  });
});

// =============================================================================
// M9-F 规则配置片（→ 接口 §4.14.10 / §5.16）—— 编排：权限 → 校验 → 预告 →（确认才）落库
// =============================================================================
const RULE_NOW = new Date('2026-09-21T12:00:00.000Z');
/** 提交时刻 + 7 天（假时钟钉死，免得用例跟着真实时间漂） */
const EFFECTIVE_ISO = '2026-09-28T12:00:00.000Z';
const EFFECTIVE_AT = new Date(EFFECTIVE_ISO);

/** 规则端点的上下文：`gm` / `admin` 走 `all` 档（不收敛）；经理走 `dept` 档（带管辖部门） */
function ruleContextOf(roleCodes: string[], managedDeptIds: bigint[] = []): RequestContext {
  const type = roleCodes.includes('gm') || roleCodes.includes('admin') ? 'all' : 'dept';
  return {
    employeeId: ME,
    deptIds: [DEPT_ID],
    roleCodes,
    dataScope: { type, deptIds: managedDeptIds },
  };
}

function configRule(overrides: Partial<SeaRuleRowFixture>): SeaRuleRowFixture {
  return {
    id: 1n,
    level: 1,
    dept_id: null,
    product_line_id: null,
    follow_freq_days: 30,
    deal_cycle_days: null,
    stay_days: 60,
    no_progress_max: null,
    effective_from: new Date('2026-09-01T00:00:00.000Z'),
    status: 'active',
    ...overrides,
  };
}

describe('SeaService 公海规则配置（M9-F）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(RULE_NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('`GET` 老板 → **不收敛**（传 `null`），出参带引用名 ＋ `pending` 派生', async () => {
    const { service, repository } = createService({
      configRules: [
        configRule({ id: 1n, level: 1, follow_freq_days: 30 }),
        configRule({
          id: 2n,
          level: 4,
          dept_id: DEPT_ID,
          product_line_id: LINE_ID,
          follow_freq_days: 15,
          effective_from: EFFECTIVE_AT, // 7 天缓冲期内 ⇒ pending
        }),
      ],
    });

    const list = await runWithContext(ruleContextOf(['gm']), () => service.listSeaRules());

    expect(repository.listActiveRulesForConfig).toHaveBeenCalledWith(null);
    expect(list[0]).toEqual({
      id: 1n,
      level: 1,
      dept: null,
      product_line: null,
      follow_freq_days: 30,
      deal_cycle_days: null,
      stay_days: 60,
      no_progress_max: null,
      effective_from: '2026-09-01T00:00:00.000Z',
      status: 'active',
      pending: false,
    });
    // 部门 / 产品线名字走 A 域出口装配（跨域不查对方的表）
    expect(list[1]?.dept).toEqual({ id: DEPT_ID, name: '部门2' });
    expect(list[1]?.product_line).toEqual({ id: LINE_ID, name: '产品线1' });
    expect(list[1]?.pending).toBe(true);
  });

  it('`GET` 经理 → 只收敛到**自己管辖的部门**（L1 / L2 由仓储那边一并可见）', async () => {
    const { service, repository } = createService({ configRules: [configRule({ id: 1n })] });

    await runWithContext(ruleContextOf(['dept_manager'], [DEPT_ID]), () => service.listSeaRules());

    expect(repository.listActiveRulesForConfig).toHaveBeenCalledWith([DEPT_ID]);
  });

  it('`GET` 销售 → **403**，且一次库都没查（不给"看不到但能试"的入口）', async () => {
    const { service, repository } = createService();

    const error = await runWithContext(ruleContextOf(['sale']), () =>
      captureAppError(() => service.listSeaRules()),
    );

    expect(error.httpStatus).toBe(403);
    expect(error.constraint).toBe('sea.rule_read_forbidden');
    expect(repository.listActiveRulesForConfig).not.toHaveBeenCalled();
  });

  it('`GET` 拿不到上下文 → **401**（绝不兜底成"匿名"，那等于把规则配置摊给所有人）', async () => {
    const { service } = createService();

    const error = await captureAppError(() => service.listSeaRules());

    expect(error.httpStatus).toBe(401);
    expect(error.constraint).toBe('sea.no_context');
  });

  it('★ `PUT` 不传 `confirmed` ⇒ **只回预告、零写库**（"先看看影响多大"是这个端点的常态用法）', async () => {
    const { service, repository, relation } = createService({
      rules: [GLOBAL_RULE],
      seaGroups: [
        { deptId: DEPT_ID, productLineId: LINE_ID, count: 7 }, // → 命中新配置的 L3
        { deptId: 99n, productLineId: LINE_ID, count: 100 }, // → 别部门，不受这条规则管
      ],
    });

    const result = await runWithContext(ruleContextOf(['dept_manager'], [DEPT_ID]), () =>
      service.updateSeaRule({ level: 3, dept_id: DEPT_ID.toString(), follow_freq_days: 10 }),
    );

    expect(result).toEqual({
      applied: false,
      affected_customers: 7,
      effective_from: EFFECTIVE_ISO,
      rule: null,
    });
    // 预告与落库用**同一个** `effective_from` 作判定基准（差一个基准就会出现"预告 3、实际 5"）
    expect(repository.listActiveSeaRules).toHaveBeenCalledWith(EFFECTIVE_AT);
    // 计数只在自己的可见部门内取（经理看不到别部门的影响面）
    expect(relation.countPrivateSeaByDeptLine).toHaveBeenCalledWith([DEPT_ID]);
    expect(repository.replaceRuleVersion).not.toHaveBeenCalled();
  });

  it('★ `PUT` `confirmed=true` ⇒ 落库：**插新版本行**（逐参数钉死）＋ 出参 `pending=true`', async () => {
    const { service, repository } = createService({
      rules: [GLOBAL_RULE],
      seaGroups: [{ deptId: DEPT_ID, productLineId: LINE_ID, count: 3 }],
    });

    const result = await runWithContext(ruleContextOf(['gm']), () =>
      service.updateSeaRule({
        level: 4,
        dept_id: DEPT_ID.toString(),
        product_line_id: LINE_ID.toString(),
        follow_freq_days: 15,
        stay_days: 45,
        confirmed: true,
      }),
    );

    expect(repository.replaceRuleVersion).toHaveBeenCalledWith({
      level: 4,
      deptId: DEPT_ID,
      productLineId: LINE_ID,
      followFreqDays: 15,
      dealCycleDays: null, // 没给＝该维度不配（整行覆盖，不做"缺省＝沿用"）
      stayDays: 45,
      noProgressMax: null,
      effectiveFrom: EFFECTIVE_AT, // ＝提交时刻 + 7 天
      operatorId: ME,
    });
    expect(result.applied).toBe(true);
    expect(result.affected_customers).toBe(3);
    expect(result.rule?.id).toBe(99n);
    expect(result.rule?.pending).toBe(true);
    expect(result.rule?.effective_from).toBe(EFFECTIVE_ISO);
  });

  it('`PUT` **层级与 key 搭配错** ⇒ 400（`level=2` 却没给产品线），且不查引用、不落库', async () => {
    const { service, repository, org } = createService();

    const error = await runWithContext(ruleContextOf(['gm']), () =>
      captureAppError(() => service.updateSeaRule({ level: 2, follow_freq_days: 30 })),
    );

    expect(error.httpStatus).toBe(400);
    expect(error.constraint).toBe('sea.rule_scope_inconsistent');
    expect(org.getDeptRefs).not.toHaveBeenCalled();
    expect(repository.replaceRuleVersion).not.toHaveBeenCalled();
  });

  it('`PUT` 经理改**别部门**的规则 ⇒ 403（部门级只归该部门经理），且零写', async () => {
    const { service, repository } = createService();

    const error = await runWithContext(ruleContextOf(['dept_manager'], [DEPT_ID]), () =>
      captureAppError(() =>
        service.updateSeaRule({ level: 3, dept_id: '99', follow_freq_days: 30, confirmed: true }),
      ),
    );

    expect(error.httpStatus).toBe(403);
    expect(error.constraint).toBe('sea.rule_write_forbidden');
    expect(repository.replaceRuleVersion).not.toHaveBeenCalled();
  });

  it('`PUT` 经理改**全局**（L1）⇒ 403（那一档归老板 / 管理员）', async () => {
    const { service } = createService();

    const error = await runWithContext(ruleContextOf(['dept_manager'], [DEPT_ID]), () =>
      captureAppError(() => service.updateSeaRule({ level: 1, follow_freq_days: 30 })),
    );

    expect(error.httpStatus).toBe(403);
  });

  it('`PUT` 部门不存在 ⇒ **400**（人话，不是撞外键冒 500）', async () => {
    const { service, repository } = createService({ deptRefs: [] });

    const error = await runWithContext(ruleContextOf(['gm']), () =>
      captureAppError(() =>
        service.updateSeaRule({ level: 3, dept_id: '9', follow_freq_days: 30, confirmed: true }),
      ),
    );

    expect(error.httpStatus).toBe(400);
    expect(error.constraint).toBe('sea.rule_dept_missing');
    expect(repository.replaceRuleVersion).not.toHaveBeenCalled();
  });

  it('`PUT` 拿不到上下文 → 401（**不落库、不读库**）', async () => {
    const { service, repository } = createService();

    const error = await captureAppError(() =>
      service.updateSeaRule({ level: 1, follow_freq_days: 30, confirmed: true }),
    );

    expect(error.httpStatus).toBe(401);
    expect(repository.replaceRuleVersion).not.toHaveBeenCalled();
  });
});

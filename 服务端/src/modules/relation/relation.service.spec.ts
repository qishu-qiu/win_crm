// =============================================================================
// C 域服务用例（M3-06 ~ M3-11；含 M3-12「并发建同键 → 一成功一 409」）
//
// 判据逐字（《开发计划-V1》）：
//   · M3-06「`createRelation`（本域事务 + 激活唯一）」→「单测：**并发同键 → 一成功一 409**」
//   · M3-07 / M3-08「私海列表（owner = 我）」「公海列表（无 owner）」
//   · M3-10「`PUT /relations/:id`」＋ 数据架构 C1「非灰度必标开发价值 → 422」
//   · M3-11「成员 G/P」＋ C2「一关系一 owner」
//
// ★ 两条路径文案一致（移植 M2 的教训）：预检（日常路径）与 `P2002` 兜底（并发路径）
//   必须输出**同一句人话**。本文件不手抄那句话，而是**拿 `mapPrismaError` 的输出当基准**
//   去断言两条路径 —— 将来改文案只需改 mapper，两处一起跟着变，单测依旧成立。
// =============================================================================
import {
  AppError,
  ErrorCode,
  mapPrismaError,
  runWithContext,
  type EventBus,
  type RequestContext,
} from '../../kernel/index';
import type { CompanyService } from '../company/company.service';
import type { OrgService } from '../org/org.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RelationRepository } from './relation.repository';
import { RelationService } from './relation.service';

const ME = 7n;
const OTHER = 8n;
const COMPANY_ID = 3n;
const DEPT_ID = 2n;
const OTHER_DEPT_ID = 3n;
const LINE_ID = 1n;
const OTHER_LINE_ID = 9n;
const RELATION_ID = 11n;
const MANAGED_DEPT_ID = 5n;

const COMPANY_REF = { id: COMPANY_ID, name: '合肥测试建材有限公司' };
const ME_REF = { id: ME, name: '王海涛' };
const OTHER_REF = { id: OTHER, name: '张三' };

/** 造「真形状」的 P2002（约束名位置＝Prisma 7 ＋ driver adapter 实测形状，→ 废止口径 #29） */
function p2002(constraint: string) {
  return {
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { index: constraint } } } },
    message: `Invalid \`prisma.businessRelation.create()\` invocation: constraint: \`${constraint}\``,
  };
}

interface MemberFixture {
  employee_id: bigint;
  member_type: string;
  source: string | null;
  valid_until: Date | null;
  revoked_at: Date | null;
}

interface RelationFixture {
  id: bigint;
  company_id: bigint;
  dept_id: bigint;
  product_line_id: bigint;
  stage_id: number;
  urgency: string;
  value_tier: string | null;
  customer_level: string | null;
  competition: string | null;
  competitor_id: bigint | null;
  sea_status: string;
  last_event_at: Date | null;
  next_action_hint: string | null;
  merged_into: bigint | null;
  created_at: Date;
  updated_at: Date;
  members: MemberFixture[];
}

function ownerMember(employeeId: bigint): MemberFixture {
  return {
    employee_id: employeeId,
    member_type: 'owner',
    source: null,
    valid_until: null,
    revoked_at: null,
  };
}

function relationFixture(overrides: Partial<RelationFixture> = {}): RelationFixture {
  return {
    id: RELATION_ID,
    company_id: COMPANY_ID,
    dept_id: DEPT_ID,
    product_line_id: LINE_ID,
    stage_id: 1,
    urgency: 'gray',
    value_tier: null,
    customer_level: null,
    competition: null,
    competitor_id: null,
    sea_status: 'private',
    last_event_at: null,
    next_action_hint: null,
    merged_into: null,
    created_at: new Date('2026-09-15T09:00:00Z'),
    updated_at: new Date('2026-09-15T09:00:00Z'),
    members: [ownerMember(ME)],
    ...overrides,
  };
}

/** 分页仓储的返回形状（M6-07 起列表方法返回 `{ rows, total }`，→ `relation.repository.ts`） */
function pageOf(rows: RelationFixture[]): { rows: RelationFixture[]; total: number } {
  return { rows, total: rows.length };
}

interface FakeOptions {
  /** 预检命中的活跃关系（`null` ＝ 没撞） */
  active?: RelationFixture | null;
  /** `findRelationById` 返回的行 */
  row?: RelationFixture | null;
  /** 显式「查不到这条关系」（`row: null` 会被 `??` 兜成默认值，故单列一个开关） */
  rowMissing?: boolean;
  /** 列表返回的行 */
  rows?: RelationFixture[];
  /** 已存在的成员（重复授予用） */
  member?: { id: bigint; revoked_at: Date | null } | null;
  competitor?: { id: bigint; name: string } | null;
  /** 第 N 次 `createRelation` 抛这个错（并发用例用） */
  failCreateOnCall?: { call: number; error: unknown };
  /** 被 @求助者的部门集合（判同部门） */
  mentionedDeptIds?: bigint[];
  /** F-01：`findCompanySeaRelation` 返回的公海关系（**不给**＝默认造一条待领公海关系） */
  seaRow?: RelationFixture | null;
  /** F-01：原子认领 `updateMany` 的影响行数（`0` ＝ 并发被抢，→ 409） */
  claimCount?: number;
  /** D-61 桥③：该公司下**可见**的关系 id（三个范围方法都回它；不给＝没有可见关系） */
  visibleRelationIds?: bigint[];
  /** D-28：我可见的**公司** id（`listVisibleCompanyIds` 的回值；不给＝没有可见公司） */
  visibleCompanyIds?: bigint[];
  /** M9-F 掉海：在位 owner 成员（缺省＝有一条；**显式 `null`** ＝ 没有在位 owner） */
  activeOwner?: { employee_id: bigint } | null;
  /** M9-F 掉海：条件 UPDATE 的影响行数（`0` ＝ 并发下刚被领走） */
  dropCount?: number;
  /** 掉海锚点行（两个出口共用：定时任务的全量扫 ＋ 列表页按 id 取） */
  seaWarningRows?: SeaWarningRowFixture[];
  /**
   * D-74：该部门**承接的产品线 id**（A 域出口 `getDeptProductLineIds` 的回值）。
   * 缺省＝只承接 `LINE_ID`；显式 `[]` ＝ **一条都不承接**（≠ 不限制）。
   */
  servedLineIds?: bigint[];
}

/** 掉海锚点行的**真实形状**（列名照仓储 select：三列锚点 ＋ 在位 owner 成员） */
interface SeaWarningRowFixture {
  id: bigint;
  dept_id: bigint;
  product_line_id: bigint;
  last_event_at: Date | null;
  created_at: Date;
  members: { employee_id: bigint }[];
}

function seaWarningRowFixture(overrides: Partial<SeaWarningRowFixture> = {}): SeaWarningRowFixture {
  return {
    id: RELATION_ID,
    dept_id: DEPT_ID,
    product_line_id: LINE_ID,
    last_event_at: null,
    created_at: new Date('2026-09-10T09:00:00Z'),
    members: [ownerMember(ME)],
    ...overrides,
  };
}

function createService(options: FakeOptions = {}) {
  let createCalls = 0;
  const repository = {
    findActiveRelation: jest.fn(async () => options.active ?? null),
    createRelation: jest.fn(async () => {
      createCalls += 1;
      if (options.failCreateOnCall?.call === createCalls) throw options.failCreateOnCall.error;
      // ⚠ 与真实阶段一致：这次 RETURNING 发生在**写 owner 成员之前**，`members` 必须是空的。
      //   若服务端偷懒拿它去装配引用，`owner` 就会变成 null（真库实测踩过）——
      //   假对象若在这里「好心」带上成员，就永远抓不出这个 bug。
      return relationFixture({ members: [] });
    }),
    // 带参签名：单测要能读到**实际传进去的列**（如 @求助默认 7 天的 `valid_until`）
    createMember: jest.fn(async (data: { valid_until?: Date }) => ({ id: 1n, ...data })),
    findRelationById: jest.fn(async () =>
      options.rowMissing === true ? null : (options.row ?? relationFixture()),
    ),
    findMember: jest.fn(async () => options.member ?? null),
    // F-01 公海「领取到私海」（→ 接口 §4.5 `POST /sea/company/:id/claim`）
    // 定位：默认给一条**待领的公海关系**（`members` 空 —— 公海理应没有在位 owner）
    findCompanySeaRelation: jest.fn(async () =>
      options.seaRow === undefined
        ? relationFixture({ sea_status: 'company_sea', members: [] })
        : options.seaRow,
    ),
    // 原子认领：真实实现返回 `updateMany` 的 `{count}`（`0` ＝ 被同事抢走）
    claimSeaRelation: jest.fn(async () => ({ count: options.claimCount ?? 1 })),
    revokeActiveOwner: jest.fn(async () => ({ count: 0 })),
    // M9-F 真掉海：取在位 owner（缺省＝有一条；显式 `null` ＝ 没有在位 owner）
    findActiveOwnerMember: jest.fn(async () =>
      options.activeOwner === undefined ? { employee_id: ME } : options.activeOwner,
    ),
    // M9-F 真掉海：条件 UPDATE（真实实现返回 `updateMany` 的 `{count}`；`0` ＝ 并发下刚被领走）
    dropSeaRelation: jest.fn(async () => ({ count: options.dropCount ?? 1 })),
    reviveMember: jest.fn(async () => undefined),
    createStageLog: jest.fn(async (data: Record<string, unknown>) => data),
    findCompetitorById: jest.fn(async () => options.competitor ?? null),
    // ⚠ 假件必须**照真实形状**给 `{ rows, total }`：给裸数组时 service 解构出 `undefined`，
    //   用例会假红（→ 铁律坑 16「假红先修假件，再怀疑被测代码」）
    listPrivateRelationsOfEmployee: jest.fn(async () => pageOf(options.rows ?? [])),
    listPrivateRelationsOfDepts: jest.fn(async () => pageOf(options.rows ?? [])),
    listPrivateRelations: jest.fn(async () => pageOf(options.rows ?? [])),
    listSeaRelationsOfDepts: jest.fn(async () => pageOf(options.rows ?? [])),
    listSeaRelations: jest.fn(async () => pageOf(options.rows ?? [])),
    // D-61 桥③：某公司下**可见**的关系 id（只回 id，故形状是 `[{id}]`，不是 `{rows,total}`）
    listVisibleRelationIdsOfCompany: jest.fn(async () =>
      (options.visibleRelationIds ?? []).map((id) => ({ id })),
    ),
    listVisibleRelationIdsOfCompanyOfDepts: jest.fn(async () =>
      (options.visibleRelationIds ?? []).map((id) => ({ id })),
    ),
    listVisibleRelationIdsOfCompanyOfEmployee: jest.fn(async () =>
      (options.visibleRelationIds ?? []).map((id) => ({ id })),
    ),
    // D-28：我可见的**公司**集合（只回 company_id 一列，形状 `[{company_id}]`）
    listVisibleCompanyIds: jest.fn(async () =>
      (options.visibleCompanyIds ?? []).map((company_id) => ({ company_id })),
    ),
    // 掉海锚点：定时任务那条**全量扫** ＋ 列表页那条**按 id 取**（两个出口形状同源）
    listPrivateSeaCandidatesForWarning: jest.fn(async () => options.seaWarningRows ?? []),
    findSeaWarningCandidatesByIds: jest.fn(async () => options.seaWarningRows ?? []),
    updateRelation: jest.fn(async () => options.row ?? relationFixture()),
  };
  const org = {
    getEmployeeRefs: jest.fn(async (ids: readonly bigint[]) =>
      [ME_REF, OTHER_REF].filter((ref) => ids.includes(ref.id)),
    ),
    getDeptRefs: jest.fn(async (ids: readonly bigint[]) =>
      [
        { id: DEPT_ID, name: '销售一部' },
        { id: MANAGED_DEPT_ID, name: '华北大区' },
      ].filter((ref) => ids.includes(ref.id)),
    ),
    // 第二条线（`OTHER_LINE_ID`）**存在但该部门不承接** —— 专门用来把「存在性」与「组合」分开测
    getProductLineRefs: jest.fn(async (ids: readonly bigint[]) =>
      [
        { id: LINE_ID, name: '标准线', color_key: 'blue' },
        { id: OTHER_LINE_ID, name: '增值线', color_key: 'green' },
      ].filter((ref) => ids.includes(ref.id)),
    ),
    getEmployeeDeptIds: jest.fn(async () => options.mentionedDeptIds ?? [DEPT_ID]),
    // D-74：该部门承接的产品线（→ 架构 §7.2「可建产品线范围」）
    getDeptProductLineIds: jest.fn(async () => options.servedLineIds ?? [LINE_ID]),
  };
  const company = {
    getCompanyRefs: jest.fn(async (ids: readonly bigint[]) =>
      ids.includes(COMPANY_ID) ? [COMPANY_REF] : [],
    ),
  };
  // 事务：直接把回调跑起来，并给它一个 tx 标记（本域只用它区分「在事务里」）
  const prisma = { $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })) };
  // 领域事件总线（M4-11）：激活成功后在**事务之外** publish `RelationCreated`
  //  —— 单测只关心「发了什么」，落库是 D 域订阅方的事（→ `engine-event.subscriber.ts`）
  const events = { publish: jest.fn(async () => undefined) };
  const audit = { recordStandalone: jest.fn(async () => undefined) } as unknown as never;

  const service = new RelationService(
    repository as unknown as RelationRepository,
    org as unknown as OrgService,
    company as unknown as CompanyService,
    prisma as unknown as PrismaService,
    events as unknown as EventBus,
    audit,
  );

  return { service, repository, org, company, prisma, events };
}

function contextOf(
  options: {
    type?: RequestContext['dataScope']['type'];
    roleCodes?: string[];
    deptIds?: bigint[];
    managedDeptIds?: bigint[];
  } = {},
): RequestContext {
  return {
    employeeId: ME,
    deptIds: options.deptIds ?? [DEPT_ID],
    roleCodes: options.roleCodes ?? ['sale'],
    dataScope: { type: options.type ?? 'self', deptIds: options.managedDeptIds ?? [] },
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

const CREATE_DTO = {
  company_id: COMPANY_ID.toString(),
  dept_id: DEPT_ID.toString(),
  product_line_id: LINE_ID.toString(),
};

describe('RelationService（M3-06 ~ M3-11）', () => {
  describe('createRelation：激活（关系 ＋ owner 成员同事务）', () => {
    it('成功：事务内写「关系 ＋ owner 成员」，owner ＝ **发起人自己**，出参装配跨域引用', async () => {
      const { service, repository, prisma } = createService();

      const result = await runWithContext(contextOf(), () => service.createRelation(CREATE_DTO));

      // ★ 出参必须来自**写完之后读回的那一次**（上一行 `createRelation` 的 RETURNING 里没有成员）
      expect(repository.findRelationById).toHaveBeenCalledWith(RELATION_ID);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(repository.createRelation).toHaveBeenCalledWith(
        {
          company_id: COMPANY_ID,
          dept_id: DEPT_ID,
          product_line_id: LINE_ID,
          created_by: ME,
        },
        { tx: true },
      );
      expect(repository.createMember).toHaveBeenCalledWith(
        {
          relation_id: RELATION_ID,
          employee_id: ME,
          member_type: 'owner',
          added_by: ME,
        },
        { tx: true },
      );
      expect(result.owner).toEqual(ME_REF);
      expect(result.company).toEqual(COMPANY_REF);
      expect(result.dept).toEqual({ id: DEPT_ID, name: '销售一部' });
      // 产品线引用**必须带固定配色键**（→ 需求 §13.3 / 接口 §5.6；漏了就该红）
      expect(result.product_line).toEqual({ id: LINE_ID, name: '标准线', color_key: 'blue' });
      expect(result.sea_status).toBe('private');
    });

    it('销售在**别的部门**激活 → 403，且**一个写操作都没发**（范围先拦）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf({ deptIds: [DEPT_ID] }), () =>
          service.createRelation({ ...CREATE_DTO, dept_id: OTHER_DEPT_ID.toString() }),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.out_of_scope');
      expect(repository.createRelation).not.toHaveBeenCalled();
      expect(repository.findActiveRelation).not.toHaveBeenCalled();
    });

    it('业务关系**只读**角色（管理员）→ 403 `relation.read_only`（档位是 `all` 也不给写）', async () => {
      const { service } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf({ type: 'all', roleCodes: ['admin'] }), () =>
          service.createRelation(CREATE_DTO),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.read_only');
    });

    it('公司不存在（跨域取不到引用）→ 400 参数错误', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.createRelation({ ...CREATE_DTO, company_id: '999' }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('relation.company_missing');
      expect(repository.createRelation).not.toHaveBeenCalled();
    });

    it('★ 「部门 × 产品线」不是承接组合 → **422 / 20409**（→ 架构 §7.2「可建产品线范围」· D-74）', async () => {
      // 产品线**存在**（跨域取得到引用）、部门也在我可建范围内 —— **错的是组合**（该部门不承接这条线）
      const { service, repository } = createService({ servedLineIds: [LINE_ID] });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.createRelation({ ...CREATE_DTO, product_line_id: OTHER_LINE_ID.toString() }),
        ),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCode.PRODUCT_LINE_NOT_SERVED);
      expect(error.constraint).toBe('relation.product_line_not_served');
      expect(repository.createRelation).not.toHaveBeenCalled();
    });

    it('★ 该部门**一条线都没承接**（空集）→ 同样 422：**空集 ≠ 不限制**，不默认放行', async () => {
      const { service } = createService({ servedLineIds: [] });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.createRelation(CREATE_DTO)),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.constraint).toBe('relation.product_line_not_served');
    });

    it('★ 承接组合成立 → 放行（**与录入页下拉同源**：部门承接哪条，这里就放行哪条）', async () => {
      const { service, repository } = createService({ servedLineIds: [LINE_ID, OTHER_LINE_ID] });

      await runWithContext(contextOf(), () =>
        service.createRelation({ ...CREATE_DTO, product_line_id: OTHER_LINE_ID.toString() }),
      );

      expect(repository.createRelation).toHaveBeenCalledTimes(1);
    });

    it('预检命中同键（占位行是**私海**）→ **409 / 20401**，人话＝「已有归属」那句', async () => {
      const { service, repository } = createService({ active: relationFixture() });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.createRelation(CREATE_DTO)),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.code).toBe(ErrorCode.RELATION_DUPLICATED);
      expect(error.constraint).toBe('uk_active_rel');
      expect(error.message).toBe(mapPrismaError(p2002('uk_active_rel'))?.message);
      expect(repository.createRelation).not.toHaveBeenCalled();
    });

    it('★ 预检命中的是**公海行** → 人话改成「请直接领取」（**分档** · D-53），不是「已有归属」', async () => {
      const { service, repository } = createService({
        active: relationFixture({ sea_status: 'company_sea', members: [] }),
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.createRelation(CREATE_DTO)),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.code).toBe(ErrorCode.RELATION_DUPLICATED);
      expect(error.constraint).toBe('uk_active_rel');
      // ★ 分两句的**理由**：两句指向的下一步动作不同（转交/协同 vs 领取）——
      //   挤成一句的话，销售会去点「转交」，而正确动作是去公海把这条**领回来**（→ 需求 §6.3）
      expect(error.message).toContain('领取');
      expect(error.message).not.toBe(mapPrismaError(p2002('uk_active_rel'))?.message);
      expect(repository.createRelation).not.toHaveBeenCalled();
    });

    // ===== M3-12 判据本体 =====
    it('**并发建同键：一成功一 409 / 20401**（预检都漏过，第二条靠 `uk_active_rel` 兜底）', async () => {
      const { service } = createService({
        active: null,
        failCreateOnCall: { call: 2, error: p2002('uk_active_rel') },
      });

      const results = await runWithContext(contextOf(), () =>
        Promise.allSettled([service.createRelation(CREATE_DTO), service.createRelation(CREATE_DTO)]),
      );

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');

      const rejected = results[1] as PromiseRejectedResult;
      const error = rejected.reason as AppError;
      expect(error.httpStatus).toBe(409);
      expect(error.code).toBe(ErrorCode.RELATION_DUPLICATED);
      // ★ 并发路径与预检路径**同一句人话** —— 两条都走 service 的 `activeSlotConflict`（同源分档）；
      //   本假件的 `findActiveRelation` 回 `null`（重查不到占位行）⇒ 退回 mapper 那句兜底
      expect(error.message).toBe(mapPrismaError(p2002('uk_active_rel'))?.message);
    });
  });

  describe('listRelations：私海 / 公海（范围收敛 ＋ 分页）', () => {
    it('私海 · 销售 → 走「我参与」那条查询，**不调**其它范围方法', async () => {
      const { service, repository } = createService({ rows: [relationFixture()] });

      const page = await runWithContext(contextOf(), () => service.listRelations('private'));

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledTimes(1);
      expect(repository.listPrivateRelationsOfDepts).not.toHaveBeenCalled();
      expect(repository.listPrivateRelations).not.toHaveBeenCalled();
      expect(page.list).toHaveLength(1);
      expect(page.list[0]?.owner).toEqual(ME_REF);
    });

    it('私海 · 经理 → 只查**管辖部门**', async () => {
      const { service, repository } = createService();

      await runWithContext(
        contextOf({ type: 'dept', roleCodes: ['dept_manager'], managedDeptIds: [MANAGED_DEPT_ID] }),
        () => service.listRelations('private'),
      );

      expect(repository.listPrivateRelationsOfDepts).toHaveBeenCalledWith(
        [MANAGED_DEPT_ID],
        {}, // 没给筛选 → 空条件（**不是**空数组，空数组会变成 `IN ()`）
        expect.objectContaining({ page: 1, pageSize: 20, skip: 0, take: 20 }),
        // D-07：第 4 个参数＝排序 / 关键词选项（内容由本 describe 末尾的专项用例覆盖）
        expect.anything(),
      );
      expect(repository.listPrivateRelations).not.toHaveBeenCalled();
    });

    it('私海 · 总经理 → 不过滤（`all`）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf({ type: 'all', roleCodes: ['gm'] }), () =>
        service.listRelations('private'),
      );

      expect(repository.listPrivateRelations).toHaveBeenCalledTimes(1);
    });

    it('公海 · 销售 → 查**我所属部门**的公海（部门公海＝本部门的关系集合，→ C1）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf({ deptIds: [DEPT_ID, MANAGED_DEPT_ID] }), () =>
        service.listRelations('sea'),
      );

      expect(repository.listSeaRelationsOfDepts).toHaveBeenCalledWith(
        [DEPT_ID, MANAGED_DEPT_ID],
        {},
        expect.objectContaining({ page: 1, pageSize: 20 }),
        // D-07：第 4 个参数＝排序 / 关键词选项
        expect.anything(),
      );
      expect(repository.listSeaRelations).not.toHaveBeenCalled();
    });

    it('公海 · **交付 / 客服 → 403**（§2.2「不进公海」），且不查任何列表', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf({ type: 'serving', roleCodes: ['delivery'] }), () =>
          service.listRelations('sea'),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.sea.denied');
      expect(repository.listSeaRelationsOfDepts).not.toHaveBeenCalled();
      expect(repository.listSeaRelations).not.toHaveBeenCalled();
    });

    it('引用取不到时给 `null`：公司被逻辑删（跨域出口只回未删行）→ `company: null`，**不编名字**', async () => {
      const { service } = createService({
        rows: [relationFixture({ company_id: 999n })],
      });

      const page = await runWithContext(contextOf(), () => service.listRelations('private'));

      expect(page.list[0]?.company).toBeNull();
    });

    // ===== M6-07 判据：分页形态 ＋ 入参透传（→ 接口 §2.3 / §2.7）=====

    it('分页：`page/pageSize` 原样落到仓储的 `skip/take`（第 2 页、每页 1 条 → skip 1）', async () => {
      const { service, repository } = createService({
        rows: [relationFixture(), relationFixture({ id: 12n })],
      });

      const page = await runWithContext(contextOf(), () =>
        service.listRelations('private', { page: 2, pageSize: 1 }),
      );

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        {},
        expect.objectContaining({ page: 2, pageSize: 1, skip: 1, take: 1 }),
        // D-07：第 5 个参数＝排序 / 关键词选项
        expect.anything(),
      );
      // ⚠ `total` **不来自本页行数**：它是仓储给的**全量**计数（桩件＝2 行 → total 2，
      //   而本页只回 1 行才是真实分页的样子；此处桩件不受 take 约束，故只钉字段与取值口径）
      expect(page).toEqual({ list: expect.any(Array), total: 2, page: 2, page_size: 1 });
    });

    it('分页：不传即默认第 1 页、每页 20（→ §2.7「默认 1 / 默认 20」）', async () => {
      const { service } = createService({ rows: [relationFixture()] });

      const page = await runWithContext(contextOf(), () => service.listRelations('private'));

      expect(page.page).toBe(1);
      expect(page.page_size).toBe(20);
      expect(page.total).toBe(1);
    });

    it('分页：`pageSize` 超上限 → **夹紧到 100 而不报错**（归一化只在 kernel 一处，→ §2.7）', async () => {
      const { service, repository } = createService({ rows: [] });

      await runWithContext(contextOf(), () =>
        service.listRelations('private', { page: 1, pageSize: 999 }),
      );

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        {},
        expect.objectContaining({ pageSize: 100, take: 100 }),
        // D-07：第 5 个参数＝排序 / 关键词选项
        expect.anything(),
      );
    });

    it('★ D-07：排序 / 关键词**原样透传**给仓储（翻译成 Prisma 排序是仓储的事，→ 架构 §5.4）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf({}), () =>
        service.listRelations('private', {
          orderField: 'last_event_at',
          desc: false,
          keyword: '  科技  ',
        }),
      );

      // ⚠ `keyword` **不在这里 trim**：trim 与空值判定都在仓储的 `keywordWhereOf`（一处收口）
      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        {},
        expect.anything(),
        { orderField: 'last_event_at', desc: false, keyword: '  科技  ' },
      );
    });

    it('★ D-07：三个新参数都不给 → options 各项 `undefined`（**默认值只在仓储一处定**：`id desc` / 不筛关键词）', async () => {
      const { service, repository } = createService();

      await runWithContext(contextOf({}), () => service.listRelations('private'));

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        {},
        expect.anything(),
        { orderField: undefined, desc: undefined, keyword: undefined },
      );
    });

    // ===== P-01 判据：筛选（视图 / 紧迫档）→ 落到仓储的复合条件（2026-09-16 拍板）=====

    it('筛选：`view=following` → **阶段 1~5**（判定在 domain，service 只翻译不判断）', async () => {
      const { service, repository } = createService({ rows: [] });

      await runWithContext(contextOf(), () =>
        service.listRelations('private', { view: 'following' }),
      );

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        { stages: [1, 2, 3, 4, 5] },
        expect.any(Object),
        // D-07：第 5 个参数＝排序 / 关键词选项
        expect.anything(),
      );
    });

    it('筛选：紧迫档多选落到 `urgencies`；`view=all` **不带**阶段条件', async () => {
      const { service, repository } = createService({ rows: [] });

      await runWithContext(contextOf(), () =>
        service.listRelations('private', { view: 'all', urgencies: ['weekly', 'gray'] }),
      );

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        { urgencies: ['weekly', 'gray'] },
        expect.any(Object),
        // D-07：第 5 个参数＝排序 / 关键词选项
        expect.anything(),
      );
    });

    it('筛选：**不传就是不过滤** —— 给空条件（空数组会变成 `IN ()`，一条都不返回）', async () => {
      const { service, repository } = createService({ rows: [] });

      await runWithContext(contextOf(), () =>
        service.listRelations('private', { view: 'all', urgencies: [''] }),
      );

      expect(repository.listPrivateRelationsOfEmployee).toHaveBeenCalledWith(
        ME,
        expect.any(Date),
        {},
        expect.any(Object),
        // D-07：第 5 个参数＝排序 / 关键词选项
        expect.anything(),
      );
    });
  });

  describe('updateRelation：改属性（非灰度必标开发价值）', () => {
    it('非灰度且未标开发价值 → **422 / 20403**，且不落库', async () => {
      const { service, repository } = createService({ row: relationFixture({ urgency: 'gray' }) });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.updateRelation('11', { urgency: 'weekly' })),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCode.REQUIRED_MISSING);
      expect(error.constraint).toBe('relation.value_tier_required');
      expect(repository.updateRelation).not.toHaveBeenCalled();
    });

    it('只改 urgency、而库里**已标** `high` → 放行（判的是合并后的最终态）', async () => {
      const { service, repository } = createService({
        row: relationFixture({ urgency: 'gray', value_tier: 'high' }),
      });

      await runWithContext(contextOf(), () => service.updateRelation('11', { urgency: 'weekly' }));

      expect(repository.updateRelation).toHaveBeenCalledWith(
        RELATION_ID,
        expect.objectContaining({ urgency: 'weekly', updated_by: ME }),
      );
    });

    it('别人的关系（同部门但不是我的）→ 403：**同部门可见 ≠ 可改**', async () => {
      const { service, repository } = createService({
        row: relationFixture({ members: [ownerMember(OTHER)] }),
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.updateRelation('11', { urgency: 'gray' })),
      );

      expect(error.httpStatus).toBe(403);
      expect(repository.updateRelation).not.toHaveBeenCalled();
    });

    it('`competitor_id` 不在名册里 → 400（先查再写，免得外键报 500）', async () => {
      const { service } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.updateRelation('11', { competitor_id: '888' }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('relation.competitor_missing');
    });
  });

  describe('addMember：成员（一关系一 owner）', () => {
    it('**加第二 owner → 409**，人话与 `mapPrismaError` 的 `uk_owner` **逐字一致**', async () => {
      const { service, repository } = createService({
        row: relationFixture({ members: [ownerMember(OTHER)] }),
      });

      const error = await captureAppError(() =>
        runWithContext(contextOf({ roleCodes: ['gm'], type: 'all' }), () =>
          service.addMember('11', { employee_id: ME.toString(), member_type: 'owner' }),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.constraint).toBe('uk_owner');
      expect(error.message).toBe(mapPrismaError(p2002('uk_owner'))?.message);
      expect(repository.createMember).not.toHaveBeenCalled();
    });

    it('`ask_help`（@求助）**跨部门 → 422 / 20407**（→ 需求 §4.3 / 废止口径 #10；码值 2026-09-15 补），不落库', async () => {
      const { service, repository } = createService({ mentionedDeptIds: [OTHER_DEPT_ID] });

      const error = await captureAppError(() =>
        runWithContext(contextOf({ deptIds: [DEPT_ID] }), () =>
          service.addMember('11', {
            employee_id: OTHER.toString(),
            member_type: 'collaborator',
            source: 'ask_help',
          }),
        ),
      );

      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCode.ASK_HELP_CROSS_DEPT);
      expect(error.constraint).toBe('relation.ask_help.cross_dept');
      expect(repository.createMember).not.toHaveBeenCalled();
    });

    it('`ask_help` 同部门且未给 `valid_until` → 落库时按 C2 默认写 **7 天**', async () => {
      const { service, repository } = createService({ mentionedDeptIds: [DEPT_ID] });
      const before = Date.now();

      await runWithContext(contextOf({ deptIds: [DEPT_ID] }), () =>
        service.addMember('11', {
          employee_id: OTHER.toString(),
          member_type: 'collaborator',
          source: 'ask_help',
        }),
      );

      const passed = repository.createMember.mock.calls[0]?.[0];
      const days = Math.round(
        ((passed?.valid_until?.getTime() ?? 0) - before) / (24 * 60 * 60 * 1000),
      );
      expect(days).toBe(7);
    });

    it('协同人缺 `source` → 400 参数错误', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.addMember('11', { employee_id: OTHER.toString(), member_type: 'collaborator' }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('relation.member.source_required');
      expect(repository.createMember).not.toHaveBeenCalled();
    });

    it('重复授予（已在关系中）→ 409，且**不复用** `uk_member` 的兜底文案', async () => {
      const { service } = createService({ member: { id: 3n, revoked_at: null } });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.addMember('11', {
            employee_id: OTHER.toString(),
            member_type: 'collaborator',
            source: 'collaborate',
          }),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.message).toBe('该成员已在关系中');
    });

    it('员工不存在 → 400（跨域引用取不到）', async () => {
      const { service, repository } = createService();

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () =>
          service.addMember('11', { employee_id: '999', member_type: 'owner' }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('relation.employee_missing');
      expect(repository.createMember).not.toHaveBeenCalled();
    });
  });

  describe('详情 / 成员列表：读权限（只读角色也能看）', () => {
    it('我 owner 的关系 → 详情可读，含 `members`', async () => {
      const { service } = createService({ row: relationFixture() });

      const detail = await runWithContext(contextOf(), () => service.getRelation('11'));

      expect(detail.members).toHaveLength(1);
      expect(detail.members[0]?.member_type).toBe('owner');
      expect(detail.members[0]?.employee).toEqual(ME_REF);
    });

    it('管理员（只读）**能读**详情 —— 只读 ≠ 不可见（→ §2.2）', async () => {
      const { service } = createService({ row: relationFixture({ members: [ownerMember(OTHER)] }) });

      const detail = await runWithContext(contextOf({ type: 'all', roleCodes: ['admin'] }), () =>
        service.getRelation('11'),
      );

      expect(detail.id).toBe(RELATION_ID);
    });

    it('别人的私海（我不是 owner 也不是协同）→ 403', async () => {
      const { service } = createService({ row: relationFixture({ members: [ownerMember(OTHER)] }) });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.getRelation('11')),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.out_of_scope');
    });

    it('关系不存在 → 400 参数错误', async () => {
      const { service } = createService({ rowMissing: true });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.getRelation('999')),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('relation.not_found');
    });
  });

  // ===========================================================================
  // F-01 公海「领取到私海」（→ 接口 §4.5 `POST /sea/company/:id/claim`；D-33）
  //
  // 这一批钉的是 **C 域出口**的三件事：① 原子认领（条件 UPDATE，`count===1` 才算抢到）
  //   ② owner 成员切换（撤在位 → 复活或插入）③ 阶段回 1 ＋ 留痕。
  // ⚠ 「open 承诺转新 owner」**不在这里**：`commitment` 属 D 域，而 F / D 同层禁互相依赖
  //   （架构 §3）⇒ 走领域事件 `RelationClaimed`（片 2 落 F 域端点时同批）。
  // ===========================================================================
  describe('claimCompanySeaRelation：公海「领取到私海」（F-01）', () => {
    const CLAIM_INPUT = { companyId: COMPANY_ID, deptId: DEPT_ID, productLineId: LINE_ID };
    /** 一条待领的公海关系（`members` 空 —— 公海理应没有在位 owner） */
    const SEA_ROW = relationFixture({ sea_status: 'company_sea', members: [] });

    it('成功：条件 UPDATE ＋ 撤在位 owner ＋ 插入 owner 成员，**同一事务**', async () => {
      const { service, repository, prisma } = createService({ seaRow: SEA_ROW });

      const result = await runWithContext(contextOf(), () =>
        service.claimCompanySeaRelation(CLAIM_INPUT),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // ① 原子认领：`stageId` 与 `sea_status` 一起改（不拆两条语句，→ 仓储注释）
      expect(repository.claimSeaRelation).toHaveBeenCalledWith(
        RELATION_ID,
        { employeeId: ME, stageId: 1 },
        { tx: true },
      );
      // ② owner 成员：先撤在位，再插入（此人此前不是 owner）
      expect(repository.revokeActiveOwner).toHaveBeenCalledWith(RELATION_ID, ME, { tx: true });
      expect(repository.createMember).toHaveBeenCalledWith(
        { relation_id: RELATION_ID, employee_id: ME, member_type: 'owner', added_by: ME },
        { tx: true },
      );
      expect(repository.reviveMember).not.toHaveBeenCalled();
      // ③ 上一轮已在阶段 1 ⇒ 不写留痕（避免无信息的噪声行）
      expect(repository.createStageLog).not.toHaveBeenCalled();
      // 出参＝**写完之后读回**那一趟装配的列表项（`owner` 必须是刚写下的那个人 ——
      // 拿事务里的返回值装配会得到 `owner: null`，→ 真库踩过的坑）
      expect(repository.findRelationById).toHaveBeenCalledWith(RELATION_ID);
      expect(result.prevStage).toBe(1);
      expect(result.prevOwnerId).toBeNull();
      expect(result.relation.owner).toEqual(ME_REF);
      expect(result.relation.sea_status).toBe('private');
    });

    it('`dept_id` 指向的部门不存在 → 400（跨域取引用取不到），且**不去定位**', async () => {
      const { service, repository } = createService({ seaRow: SEA_ROW });

      const error = await captureAppError(() =>
        runWithContext(contextOf({ type: 'all', roleCodes: ['gm'] }), () =>
          service.claimCompanySeaRelation({ ...CLAIM_INPUT, deptId: 9n }),
        ),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('relation.dept_missing');
      expect(repository.findCompanySeaRelation).not.toHaveBeenCalled();
    });

    it('**曾当过 owner 的人领回** → 走 `reviveMember`（`uk_member` 不含 `revoked_at`，INSERT 必撞）', async () => {
      const { service, repository } = createService({
        seaRow: SEA_ROW,
        member: { id: 9n, revoked_at: new Date('2026-09-01T00:00:00Z') },
      });

      await runWithContext(contextOf(), () => service.claimCompanySeaRelation(CLAIM_INPUT));

      expect(repository.reviveMember).toHaveBeenCalledWith(
        9n,
        { added_by: ME, added_at: expect.any(Date) },
        { tx: true },
      );
      expect(repository.createMember).not.toHaveBeenCalled();
    });

    it('上一轮不在阶段 1 → 写一行阶段留痕（`normal` ＋ **无 reason**，不新造 reason 码）', async () => {
      const { service, repository } = createService({
        seaRow: relationFixture({ sea_status: 'company_sea', stage_id: 4, members: [] }),
      });

      const result = await runWithContext(contextOf(), () =>
        service.claimCompanySeaRelation(CLAIM_INPUT),
      );

      expect(repository.createStageLog).toHaveBeenCalledWith(
        {
          relation_id: RELATION_ID,
          from_stage: 4,
          to_stage: 1,
          action: 'normal',
          reason: null,
          operator_id: ME,
        },
        { tx: true },
      );
      expect(result.prevStage).toBe(4);
    });

    it('**并发被抢**（条件 UPDATE 影响 0 行）→ 409 `sea.claim_conflict`，且**一步都不往下走**', async () => {
      const { service, repository } = createService({ seaRow: SEA_ROW, claimCount: 0 });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.claimCompanySeaRelation(CLAIM_INPUT)),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.constraint).toBe('sea.claim_conflict');
      // 抢不到就不该再动成员 / 阶段（半截状态比失败更糟）
      expect(repository.revokeActiveOwner).not.toHaveBeenCalled();
      expect(repository.createMember).not.toHaveBeenCalled();
      expect(repository.createStageLog).not.toHaveBeenCalled();
    });

    it('定位不到可领的关系（本就无 / 刚被领走）→ 400 `sea.relation_not_claimed`', async () => {
      const { service, repository } = createService({ seaRow: null });

      const error = await captureAppError(() =>
        runWithContext(contextOf(), () => service.claimCompanySeaRelation(CLAIM_INPUT)),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('sea.relation_not_claimed');
      expect(repository.claimSeaRelation).not.toHaveBeenCalled();
    });

    it('**别的部门**的公海 → 403 `relation.out_of_scope`，且**先于定位**判（不许用 400 反推存在性）', async () => {
      const { service, repository } = createService({ seaRow: SEA_ROW });

      const error = await captureAppError(() =>
        runWithContext(contextOf({ deptIds: [9n] }), () =>
          service.claimCompanySeaRelation(CLAIM_INPUT),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.out_of_scope');
      // ★ 范围先拦 ⇒ **不查库**：否则「有 400 / 无 400」就能反推别部门有没有这条公海
      expect(repository.findCompanySeaRelation).not.toHaveBeenCalled();
    });

    it('只读角色（管理员）→ 403 `relation.read_only`（`all` 档也拦）', async () => {
      const { service, repository } = createService({ seaRow: SEA_ROW });

      const error = await captureAppError(() =>
        runWithContext(contextOf({ type: 'all', roleCodes: ['admin'] }), () =>
          service.claimCompanySeaRelation(CLAIM_INPUT),
        ),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('relation.read_only');
      expect(repository.claimSeaRelation).not.toHaveBeenCalled();
    });

    it('经理领**管辖部门**的公海 → 放行（`sea` 页签的 `dept` 档按管辖部门集合）', async () => {
      const { service, repository } = createService({ seaRow: SEA_ROW });

      await runWithContext(
        contextOf({
          type: 'dept',
          roleCodes: ['dept_manager'],
          deptIds: [9n],
          managedDeptIds: [DEPT_ID],
        }),
        () => service.claimCompanySeaRelation(CLAIM_INPUT),
      );

      expect(repository.claimSeaRelation).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // M9-F 真掉海（→ 需求 §6.3 掉海节奏表末行「到期 → 执行掉落回公司公海，写历史记录」；
  //   数据架构 §十二 末句 / F1 尾「只 UPDATE `sea_status`，严禁 UPDATE `dept_id`」）。
  //   ★ 它就是「领取到私海」**反向的同一件事**：那边公海→私海＋切 owner，这边私海→公海＋撤 owner。
  //   ★ 与领取最大的不同：**调用方是 Worker 定时任务** ⇒ 本出口*不*要请求上下文（下面有专例钉住）。
  // ===========================================================================
  describe('dropPrivateSeaRelation：到期掉海（M9-F）', () => {
    it('成功：**同一事务**里「条件 UPDATE 私海→公海 ＋ 撤在位 owner」，并回**掉海前**的 owner', async () => {
      const { service, repository, prisma } = createService();

      const result = await service.dropPrivateSeaRelation(RELATION_ID);

      // ① 一个本域事务（跨域不开大事务；关系 ＋ 成员必须同生共死，→ 架构 §5.2 路之③）
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // ② 条件 UPDATE：`count===1` 才算掉成（→ 数据架构 §10.2-3 与"抢公海"同一姿势）
      expect(repository.dropSeaRelation).toHaveBeenCalledWith(RELATION_ID, { tx: true });
      // ③ 撤在位 owner —— `by = null` ＝ **系统动作**（没有"谁"，硬填一个人比空着更失真）
      expect(repository.revokeActiveOwner).toHaveBeenCalledWith(RELATION_ID, null, { tx: true });
      // ④ 回**掉海前**的 owner：F 域要拿它写 `sea_record.owner_id` 快照（F2 逐字）
      expect(result).toEqual({ ownerId: ME });
    });

    it('**没有在位 owner** ⇒ 当场回 `null` 且**一行都不动**（凭空造个 owner 去写历史＝一号坑）', async () => {
      const { service, repository } = createService({ activeOwner: null });

      const result = await service.dropPrivateSeaRelation(RELATION_ID);

      expect(result).toBeNull();
      expect(repository.dropSeaRelation).not.toHaveBeenCalled();
      expect(repository.revokeActiveOwner).not.toHaveBeenCalled();
    });

    it('**条件 UPDATE 影响 0 行**（并发：刚被同事领走）⇒ 回 `null`，**不撤 owner**（半截状态比失败更糟）', async () => {
      const { service, repository } = createService({ dropCount: 0 });

      const result = await service.dropPrivateSeaRelation(RELATION_ID);

      expect(result).toBeNull();
      expect(repository.revokeActiveOwner).not.toHaveBeenCalled();
    });

    it('★ **不需要请求上下文**（调用方是 Worker 定时任务）：没有登录会话也照掉', async () => {
      const { service } = createService();

      // ⚠ 刻意**不**包 `runWithContext` —— 系统任务没有登录人（同 `listSeaWarningCandidates` 的约定）
      const result = await service.dropPrivateSeaRelation(RELATION_ID);

      expect(result).toEqual({ ownerId: ME });
    });
  });

  describe('上下文缺失', () => {
    it('拿不到请求上下文 → 401（**绝不兜底成「不过滤」**）', async () => {
      const { service } = createService();

      const error = await captureAppError(() => service.listRelations('private'));

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('relation.no_context');
    });
  });

  // ==========================================================================
  // D-61 桥③：某公司下**可见**的关系 id（→ 接口 §5.4 `event_count_30d` 的可见性收敛出口）
  //   判据：档位复用**私海列表**那一套 —— 同一公司，四档各走自己那条查询，互不串。
  // ==========================================================================
  describe('listVisibleRelationIdsOfCompany：可见性收敛（D-61 桥③）', () => {
    it('销售（`self`）→ 走「我参与」那条，并回出 id 列表', async () => {
      const { service, repository } = createService({ visibleRelationIds: [11n, 12n] });

      const ids = await runWithContext(contextOf(), () =>
        service.listVisibleRelationIdsOfCompany(COMPANY_ID),
      );

      expect(ids).toEqual([11n, 12n]);
      expect(repository.listVisibleRelationIdsOfCompanyOfEmployee).toHaveBeenCalledWith(
        COMPANY_ID,
        ME,
        expect.any(Date),
      );
      expect(repository.listVisibleRelationIdsOfCompanyOfDepts).not.toHaveBeenCalled();
      expect(repository.listVisibleRelationIdsOfCompany).not.toHaveBeenCalled();
    });

    it('经理（`dept`）→ 只查**管辖部门**（不是我所属部门）', async () => {
      const { service, repository } = createService({ visibleRelationIds: [11n] });

      await runWithContext(
        contextOf({ type: 'dept', roleCodes: ['dept_manager'], managedDeptIds: [MANAGED_DEPT_ID] }),
        () => service.listVisibleRelationIdsOfCompany(COMPANY_ID),
      );

      expect(repository.listVisibleRelationIdsOfCompanyOfDepts).toHaveBeenCalledWith(COMPANY_ID, [
        MANAGED_DEPT_ID,
      ]);
      expect(repository.listVisibleRelationIdsOfCompanyOfEmployee).not.toHaveBeenCalled();
    });

    it('总经理 / 管理员（`all`）→ 该公司下全部私海（不过滤）', async () => {
      const { service, repository } = createService({ visibleRelationIds: [11n] });

      await runWithContext(
        contextOf({ type: 'all', roleCodes: ['gm'] }),
        () => service.listVisibleRelationIdsOfCompany(COMPANY_ID),
      );

      expect(repository.listVisibleRelationIdsOfCompany).toHaveBeenCalledWith(COMPANY_ID);
      expect(repository.listVisibleRelationIdsOfCompanyOfDepts).not.toHaveBeenCalled();
    });

    it('★ 一条都看不见 → 回**空数组**（不是 `null`、也不放行）', async () => {
      const { service } = createService({ visibleRelationIds: [] });

      await expect(
        runWithContext(contextOf(), () => service.listVisibleRelationIdsOfCompany(COMPANY_ID)),
      ).resolves.toEqual([]);
    });

    it('上下文缺失 → 401（同列表口径：**绝不兜底成「不过滤」**）', async () => {
      const { service, repository } = createService({ visibleRelationIds: [11n] });

      const error = await captureAppError(() =>
        service.listVisibleRelationIdsOfCompany(COMPANY_ID),
      );

      expect(error.httpStatus).toBe(401);
      expect(repository.listVisibleRelationIdsOfCompany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // D-28（2026-09-21）：联系人收敛用的「我可见的公司」集合
  //   ★ 两个要点：`all` 档回 `null` 且**不查库**；空集合**不许**兜成 `null`（那是"不收敛"）。
  // ==========================================================================
  describe('listVisibleCompanyIds：我可见的公司集合（D-28）', () => {
    it('★ `all` 档（总经理 / 管理员）→ 回 **`null`（不收敛）** 且**不查库**（不把全库公司 id 拉进 `IN`）', async () => {
      const { service, repository } = createService({ visibleCompanyIds: [3n] });

      const ids = await runWithContext(contextOf({ type: 'all', roleCodes: ['gm'] }), () =>
        service.listVisibleCompanyIds(),
      );

      expect(ids).toBeNull();
      expect(repository.listVisibleCompanyIds).not.toHaveBeenCalled();
    });

    it('销售（`self`）→ `mine` 档（我参与 ＋ **本部门公海**），回 id 数组', async () => {
      const { service, repository } = createService({ visibleCompanyIds: [3n, 5n] });

      const ids = await runWithContext(contextOf(), () => service.listVisibleCompanyIds());

      expect(ids).toEqual([3n, 5n]);
      expect(repository.listVisibleCompanyIds).toHaveBeenCalledWith(
        { kind: 'mine', employeeId: ME, publicDeptIds: [DEPT_ID] },
        expect.any(Date),
      );
    });

    it('经理（`dept`）→ `depts` 档（**管辖部门**，不是"我所属部门"）', async () => {
      const { service, repository } = createService({ visibleCompanyIds: [3n] });

      await runWithContext(
        contextOf({ type: 'dept', roleCodes: ['dept_manager'], managedDeptIds: [MANAGED_DEPT_ID] }),
        () => service.listVisibleCompanyIds(),
      );

      expect(repository.listVisibleCompanyIds).toHaveBeenCalledWith(
        { kind: 'depts', deptIds: [MANAGED_DEPT_ID] },
        expect.any(Date),
      );
    });

    it('★ 一条都没有 → 回**空数组**（＝只剩自己的待关联线索），**不许**兜成 `null`（那是"不收敛"）', async () => {
      const { service } = createService({ visibleCompanyIds: [] });

      await expect(
        runWithContext(contextOf(), () => service.listVisibleCompanyIds()),
      ).resolves.toEqual([]);
    });

    it('上下文缺失 → 401（同列表口径：**绝不兜底成「不收敛」**）', async () => {
      const { service, repository } = createService({ visibleCompanyIds: [3n] });

      const error = await captureAppError(() => service.listVisibleCompanyIds());

      expect(error.httpStatus).toBe(401);
      expect(repository.listVisibleCompanyIds).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 掉海倒计时锚点（2026-09-22 · 接口 §4.4 / §5.6 `drop_in_x_days` 的跨域出口）
  //   ★ 三个要点：**不需要登录上下文**（服务的是装配层，不是某个登录人）；入参空 → **不查库**；
  //     形状与定时任务那条出口**逐字同源**（同一个映射函数 → 两处倒计时不会不一样）。
  // ==========================================================================
  describe('getSeaWarningAnchors：按 id 取掉海锚点（接口 §4.4）', () => {
    it('按 id 取：回锚点（部门 / 产品线 / owner / 最近有效沟通 / 建档），且只走"按 id"那条仓储方法', async () => {
      const { service, repository } = createService({ seaWarningRows: [seaWarningRowFixture()] });

      const anchors = await service.getSeaWarningAnchors([RELATION_ID]);

      expect(anchors).toEqual([
        {
          id: RELATION_ID,
          deptId: DEPT_ID,
          productLineId: LINE_ID,
          ownerId: ME,
          lastEventAt: null,
          createdAt: new Date('2026-09-10T09:00:00Z'),
        },
      ]);
      expect(repository.findSeaWarningCandidatesByIds).toHaveBeenCalledWith([RELATION_ID]);
      // ★ 列表页**不许**走全量扫那条（一页一行数据、扫全库不可接受）
      expect(repository.listPrivateSeaCandidatesForWarning).not.toHaveBeenCalled();
    });

    it('★ **不需要请求上下文**（服务的是装配层，不是"某个登录人"的出口）', async () => {
      const { service } = createService({ seaWarningRows: [seaWarningRowFixture()] });

      // ⚠ 刻意**不**包 `runWithContext`（同 `listSeaWarningCandidates` / `dropPrivateSeaRelation` 的约定）
      await expect(service.getSeaWarningAnchors([RELATION_ID])).resolves.toHaveLength(1);
    });

    it('★ 入参为空 → 回空且**不查库**（`IN ()` 没有意义，也不该白跑一趟）', async () => {
      const { service, repository } = createService({ seaWarningRows: [seaWarningRowFixture()] });

      await expect(service.getSeaWarningAnchors([])).resolves.toEqual([]);
      expect(repository.findSeaWarningCandidatesByIds).not.toHaveBeenCalled();
    });

    it('重复 id 先**去重**再查（出口不假设调用方送来的集合是干净的）', async () => {
      const { service, repository } = createService({ seaWarningRows: [seaWarningRowFixture()] });

      await service.getSeaWarningAnchors([RELATION_ID, RELATION_ID]);

      expect(repository.findSeaWarningCandidatesByIds).toHaveBeenCalledWith([RELATION_ID]);
    });

    it('没有在位 owner 的行 → `ownerId: null`（**不补数据**；筛选口径本身由仓储的 SQL 承担）', async () => {
      const { service } = createService({ seaWarningRows: [seaWarningRowFixture({ members: [] })] });

      const [anchor] = await service.getSeaWarningAnchors([RELATION_ID]);

      expect(anchor?.ownerId).toBeNull();
    });
  });
});

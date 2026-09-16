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
    findCompetitorById: jest.fn(async () => options.competitor ?? null),
    // ⚠ 假件必须**照真实形状**给 `{ rows, total }`：给裸数组时 service 解构出 `undefined`，
    //   用例会假红（→ 铁律坑 16「假红先修假件，再怀疑被测代码」）
    listPrivateRelationsOfEmployee: jest.fn(async () => pageOf(options.rows ?? [])),
    listPrivateRelationsOfDepts: jest.fn(async () => pageOf(options.rows ?? [])),
    listPrivateRelations: jest.fn(async () => pageOf(options.rows ?? [])),
    listSeaRelationsOfDepts: jest.fn(async () => pageOf(options.rows ?? [])),
    listSeaRelations: jest.fn(async () => pageOf(options.rows ?? [])),
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
    getProductLineRefs: jest.fn(async (ids: readonly bigint[]) =>
      [{ id: LINE_ID, name: '标准线', color_key: 'blue' }].filter((ref) => ids.includes(ref.id)),
    ),
    getEmployeeDeptIds: jest.fn(async () => options.mentionedDeptIds ?? [DEPT_ID]),
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

  const service = new RelationService(
    repository as unknown as RelationRepository,
    org as unknown as OrgService,
    company as unknown as CompanyService,
    prisma as unknown as PrismaService,
    events as unknown as EventBus,
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

    it('预检命中同键 → **409 / 20401**，人话与 `mapPrismaError` 的 `uk_active_rel` **逐字一致**', async () => {
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
      // ★ 并发路径与预检路径**同一句人话**（改文案只改 mapper，两条一起变）
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
        expect.objectContaining({ page: 1, pageSize: 20, skip: 0, take: 20 }),
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
        expect.objectContaining({ page: 1, pageSize: 20 }),
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
        expect.objectContaining({ page: 2, pageSize: 1, skip: 1, take: 1 }),
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
        expect.objectContaining({ pageSize: 100, take: 100 }),
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

  describe('上下文缺失', () => {
    it('拿不到请求上下文 → 401（**绝不兜底成「不过滤」**）', async () => {
      const { service } = createService();

      const error = await captureAppError(() => service.listRelations('private'));

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('relation.no_context');
    });
  });
});

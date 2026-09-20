// =============================================================================
// B 域服务用例（M2-08 / M2-09 / M2-10 / M2-13 / M2-14）
//
// 判据逐字（《开发计划-V1》）：
//   M2-08「单测：命中高度疑似 → 需确认；正常 → 建成」
//   M2-09「单测：分级正确」· M2-10「单测：重复手机号 → 409，message **不含 `Duplicate entry`**」
//
// ★ 本文件用**真 service ＋ 假 repository**（与 A 域同姿势）：
//   判级 / 归一 / 打码都是真函数（在 `domain/` 与 `kernel/`），只有「库」是假的 ——
//   于是「服务编排对了没有」和「规则算对了没有」在同一层被验证。
// ★ P2002 假件按**真库实测形状**造（`meta.driverAdapterError.cause.constraint.index`）：
//   手造 `meta.target` 会让映射器走别名兜底 —— 看着绿、真链路却是另一条路（→ M0-23 假绿教训）。
// ★ 建档要写 `created_by` ⇒ 必须先有请求上下文（`runWithContext`）；
//   「拿不到上下文」本身就是一条要钉住的失败路径（→ 文件末）。
// =============================================================================
import { AppError, ErrorCode, runWithContext, type RequestContext } from '../../kernel/index';
import { type PrismaService } from '../../prisma/prisma.service';
import type { DictService } from '../org/dict.service';
import type { OrgService } from '../org/org.service';
import { CompanyRepository, type CreateCompanyData } from './company.repository';
import { CompanyService } from './company.service';
import type { CreateCompanyDto, CreateContactDto } from './dto/company-request.dto';

const OPERATOR_ID = 7n;

/** M5-04：另一个人的 id（＝「不是落锁人」的那一侧）＋ 一个上锁时刻（值本身不重要，只表达「锁开着」） */
const LOCKER_ID = 3n;
const LOCKED_AT = new Date('2026-09-15T10:00:00+08:00');

/** 请求上下文（建档者的身份来源） */
const CONTEXT: RequestContext = {
  employeeId: OPERATOR_ID,
  deptIds: [1n],
  roleCodes: ['sale'],
  dataScope: { type: 'self', deptIds: [] },
};

/** 真库实测的 P2002 形状（Prisma 7 ＋ driver adapter）：约束名在最里面那层 */
function p2002(constraint: string): Error & { code: string; meta: unknown } {
  const error = new Error('Invalid `prisma.contact.create()` invocation: Unique constraint failed') as Error & {
    code: string;
    meta: unknown;
  };
  error.code = 'P2002';
  error.meta = { driverAdapterError: { cause: { constraint: { index: constraint } } } };
  return error;
}

interface CompanyRowFixture {
  id: bigint;
  full_name: string;
  name_core: string | null;
  credit_code: string | null;
  industry_l1: string | null;
  industry_l2: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  scale: string | null;
  website: string | null;
  address: string | null;
  bank_name: string | null;
  invoice_title: string | null;
  tax_no: string | null;
  registered_capital: { toString(): string } | null;
  legal_person: string | null;
  longitude: { toString(): string } | null;
  latitude: { toString(): string } | null;
  aliases: unknown;
  merged_into: bigint | null;
  updated_at: Date;
}

function companyRow(overrides: Partial<CompanyRowFixture> = {}): CompanyRowFixture {
  return {
    id: 1n,
    full_name: '安徽鑫中网信息技术有限公司',
    name_core: '鑫中网',
    credit_code: null,
    industry_l1: null,
    industry_l2: null,
    province: null,
    city: null,
    district: null,
    scale: null,
    website: null,
    address: null,
    bank_name: null,
    invoice_title: null,
    tax_no: null,
    registered_capital: null,
    legal_person: null,
    longitude: null,
    latitude: null,
    aliases: null,
    merged_into: null,
    updated_at: new Date('2026-09-15T10:00:00+08:00'),
    ...overrides,
  };
}

interface ContactRowFixture {
  id: bigint;
  name: string;
  phone: string;
  extra_phones: { type: string; number: string; note?: string }[] | null;
  decision_role: string | null;
  status: string;
  /** M5-04：联系方式「锁」的两列（NULL ＝ 未锁；`by` ＝ 落锁人，→ 数据架构 B3） */
  phone_locked_at: Date | null;
  phone_locked_by: bigint | null;
  merged_into: bigint | null;
}

function contactRow(overrides: Partial<ContactRowFixture> = {}): ContactRowFixture {
  return {
    id: 11n,
    name: '张伟',
    phone: '13800000000',
    extra_phones: null,
    decision_role: null,
    status: 'active',
    phone_locked_at: null,
    phone_locked_by: null,
    merged_into: null,
    ...overrides,
  };
}

/**
 * M6-15：造一条仓储读出的**联系人详情行**（字段与 `CONTACT_DETAIL_SELECT` 对齐 ——
 * 简卡那些 ＋ `owner_id` / `deleted_at`）。默认＝**未上锁、有归属、有备用号**的普通联系人。
 */
function contactDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11n,
    name: '张伟',
    phone: '13800000000',
    extra_phones: [{ type: 'landline', number: '0551-12345678' }],
    wechat: 'zhangwei',
    email: null,
    gender: 'male',
    birthday: new Date('1985-03-12T00:00:00Z'),
    decision_role: 'decision',
    tags: ['爱喝茶'],
    status: 'active',
    phone_locked_at: null,
    phone_locked_by: null,
    merged_into: null,
    owner_id: OPERATOR_ID,
    deleted_at: null,
    ...overrides,
  };
}

interface FakeOptions {
  candidates?: CompanyRowFixture[];
  byCreditCode?: CompanyRowFixture | null;
  companyById?: CompanyRowFixture | null;
  companiesByPhone?: CompanyRowFixture[];
  contactByPhone?: ContactRowFixture | null;
  createdCompany?: CompanyRowFixture;
  createdContact?: ContactRowFixture;
  createCompanyError?: unknown;
  createContactError?: unknown;
  historyOwner?: { id: bigint; name: string } | null;
  contacts?: ContactRowFixture[];
  companyContacts?: { is_current: boolean; position: string | null; contact: ContactRowFixture }[];
  /** M6-14：`findContactRefsByIds` 的返回（不给＝按传入 id 都回「张伟」；给 `[]` ＝ 联系人取不到） */
  contactRefs?: { id: bigint; name: string }[];
  /** M6-14：该联系人**已有几条就职记录**（`0` ＝ 「待关联」） */
  contactLinkCount?: number;
  /** M6-15：联系人**详情行**（显式给 `null` ＝ 查不到 / 已删 / 已合并） */
  contactDetail?: Record<string, unknown> | null;
  /** M6-15：就职历史（默认空数组 ＝ 「待关联」） */
  employments?: Record<string, unknown>[];
  /** M6-15：谈判特质（`{trait_id,trait_code}`，label 由 A 域字典出口给） */
  traits?: { trait_id: bigint; trait_code: string }[];
  /** M6-15：A 域字典出口返回的文案（**查不到即无 label**，用来钉「不编文案」） */
  dictLabels?: { id: bigint; label: string }[];
  /** M6-15：A 域员工出口返回的人（落锁人姓名用） */
  employeeRefs?: { id: bigint; name: string }[];
}

function createRepository(options: FakeOptions = {}) {
  return {
    createCompany: jest.fn(async (data: CreateCompanyData) =>
      options.createCompanyError === undefined
        ? companyRow({ ...options.createdCompany, full_name: data.full_name, name_core: data.name_core })
        : Promise.reject(options.createCompanyError),
    ),
    findCompanyById: jest.fn(async () => options.companyById ?? null),
    findCompanyByCreditCode: jest.fn(async () => options.byCreditCode ?? null),
    findCompanyCandidatesByCore: jest.fn(async () => options.candidates ?? []),
    findCompaniesByContactPhone: jest.fn(async () => options.companiesByPhone ?? []),
    // D-08：仓储列表返回 `{rows,total}`（分页）—— 假件按**真实形状**造，否则用例假绿
    listCompanies: jest.fn(async () => ({ rows: [] as CompanyRowFixture[], total: 0 })),
    createContact: jest.fn(async (data?: unknown) => {
      void data; // 入参只用于断言（`mock.calls`），这里不参与造值
      return options.createContactError === undefined
        ? (options.createdContact ?? contactRow())
        : Promise.reject(options.createContactError);
    }),
    // 收一个占位入参（同 `listContacts` 的理由）：`mock.calls[n][0]` 在类型上要存在，用例才能断言写了哪几列
    createCompanyContact: jest.fn(async (input: Record<string, unknown>) => {
      void input;
      return { id: 1n };
    }),
    findContactByPhone: jest.fn(async () => options.contactByPhone ?? null),
    findHistoricalPhoneOwner: jest.fn(async () =>
      options.historyOwner === undefined || options.historyOwner === null ? null : { contact: options.historyOwner },
    ),
    // 收一个占位入参（函数体里 `void` 一下过 lint）：**不是要用它**，而是让
    // `mock.calls[n][0]` 在类型上存在 —— 用例要断言传下来的可见范围参数（`allScope` / `onlyUnlinked`）
    // 需收**两个**占位入参：`mock.calls[n][1]` 要被断言（分页 `{skip,take}`），类型上必须存在
    listContacts: jest.fn(
      async (input: Record<string, unknown>, pagination: Record<string, unknown>) => {
        void input;
        void pagination;
        // D-08：分页形态 `{rows,total}`（假件同真实形状）
        const rows = options.contacts ?? [];
        return { rows, total: rows.length };
      },
    ),
    findCompanyContacts: jest.fn(async () => {
      const rows = options.companyContacts ?? [];
      return { rows, total: rows.length };
    }),
    // M6-14：关联公司动线的两个前置查询（只给「够判定」的信息：名字 ＋ 就职记录条数）
    findContactRefsByIds: jest.fn(async (ids: readonly bigint[]) =>
      options.contactRefs === undefined
        ? ids.map((id) => ({ id, name: '张伟' }))
        : options.contactRefs,
    ),
    countCompanyContacts: jest.fn(async (contactId: bigint) => {
      void contactId;
      return options.contactLinkCount ?? 0;
    }),
    // M6-15：联系人详情的三个读（详情行 / 就职历史 / 谈判特质）
    findContactDetailById: jest.fn(async (id: bigint) =>
      options.contactDetail === undefined ? contactDetailRow({ id }) : options.contactDetail,
    ),
    findContactEmployments: jest.fn(async (contactId: bigint) => {
      void contactId;
      return options.employments ?? [];
    }),
    findContactTraits: jest.fn(async (contactId: bigint) => {
      void contactId;
      return options.traits ?? [];
    }),
  };
}

/** Prisma 假件：只需 `$transaction`（把回调喂进去）—— 事务里用哪个 client 由被测代码决定 */
function createPrisma() {
  // 先建空壳再挂方法：`jest.fn(async () => fn(client))` 直接写在字面量里会让 TS 抱怨
  // 「client 的类型引用到自己」（TS7022）
  const client: Record<string, unknown> = {};
  client['$transaction'] = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client));
  return client as unknown as PrismaService;
}

/** A 域替身·组织与权限（M6-15 起 B 域要用它取落锁人姓名） */
function createOrg(options: FakeOptions = {}) {
  return {
    getEmployeeRefs: jest.fn(async (ids: readonly bigint[]) =>
      (options.employeeRefs ?? [{ id: LOCKER_ID, name: '李强' }]).filter((item) =>
        ids.includes(item.id),
      ),
    ),
  };
}

/** A 域替身·字典（与 `createOrg` 分家 —— 出口按能力分家，两个替身也照着分） */
function createDict(options: FakeOptions = {}) {
  return {
    getDictItemLabels: jest.fn(async (ids: readonly bigint[]) =>
      (options.dictLabels ?? []).filter((item) => ids.includes(item.id)),
    ),
  };
}

function createService(options: FakeOptions = {}) {
  const repository = createRepository(options);
  const org = createOrg(options);
  const dict = createDict(options);
  return {
    service: new CompanyService(
      repository as unknown as CompanyRepository,
      createPrisma(),
      org as unknown as OrgService,
      dict as unknown as DictService,
    ),
    repository,
    org,
    dict,
  };
}

async function captureAppError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('预期抛错，但调用成功返回了');
}

describe('B 域服务（M2-08 / M2-09 / M2-10 / M2-13 / M2-14）', () => {
  describe('M2-08 createCompany', () => {
    it('正常建档：服务端生成 `name_core` 并落库（不是把全称当核心词）', async () => {
      const { service, repository } = createService({});
      const dto: CreateCompanyDto = { full_name: '安徽鑫中网信息技术有限公司' };

      const created = await runWithContext(CONTEXT, () => service.createCompany(dto));

      expect(repository.createCompany).toHaveBeenCalledTimes(1);
      expect(repository.createCompany.mock.calls[0]?.[0]).toMatchObject({
        full_name: '安徽鑫中网信息技术有限公司',
        name_core: '鑫中网',
        created_by: OPERATOR_ID,
      });
      expect(created.name_core).toBe('鑫中网');
    });

    it('信用代码撞码 → 409「请使用已有档案」（预检就拦住，不靠异常兜）', async () => {
      const { service, repository } = createService({
        byCreditCode: companyRow({ credit_code: '91340000MA2T0000XX' }),
      });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() =>
          service.createCompany({ full_name: '安徽鑫中网信息技术有限公司', credit_code: '91340000MA2T0000XX' }),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.code).toBe(ErrorCode.UNIQUE_CONFLICT);
      expect(error.message).toBe('该统一社会信用代码已存在，请使用已有档案');
      // 预检命中就不该再插入（少一次必然失败的写）
      expect(repository.createCompany).not.toHaveBeenCalled();
    });

    it('并发下预检漏过 → 靠 DB 约束兜底，仍映射成同一句人话（P2002 真形状）', async () => {
      const { service } = createService({ createCompanyError: p2002('uk_credit_code') });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() =>
          service.createCompany({ full_name: '安徽鑫中网信息技术有限公司', credit_code: '91340000MA2T0000XX' }),
        ),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.message).toBe('该统一社会信用代码已存在，请使用已有档案');
    });

    it('**疑似重复不拦建档**（需求 §12.1 分支 4 的「强行新建」出口）', async () => {
      const { service, repository } = createService({
        candidates: [companyRow({ id: 9n, full_name: '合肥鑫中网网络有限公司', name_core: '鑫中网' })],
      });

      const created = await runWithContext(CONTEXT, () =>
        service.createCompany({ full_name: '安徽鑫中网信息技术有限公司' }),
      );

      expect(created.full_name).toBe('安徽鑫中网信息技术有限公司');
      expect(repository.createCompany).toHaveBeenCalledTimes(1);
    });

    it('出参：`Decimal` 显式转字符串、`address_maintained` 按 address / 坐标派生', async () => {
      const { service } = createService({
        createdCompany: companyRow({
          registered_capital: { toString: () => '5000000.00' },
          address: '合肥市高新区某路 1 号',
          longitude: { toString: () => '117.227239' },
        }),
      });

      const created = await runWithContext(CONTEXT, () =>
        service.createCompany({ full_name: '安徽鑫中网信息技术有限公司' }),
      );

      expect(created.registered_capital).toBe('5000000.00');
      expect(created.address_maintained).toBe(true);
    });

    it('拿不到请求上下文 → 401（不写一条没有 `created_by` 的档案）', async () => {
      const { service, repository } = createService({});

      const error = await captureAppError(() => service.createCompany({ full_name: '安徽鑫中网信息技术有限公司' }));

      expect(error.httpStatus).toBe(401);
      expect(repository.createCompany).not.toHaveBeenCalled();
    });
  });

  describe('M2-09 searchDup（分级）', () => {
    it('名称两段式：核心词完全相同 → `same`；字形差一字 → `high_sim`；长度差太多 → 不进候选', async () => {
      const { service } = createService({
        candidates: [
          companyRow({ id: 1n, full_name: '合肥鑫中网网络有限公司', name_core: '鑫中网' }),
          companyRow({ id: 2n, full_name: '安徽鑫中网络技术有限公司', name_core: '鑫中网络' }),
          companyRow({ id: 3n, full_name: '鑫中网信息技术（合肥）有限公司', name_core: '鑫中网信息技术' }),
        ],
      });

      const result = await service.searchDup({ name: '安徽鑫中网信息技术有限公司' });

      expect(result.candidates.map((item) => [item.id, item.match_type])).toEqual([
        [1n, 'same'],
        [2n, 'high_sim'],
      ]);
      expect(result.suggest).toBe('use_exists');
    });

    it('手机号精确命中 → `same`，且信用代码**打码**出参（不泄露他人档案全码）', async () => {
      const { service } = createService({
        companiesByPhone: [companyRow({ id: 5n, credit_code: '91340000MA2T0000XX' })],
      });

      const result = await service.searchDup({ phone: '138 0000 0000' });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ id: 5n, match_type: 'same', similarity: 1 });
      expect(result.candidates[0]?.credit_code_masked).toBe('9134****00XX');
    });

    it('同一家公司被两路命中只出一条，且判级取更高（`same` 不被 `high_sim` 盖掉）', async () => {
      const row = companyRow({ id: 8n, full_name: '安徽鑫中网信息技术有限公司', name_core: '鑫中网' });
      const { service } = createService({ byCreditCode: row, candidates: [{ ...row, name_core: '鑫中网络' }] });

      const result = await service.searchDup({
        credit_code: '91340000MA2T0000XX',
        name: '安徽鑫中网信息技术有限公司',
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.match_type).toBe('same');
    });

    it('一条候选都没有 → `create_new`（只在此时才建议新建）', async () => {
      const { service } = createService({});

      await expect(service.searchDup({ name: '完全没见过科技有限公司' })).resolves.toEqual({
        candidates: [],
        suggest: 'create_new',
      });
    });

    it('三个参数都没给 → 400 / 20001（不猜、也不空跑一遍候选查询）', async () => {
      const { service, repository } = createService({});

      const error = await captureAppError(() => service.searchDup({}));

      expect(error.httpStatus).toBe(400);
      expect(error.code).toBe(ErrorCode.PARAM_INVALID);
      expect(repository.findCompanyCandidatesByCore).not.toHaveBeenCalled();
    });
  });

  describe('M2-10 / M2-13 createContact', () => {
    it('主号**先归一后入库**（`138 0000 0000` → `13800000000`），并在事务里写就职关系', async () => {
      const { service, repository } = createService({ companyById: companyRow({ id: 3n }) });
      const dto: CreateContactDto = { name: '张伟', phone: '138 0000 0000', company_id: '3', position: '采购总监' };

      const created = await runWithContext(CONTEXT, () => service.createContact(dto));

      expect(created.phone).toBe('13800000000');
      expect(repository.createContact.mock.calls[0]?.[0]).toMatchObject({
        phone: '13800000000',
        name: '张伟',
        // ★ 归属＝建档人（→ 需求 §6.1 ⑦）
        owner_id: OPERATOR_ID,
      });
      expect(repository.createCompanyContact).toHaveBeenCalledWith(
        { company_id: 3n, contact_id: 11n, position: '采购总监' },
        expect.anything(),
      );
    });

    it('**待关联**（不传 company_id）也写归属＝建档人 —— 需求 §6.1 ⑦ 的落点本体', async () => {
      const { service, repository } = createService({});

      await runWithContext(CONTEXT, () =>
        service.createContact({ name: '张伟', phone: '13800000000' }),
      );

      // 没有公司 → 不写就职关系（「待关联」的判定＝`company_contact` 里没有行）
      expect(repository.createCompanyContact).not.toHaveBeenCalled();
      const written = repository.createContact.mock.calls[0]?.[0] as { owner_id: bigint };
      expect(written.owner_id).toBe(OPERATOR_ID);
    });

    it('重复手机号 → 409 且**人话不含 DB 原话**（判据本体）', async () => {
      const { service } = createService({ contactByPhone: contactRow() });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.createContact({ name: '李四', phone: '13800000000' })),
      );

      expect(error.httpStatus).toBe(409);
      expect(error.message).toBe('该手机号已存在');
      expect(error.message).not.toContain('Duplicate entry');
      expect(JSON.stringify(error)).not.toContain('Duplicate entry');
    });

    it('并发撞号（预检漏过）→ P2002 真形状仍映射成同一句人话', async () => {
      const { service } = createService({ createContactError: p2002('uk_phone_active') });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.createContact({ name: '李四', phone: '13800000000' })),
      );

      expect(error.httpStatus).toBe(409);
      // **与预检路径同一句**：两条路径（日常预检 / 并发兜底）不许各写一套文案
      expect(error.message).toBe('该手机号已存在');
    });

    it('命中**历史号**只提示、不拦截（→ B6「提示不拦截」）', async () => {
      const { service } = createService({ historyOwner: { id: 20n, name: '王五' } });

      const created = await runWithContext(CONTEXT, () => service.createContact({ name: '张伟', phone: '13900000000' }));

      expect(created.phone_history_hint).toBe('该号曾属于 王五');
    });

    it('空号 / 只有分隔符 → 400（归一后为空等于没填）', async () => {
      const { service } = createService({});

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.createContact({ name: '张伟', phone: '-' })),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.code).toBe(ErrorCode.PARAM_INVALID);
    });

    it('`company_id` 指向不存在的公司 → 400（不写出一条挂着空气的就职关系）', async () => {
      const { service, repository } = createService({ companyById: null });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.createContact({ name: '张伟', phone: '13800000000', company_id: '999' })),
      );

      expect(error.httpStatus).toBe(400);
      expect(repository.createContact).not.toHaveBeenCalled();
    });
  });

  describe('M2-13 / M2-14 列表出参', () => {
    it('公司联系人：**一律 `phone_masked`**、含历史就职标记（→ §2.8 出参形态）', async () => {
      const { service } = createService({
        companyById: companyRow({ id: 3n }),
        companyContacts: [
          { is_current: true, position: '采购总监', contact: contactRow({ id: 11n }) },
          { is_current: false, position: '已离职', contact: contactRow({ id: 12n, phone: '13911112222' }) },
        ],
      });

      // D-08：service 返回分页对象 ⇒ 取 `list` 断言（其余字段另有分页用例覆盖）
      const { list: briefs } = await runWithContext(CONTEXT, () => service.listCompanyContacts('3'));

      expect(briefs.map((item) => [item.id, item.phone_masked, item.is_current])).toEqual([
        [11n, '138****0000', true],
        [12n, '139****2222', false],
      ]);
      expect(briefs.every((item) => item.phone_locked === false)).toBe(true);
    });

    it('联系人列表：打码形态与角色无关（**未上锁时 `phone_locked` ＝ false**，不是「恒 false」）', async () => {
      const { service } = createService({ contacts: [contactRow({ id: 11n })] });

      const { list: briefs } = await runWithContext(CONTEXT, () => service.listContacts());

      expect(briefs).toHaveLength(1);
      expect(briefs[0]?.phone_masked).toBe('138****0000');
      expect(briefs[0]?.phone_locked).toBe(false);
    });

    it('可见范围：`self` 档套「归属人 / 已挂公司」过滤；`all` 档（总经理 / 管理员）**看全部**（→ 需求 §4.2 / §6.1 ⑪）', async () => {
      const { service, repository } = createService({ contacts: [] });

      await runWithContext(CONTEXT, () => service.listContacts());

      expect(repository.listContacts.mock.calls[0]?.[0]).toMatchObject({
        viewerId: OPERATOR_ID,
        onlyUnlinked: false,
        allScope: false,
      });

      const allContext: RequestContext = { ...CONTEXT, dataScope: { type: 'all', deptIds: [] } };
      await runWithContext(allContext, () => service.listContacts({ onlyUnlinked: true }));

      expect(repository.listContacts.mock.calls[1]?.[0]).toMatchObject({
        onlyUnlinked: true,
        allScope: true,
      });
    });

    it('★ D-08：分页入参 → 仓储拿 `skip/take`、出参是 §2.3 分页对象（键名 `page_size` 而非 `pageSize`）', async () => {
      const { service, repository } = createService({ contacts: [contactRow({ id: 11n })] });

      // ① 缺省：page 1 / pageSize 20（**归一化只在 kernel 一处**，本层不重复实现）
      const first = await runWithContext(CONTEXT, () => service.listContacts());
      expect(repository.listContacts.mock.calls[0]?.[1]).toMatchObject({ skip: 0, take: 20 });
      expect(Object.keys(first).sort()).toEqual(['list', 'page', 'page_size', 'total']);
      expect(first.page).toBe(1);
      expect(first.page_size).toBe(20);
      expect(first.total).toBe(1);

      // ② 显式第 2 页 / 每页 50 → `skip = (2-1) * 50`；出参页码与每页条数**以后端为准**
      const second = await runWithContext(CONTEXT, () =>
        service.listContacts({ page: 2, pageSize: 50 }),
      );
      expect(repository.listContacts.mock.calls[1]?.[1]).toMatchObject({ skip: 50, take: 50 });
      expect(second.page).toBe(2);
      expect(second.page_size).toBe(50);
    });

    it('★ M5-04：被上锁 ＋ 查看者**不是落锁人** → `phone_locked:true`（列表仍打码，**不因上锁改形态**）', async () => {
      const { service } = createService({
        contacts: [
          contactRow({ id: 11n, phone_locked_at: LOCKED_AT, phone_locked_by: LOCKER_ID }),
          contactRow({ id: 12n, phone: '13911112222', phone_locked_at: LOCKED_AT, phone_locked_by: OPERATOR_ID }),
        ],
      });

      const { list: briefs } = await runWithContext(CONTEXT, () => service.listContacts());

      // ① 别人锁的 → 我看到「已上锁」；② 我自己锁的 → 照常（锁是自我保护，不挡自己，→ §4.3 二）
      expect(briefs.map((item) => [item.id, item.phone_masked, item.phone_locked])).toEqual([
        [11n, '138****0000', true],
        [12n, '139****2222', false],
      ]);
    });

    it('★ M5-04：公司联系人出口**同一套**锁判定（两个列表共用一段装配，不许各写一遍）', async () => {
      const { service } = createService({
        companyById: companyRow({ id: 3n }),
        companyContacts: [
          {
            is_current: true,
            position: '采购总监',
            contact: contactRow({ id: 11n, phone_locked_at: LOCKED_AT, phone_locked_by: LOCKER_ID }),
          },
        ],
      });

      // D-08：service 返回分页对象 ⇒ 取 `list` 断言（其余字段另有分页用例覆盖）
      const { list: briefs } = await runWithContext(CONTEXT, () => service.listCompanyContacts('3'));

      expect(briefs.map((item) => [item.id, item.phone_locked])).toEqual([[11n, true]]);
    });

    it('没有请求上下文 → 401：锁的可见性取决于「我是谁」，**没有身份就不猜**（不静默按「未锁」渲染）', async () => {
      const { service } = createService({ contacts: [contactRow({ id: 11n })] });

      const error = await captureAppError(() => service.listContacts());

      expect(error.httpStatus).toBe(401);
      expect(error.code).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('公司不存在 → 400（「列表空」与「公司不存在」是两种状态，不能混成一种）', async () => {
      const { service } = createService({ companyById: null });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.listCompanyContacts('999')),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.message).toContain('公司不存在');
    });
  });

  // ===========================================================================
  // M6-14「关联公司并激活业务关系」的 B 域出口（→ 接口 §5.6 `POST /contacts/:id/activate-relation`）
  //
  // 为什么这两条要在 B 域单测（而不是只在 D 域测编排）：
  //   「是不是『待关联』」与「就职关系怎么写」都是 **B 域的规则 / B 域的表**，
  //   D 域只是编排者 —— 判定与人话的唯一落点在这里，就得在这里被钉住。
  // ===========================================================================
  describe('M6-14 关联公司动线的跨域出口', () => {
    const CONTACT_ID = 11n;
    const COMPANY_ID = 3n;

    describe('requireContactUnlinked（前置校验）', () => {
      it('「待关联」（**一条就职记录都没有**）→ 放行，回联系人 `{id,name}`', async () => {
        const { service } = createService({ contactLinkCount: 0 });

        await expect(service.requireContactUnlinked(CONTACT_ID)).resolves.toEqual({
          id: CONTACT_ID,
          name: '张伟',
        });
      });

      it('已有就职记录（**不是「待关联」**）→ 409 防重复触发', async () => {
        const { service } = createService({ contactLinkCount: 1 });

        const error = await captureAppError(() => service.requireContactUnlinked(CONTACT_ID));

        expect(error.httpStatus).toBe(409);
        expect(error.code).toBe(ErrorCode.UNIQUE_CONFLICT);
        expect(error.constraint).toBe('company_contact.already_linked');
      });

      it('联系人不存在（已删 / 已合并）→ 400（**不静默当成「待关联」**，那会凭空挂一条就职）', async () => {
        const { service } = createService({ contactRefs: [] });

        const error = await captureAppError(() => service.requireContactUnlinked(CONTACT_ID));

        expect(error.httpStatus).toBe(400);
        expect(error.constraint).toBe('company.contact_missing');
      });
    });

    describe('linkContactEmployment（写就职关系）', () => {
      it('正常：写 `company_contact`（`is_current=true`）＋ 职位透传；**不碰关系与跟单**（那两张表不归 B 域）', async () => {
        const { service, repository } = createService({
          companyById: companyRow({ id: COMPANY_ID }),
        });

        await runWithContext(CONTEXT, () =>
          service.linkContactEmployment({
            contactId: CONTACT_ID,
            companyId: COMPANY_ID,
            position: '采购经理',
          }),
        );

        expect(repository.createCompanyContact).toHaveBeenCalledWith({
          company_id: COMPANY_ID,
          contact_id: CONTACT_ID,
          position: '采购经理',
        });
        // 「就职」这件事只写 company_contact 一张表 —— 本出口不替调用方做别的
        expect(repository.createContact).not.toHaveBeenCalled();
      });

      it('职位**空串**＝没填：不写这一列（免得库里出现一条「职位＝空」的在职记录）', async () => {
        const { service, repository } = createService({
          companyById: companyRow({ id: COMPANY_ID }),
        });

        await runWithContext(CONTEXT, () =>
          service.linkContactEmployment({
            contactId: CONTACT_ID,
            companyId: COMPANY_ID,
            position: '   ',
          }),
        );

        expect(repository.createCompanyContact.mock.calls[0]?.[0]).not.toHaveProperty('position');
      });

      it('★ 复核兜底：已挂过公司 → **409 且不落库**（D 域前置校验与写之间有窗口）', async () => {
        const { service, repository } = createService({
          companyById: companyRow({ id: COMPANY_ID }),
          contactLinkCount: 1,
        });

        const error = await runWithContext(CONTEXT, () =>
          captureAppError(() =>
            service.linkContactEmployment({ contactId: CONTACT_ID, companyId: COMPANY_ID }),
          ),
        );

        expect(error.httpStatus).toBe(409);
        expect(repository.createCompanyContact).not.toHaveBeenCalled();
      });

      it('公司不存在 → **400 且不落库**（不能写出一条指向不存在公司的就职记录）', async () => {
        const { service, repository } = createService({ companyById: null });

        const error = await runWithContext(CONTEXT, () =>
          captureAppError(() =>
            service.linkContactEmployment({ contactId: CONTACT_ID, companyId: COMPANY_ID }),
          ),
        );

        expect(error.httpStatus).toBe(400);
        expect(error.message).toContain('公司不存在');
        expect(repository.createCompanyContact).not.toHaveBeenCalled();
      });

      it('只读角色（管理员 / 交付 / 客服）→ **403 且不落库**（同「建档」那道门）', async () => {
        const { service, repository } = createService({
          companyById: companyRow({ id: COMPANY_ID }),
        });

        const error = await runWithContext({ ...CONTEXT, roleCodes: ['admin'] }, () =>
          captureAppError(() =>
            service.linkContactEmployment({ contactId: CONTACT_ID, companyId: COMPANY_ID }),
          ),
        );

        expect(error.httpStatus).toBe(403);
        expect(error.constraint).toBe('company.read_only');
        expect(repository.createCompanyContact).not.toHaveBeenCalled();
      });
    });
  });

  // ===========================================================================
  // M6-15 联系人详情（→ 接口 §5.5 `GET /contacts/:id`；欠账 D-03）
  //
  // 两条最要紧的判据：**锁跟人**（上锁时主号与备用号一并隐藏）与
  // **「待关联」只给归属人**（列表与详情必须是同一套判定，不许一处宽一处严）。
  // ===========================================================================
  describe('M6-15 getContact（联系人详情）', () => {
    const EMPLOYMENTS = [
      {
        is_current: true,
        position: '采购总监',
        joined_at: new Date('2020-01-01T00:00:00Z'),
        left_at: null,
        company: { id: 3n, full_name: '合肥测试建材有限公司' },
      },
      {
        is_current: false,
        position: '采购经理',
        joined_at: new Date('2015-01-01T00:00:00Z'),
        left_at: new Date('2019-12-31T00:00:00Z'),
        company: { id: 5n, full_name: '安徽鑫中网信息技术有限公司' },
      },
    ];

    it('正常：**给全号** ＋ 备用号 ＋ 就职历史 ＋ 特质文案取自字典（→ §2.8 / §5.5）', async () => {
      const { service } = createService({
        employments: EMPLOYMENTS,
        traits: [{ trait_id: 12n, trait_code: 'price_sensitive' }],
        dictLabels: [{ id: 12n, label: '价格敏感' }],
      });

      const detail = await runWithContext(CONTEXT, () => service.getContact('11'));

      expect(detail.phone).toBe('13800000000');
      expect(detail.phone_locked).toBe(false);
      expect(detail.phone_locked_by).toBeNull();
      expect(detail.extra_phones).toEqual([{ type: 'landline', number: '0551-12345678' }]);
      expect(detail.traits).toEqual([
        { trait_id: 12n, trait_code: 'price_sensitive', label: '价格敏感' },
      ]);
      // 顺序＝仓储给的顺序（在职在前由 `orderBy` 保证，service 不重排）
      expect(detail.employments.map((item) => [item.company_id, item.is_current])).toEqual([
        [3n, true],
        [5n, false],
      ]);
      // DATE 列按 UTC 年-月-日 截断：不能被时区把生日挪一天
      expect(detail.birthday).toBe('1985-03-12');
      expect(detail.tags).toEqual(['爱喝茶']);
    });

    it('★ 锁跟人：被上锁 ＋ 查看者**不是落锁人** → `phone` 与 `extra_phones` **两个键都不出现**', async () => {
      const { service } = createService({
        contactDetail: contactDetailRow({
          phone_locked_at: LOCKED_AT,
          phone_locked_by: LOCKER_ID,
        }),
        employeeRefs: [{ id: LOCKER_ID, name: '李强' }],
      });

      const detail = await runWithContext(CONTEXT, () => service.getContact('11'));

      expect('phone' in detail).toBe(false);
      expect('extra_phones' in detail).toBe(false);
      expect(detail.phone_locked).toBe(true);
      expect(detail.phone_locked_by).toEqual({ id: LOCKER_ID, name: '李强' });
    });

    it('被上锁但查看者**就是落锁人** → 照常全号（锁是自我保护，不挡自己，→ 需求 §4.3 二）', async () => {
      const { service } = createService({
        contactDetail: contactDetailRow({
          phone_locked_at: LOCKED_AT,
          phone_locked_by: OPERATOR_ID,
        }),
      });

      const detail = await runWithContext(CONTEXT, () => service.getContact('11'));

      expect(detail.phone).toBe('13800000000');
      expect(detail.phone_locked).toBe(false);
    });

    it('★ 「待关联」（没挂公司）＋ 查看者不是归属人 → **403**（别人拿到 id 也看不了）', async () => {
      const { service, dict } = createService({
        contactDetail: contactDetailRow({ owner_id: LOCKER_ID }),
        employments: [],
      });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.getContact('11')),
      );

      expect(error.httpStatus).toBe(403);
      expect(error.constraint).toBe('contact.out_of_scope');
      // 看不到就**不该再往下取**（字典文案一次都不该问）
      expect(dict.getDictItemLabels).not.toHaveBeenCalled();
    });

    it('「待关联」但**归属人是我** → 正常返回（这就是"我的待跟进"）', async () => {
      const { service } = createService({ employments: [] });

      const detail = await runWithContext(CONTEXT, () => service.getContact('11'));

      expect(detail.id).toBe(11n);
    });

    it('`all` 档（总经理 / 管理员）→ 别人的「待关联」也看得到（与列表同一口径）', async () => {
      const { service } = createService({
        contactDetail: contactDetailRow({ owner_id: LOCKER_ID }),
        employments: [],
      });

      const detail = await runWithContext({ ...CONTEXT, dataScope: { type: 'all', deptIds: [] } }, () =>
        service.getContact('11'),
      );

      expect(detail.id).toBe(11n);
    });

    it('字典项查不到 → `label` 给 `null`（**不编文案**）', async () => {
      const { service } = createService({
        traits: [{ trait_id: 99n, trait_code: 'unknown' }],
        dictLabels: [],
      });

      const detail = await runWithContext(CONTEXT, () => service.getContact('11'));

      expect(detail.traits).toEqual([{ trait_id: 99n, trait_code: 'unknown', label: null }]);
    });

    it('联系人不存在（已删 / 已合并）→ 400（不是 403：先答"有没有"，再答"能不能看"）', async () => {
      const { service } = createService({ contactDetail: null });

      const error = await runWithContext(CONTEXT, () =>
        captureAppError(() => service.getContact('999')),
      );

      expect(error.httpStatus).toBe(400);
      expect(error.constraint).toBe('company.contact_missing');
    });

    it('没有请求上下文 → 401（可见性取决于「我是谁」，没有身份就不能猜）', async () => {
      const { service } = createService();

      const error = await captureAppError(() => service.getContact('11'));

      expect(error.httpStatus).toBe(401);
    });
  });
});

// =============================================================================
// 2026-09-15 审计修补：**只读角色不得建档**
//   病灶＝把需求 §4.2 ★「管理员只读（不能写跟单 / 改关系 / 建合同）」的**举例**当穷尽 ⇒
//         "建档不在举例里 ⇒ 可以做"，于是任何登录人（含管理员 / 交付 / 客服）都能建档。
//   依据＝同 ★「管理员**一律只读**、不参与客户经营」＋ 交付 / 客服「不做客户经营动作」；
//   判定＝`kernel/data-scope/write-role.ts`（**多角色取"能写"**）。
// =============================================================================
describe('CompanyService（只读角色 · 2026-09-15）', () => {
  const READ_ONLY: [string, string[]][] = [
    ['管理员', ['admin']],
    ['交付', ['delivery']],
    ['客服', ['service']],
  ];

  it.each(READ_ONLY)('%s 建档公司 → 403 / 20003', async (_who, roleCodes) => {
    const { service } = createService();

    const error = await runWithContext({ ...CONTEXT, roleCodes }, () =>
      captureAppError(() => service.createCompany({ full_name: '安徽测试建材有限公司' })),
    );

    expect(error.httpStatus).toBe(403);
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    expect(error.constraint).toBe('company.read_only');
  });

  it('管理员建档联系人 → 403 / 20003（同一个写入口，同一道门）', async () => {
    const { service } = createService();

    const error = await runWithContext({ ...CONTEXT, roleCodes: ['admin'] }, () =>
      captureAppError(() => service.createContact({ name: '张总', phone: '13900000001' })),
    );

    expect(error.httpStatus).toBe(403);
    expect(error.constraint).toBe('company.read_only');
  });

  it('`admin` ＋ `sale` 叠加 → **仍可写**（多角色取"能写"，不是"有一个只读角色就全禁"）', async () => {
    const { service } = createService();

    await expect(
      runWithContext({ ...CONTEXT, roleCodes: ['admin', 'sale'] }, () =>
        service.createCompany({ full_name: '安徽测试建材有限公司' }),
      ),
    ).resolves.toBeDefined();
  });
});

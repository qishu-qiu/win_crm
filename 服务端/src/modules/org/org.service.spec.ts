// =============================================================================
// A 域服务用例（M1-08 登录 / M1-09 刷新 / M1-10 me / M1-13 列表装配 / M1-15 审计）
//
// 判据逐字（《开发计划》）：
//   M1-08「单测：错密码 → 401」· M1-09「单测：过期 token 可刷新、伪造 token 拒绝」
//   M1-10「单测：输出结构与接口 §五 一致」· M1-15「审计：登录成功 / 失败写 `operation_log`（**事务内**）」
//
// ★ 为什么用**真 JwtService 真签名真验签**（不 mock）：mock 掉它就只能证明「我调用了它」，
//   证明不了「签发的令牌能被守卫的口径解回来」—— 后者才是登录的价值（坑 15 的反面用法）。
// ★ 为什么审计假件里读 `getTransactionClient()`：M1-15 的判据是「**事务内**」，而「跑一遍没抛」
//   证明不了它（坑 15）。这里把「写审计的那一刻 ALS 里到底有没有 tx」记下来，是**结构事实**级的断言。
// =============================================================================
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

import {
  ACCESS_TOKEN_TTL,
  AppError,
  AuditService,
  ErrorCode,
  REFRESH_TOKEN_MARK,
  REFRESH_TOKEN_TTL,
  fromClaims,
  getTransactionClient,
  runWithContext,
  toClaims,
  type AuditLogInput,
  type RequestContext,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from './domain/password';
import { OrgRepository } from './org.repository';
import { OrgService, ORG_AUDIT_ACTIONS, type RequestMeta } from './org.service';

/** 与守卫同一把密钥的测试密钥（长度过 `JWT_SECRET_MIN_LENGTH`） */
const SECRET = 'unit-test-secret-'.padEnd(48, 'x');
const PLAIN_PASSWORD = 'Passw0rd!';
const PHONE = '13800000000';

/** 总经理上下文（`all` 档 → 员工列表**不过滤**）：只验「装配」、不验「收敛」的用例用它 */
const ALL_SCOPE_CONTEXT: RequestContext = {
  employeeId: 7n,
  deptIds: [1n],
  roleCodes: ['gm'],
  dataScope: { type: 'all', deptIds: [] },
};

/** 员工行（形状＝仓储 `EMPLOYEE_AUTH_SELECT` 的返回） */
interface EmployeeFixture {
  id: bigint;
  work_no: string;
  name: string;
  phone: string;
  /** 登录账号名（可空：为空则只能手机号登录，→ 接口 §5.2） */
  username: string | null;
  password_hash: string;
  primary_dept_id: bigint;
  extra_dept_ids: unknown;
  product_line_ids: unknown;
  direct_manager_id: bigint | null;
  status: string;
}

interface EmployeeRowFixture {
  id: bigint;
  work_no: string;
  name: string;
  phone: string;
  username: string | null;
  primary_dept_id: bigint;
  extra_dept_ids: unknown;
  product_line_ids: unknown;
  direct_manager_id: bigint | null;
  status: string;
}

interface FakeRepositories {
  employee?: EmployeeFixture | null;
  roleCodes?: string[];
  managedDeptIds?: bigint[];
  departments?: { id: bigint; name: string }[];
  permissions?: { perm_key: string; role_code: string; level: string }[];
  departmentRows?: { id: bigint; name: string; parent_id: bigint; service_enabled: boolean; status: string }[];
  deptManagers?: { dept_id: bigint; employee_id: bigint }[];
  /**
   * 产品线行：`color_key` / `service_cycle_days` / `status` **可省**（写用例时只关心其中几项），
   * 缺省值在 `createRepository` 里补齐（→ 真实 `listProductLines` 的返回形状不变）。
   */
  productLines?: {
    id: bigint;
    name: string;
    code: string;
    dept_ids: unknown;
    color_key?: string | null;
    service_cycle_days?: number | null;
    status?: string;
  }[];
  employeeRows?: EmployeeRowFixture[];
  rolesByEmployee?: Map<string, string[]>;
  employeeRefs?: { id: bigint; name: string }[];
  roles?: { code: string; name: string; is_builtin: boolean }[];
  permissionMatrix?: { perm_key: string; role_code: string; level: string }[];
}

/** 造一个只为「返回值」负责的仓储替身：**不连库**，所有方法都可被断言调用次数 */
function createRepository(options: FakeRepositories = {}) {
  return {
    findEmployeeByPhone: jest.fn(async (): Promise<EmployeeFixture | null> => options.employee ?? null),
    findEmployeeByUsername: jest.fn(async (): Promise<EmployeeFixture | null> => options.employee ?? null),
    findEmployeeById: jest.fn(async (): Promise<EmployeeFixture | null> => options.employee ?? null),
    findRoleCodes: jest.fn(async (): Promise<string[]> => options.roleCodes ?? []),
    findManagedDeptIds: jest.fn(async (): Promise<bigint[]> => options.managedDeptIds ?? []),
    findDepartmentsByIds: jest.fn(async () => options.departments ?? []),
    findPermissions: jest.fn(async () => options.permissions ?? []),
    findDeptManagers: jest.fn(async () => options.deptManagers ?? []),
    findEmployeesByIds: jest.fn(async () => options.employeeRefs ?? []),
    findRolesByEmployeeIds: jest.fn(async () => options.rolesByEmployee ?? new Map<string, string[]>()),
    listDepartments: jest.fn(async () => options.departmentRows ?? []),
    listProductLines: jest.fn(async () =>
      (options.productLines ?? []).map((line) => ({
        color_key: null,
        service_cycle_days: null,
        status: 'active',
        ...line,
      })),
    ),
    listEmployees: jest.fn(async () => options.employeeRows ?? []),
    listRoles: jest.fn(async () => options.roles ?? []),
    listPermissionMatrix: jest.fn(async () => options.permissionMatrix ?? []),
  };
}

interface AuditRecord {
  input: AuditLogInput;
  /** 写这条审计时，ALS 里到底有没有事务客户端（M1-15 判据本体） */
  inTransaction: boolean;
}

/** 审计替身：**不 mock 掉 `AuditService` 本身**，只替掉它的落库动作，并把「当时有没有事务」记下来 */
function createAudit() {
  const records: AuditRecord[] = [];
  return {
    records,
    service: {
      record: jest.fn(async (input: AuditLogInput): Promise<void> => {
        records.push({ input, inTransaction: getTransactionClient() !== undefined });
      }),
    },
  };
}

/** Prisma 替身：只实现 `$transaction`，把回调喂给 `runInTransaction` 的正是被测代码 */
function createPrisma() {
  const client = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn({})),
  };
  return { client, service: client as unknown as PrismaService };
}

function createService(options: FakeRepositories = {}) {
  const repository = createRepository(options);
  const audit = createAudit();
  const prisma = createPrisma();
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: ACCESS_TOKEN_TTL } });

  return {
    service: new OrgService(repository as unknown as OrgRepository, jwt, audit.service as unknown as AuditService, prisma.service),
    repository,
    audit,
    prisma,
    /** 独立签发的「校验方」实例：用来证明**签发的令牌换个实例也能解回来**（同密钥即互通） */
    verifier: new JwtService({ secret: SECRET }),
  };
}

function employeeFixture(overrides: Partial<EmployeeFixture> = {}): EmployeeFixture {
  return {
    id: 7n,
    work_no: 'A007',
    name: '张三',
    phone: PHONE,
    username: 'zhangsan',
    password_hash: '',
    primary_dept_id: 1n,
    extra_dept_ids: null,
    product_line_ids: null,
    direct_manager_id: null,
    status: 'active',
    ...overrides,
  };
}

function expectAppError(error: unknown, httpStatus: number, code: number): void {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).httpStatus).toBe(httpStatus);
  expect((error as AppError).code).toBe(code);
}

/** 断言某次调用抛出的就是期望的 AppError（async 抛错不会同步冒出来，必须走 rejects） */
async function captureAppError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expectAppError(error, (error as AppError).httpStatus, (error as AppError).code);
    return error as AppError;
  }
  throw new Error('预期抛错，但调用成功返回了');
}

describe('A 域服务（M1-08 / M1-09 / M1-10 / M1-13 / M1-15）', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(PLAIN_PASSWORD);
  });

  describe('M1-08 login', () => {
    it('成功：双令牌 ＋ `UserVO`；令牌能被**守卫的口径**解回上下文（签发 / 校验同源）', async () => {
      const { service, verifier } = createService({
        employee: employeeFixture({ password_hash: passwordHash, extra_dept_ids: [2, 1] }),
        roleCodes: ['sale'],
        departments: [{ id: 1n, name: '华东一部' }],
        permissions: [
          { perm_key: 'customer.view', role_code: 'sale', level: 'visible' },
          { perm_key: 'customer.export', role_code: 'sale', level: 'denied' },
        ],
      });

      const result = await service.login({ account: PHONE, password: PLAIN_PASSWORD });

      expect(result.user).toEqual({
        id: 7n,
        name: '张三',
        username: 'zhangsan',
        role: 'sale',
        dept: { id: 1n, name: '华东一部' },
        managed_dept_ids: [],
        permissions: { 'customer.export': 'denied', 'customer.view': 'visible' },
      });

      // ★ 关键：**不手搓键名**，直接过 `fromClaims`（守卫用的同一个函数）
      const context = fromClaims(verifier.verify(result.access_token));
      expect(context).toEqual({
        employeeId: 7n,
        // 主部门 1 ＋ 兼部门 [2,1] → 去重后 [1,2]（重复的 1 不出现两次）
        deptIds: [1n, 2n],
        roleCodes: ['sale'],
        dataScope: { type: 'self', deptIds: [] },
      });

      // 刷新令牌带判别位 `tk`，且主体同一个人
      const refreshPayload = verifier.verify<{ tk?: string; sub?: string }>(result.refresh_token);
      expect(refreshPayload.tk).toBe(REFRESH_TOKEN_MARK);
      expect(refreshPayload.sub).toBe('7');

      // 有效期真进了令牌（不是靠签名「看起来对」）
      const accessPayload = verifier.verify<{ exp?: number; iat?: number }>(result.access_token);
      expect((accessPayload.exp ?? 0) - (accessPayload.iat ?? 0)).toBe(2 * 60 * 60);
    });

    it('成功：写一条 `account.login.success` 审计，且**在事务内**（M1-15 判据）', async () => {
      const { service, audit, prisma } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
        departments: [{ id: 1n, name: '华东一部' }],
      });

      await service.login({ account: PHONE, password: PLAIN_PASSWORD }, { ip: '10.0.0.8', user_agent: 'jest' });

      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(audit.records).toHaveLength(1);
      const [record] = audit.records;
      expect(record?.inTransaction).toBe(true);
      expect(record?.input).toMatchObject({
        action: ORG_AUDIT_ACTIONS.loginSuccess,
        operator_id: 7n,
        operator_name: '张三',
        dept_id: 1n,
        ip: '10.0.0.8',
        user_agent: 'jest',
      });
    });

    it('经理：`dept` 档带管辖部门；`dept_ids` ＝ 所属 ∪ 管辖', async () => {
      const { service, verifier } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale', 'dept_manager'],
        managedDeptIds: [3n, 4n],
        departments: [{ id: 1n, name: '华东一部' }],
      });

      const result = await service.login({ account: PHONE, password: PLAIN_PASSWORD });

      expect(fromClaims(verifier.verify(result.access_token))).toEqual({
        employeeId: 7n,
        deptIds: [1n, 3n, 4n],
        roleCodes: ['sale', 'dept_manager'],
        dataScope: { type: 'dept', deptIds: [3n, 4n] },
      });
      expect(result.user.role).toBe('dept_manager');
      expect(result.user.managed_dept_ids).toEqual([3n, 4n]);
    });

    it('**账号名通道**（双通道）：`account` 非手机号格式 → 查 `username`、**不查手机号**，结果与手机号通道同形', async () => {
      const { service, repository, verifier } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
        departments: [{ id: 1n, name: '华东一部' }],
      });

      const result = await service.login({ account: 'ZhangSan', password: PLAIN_PASSWORD });

      expect(repository.findEmployeeByUsername).toHaveBeenCalledWith('ZhangSan');
      expect(repository.findEmployeeByPhone).not.toHaveBeenCalled();
      expect(result.user.username).toBe('zhangsan');
      // 通道只是「怎么找到人」，签发出来的令牌与手机号通道**没有任何区别**
      expect(fromClaims(verifier.verify(result.access_token))).toEqual({
        employeeId: 7n,
        deptIds: [1n],
        roleCodes: ['sale'],
        dataScope: { type: 'self', deptIds: [] },
      });
    });

    it('**手机号通道**：`account` 是 11 位手机号 → 只查 `phone`、**不查账号名**（判别是确定性的，不靠「查不到再回退」）', async () => {
      const { service, repository } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
      });

      await service.login({ account: PHONE, password: PLAIN_PASSWORD });

      expect(repository.findEmployeeByPhone).toHaveBeenCalledWith(PHONE);
      expect(repository.findEmployeeByUsername).not.toHaveBeenCalled();
    });

    it('账号名不存在 → 401 / 20002；审计原因按**通道**区分（`username_not_found`），对外仍是同一句人话', async () => {
      const { service, audit } = createService({});

      const error = await captureAppError(() =>
        service.login({ account: 'nobody_here', password: PLAIN_PASSWORD }),
      );

      expect(error.httpStatus).toBe(401);
      expect(error.message).toBe('手机号或密码不正确');
      expect(audit.records[0]?.input).toMatchObject({
        action: ORG_AUDIT_ACTIONS.loginFail,
        operator_id: 0n,
        detail: { account: 'nobody_here', channel: 'username', reason: 'username_not_found' },
      });
    });

    it('手机号不存在 → 401 / 20002，人话与「密码错」**完全一致**（这个接口不能当手机号枚举器）', async () => {
      const { service, audit } = createService({});

      const error = await captureAppError(() => service.login({ account: PHONE, password: PLAIN_PASSWORD }));

      expect(error.message).toBe('手机号或密码不正确');
      expect(error.constraint).toBe('account.login.credentials');
      // 审计先落再抛：真实原因只进 detail，供安全排查
      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]?.input).toMatchObject({
        action: ORG_AUDIT_ACTIONS.loginFail,
        operator_id: 0n, // A10：系统动作 = 0（此处表示「无对应员工」，绝不用 undefined）
        detail: { account: PHONE, channel: 'phone', reason: 'phone_not_found' },
      });
    });

    it('密码错 → 401 / 20002（判据本体），审计记 `bad_password` 且**不含明文密码**', async () => {
      const { service, audit } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
      });

      const error = await captureAppError(() => service.login({ account: PHONE, password: 'WrongOne!' }));

      expect(error.httpStatus).toBe(401);
      expect(error.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(error.message).toBe('手机号或密码不正确');

      expect(audit.records[0]?.input).toMatchObject({
        action: ORG_AUDIT_ACTIONS.loginFail,
        operator_id: 7n,
        detail: { reason: 'bad_password' },
      });
      // 密码是**永远不许进日志**的东西（哪怕日志本身很敏感）。
      // ⚠ 序列化要自己带 bigint 兜底：审计入参里有 `operator_id: bigint`，`JSON.stringify` 直接抛
      //   （这正是 M0-33 出口必须过 `toJsonSafe` 的原因，此处顺手又证了一遍）
      const serialized = JSON.stringify(audit.records[0]?.input, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).not.toContain('WrongOne!');
      expect(serialized).not.toContain(PLAIN_PASSWORD);
      expect(serialized).toContain('bad_password');
    });

    it('账号停用 → 403 / 20003（凭据是对的，是账号不该进），审计记 `login.rejected`', async () => {
      const { service, audit } = createService({
        employee: employeeFixture({ password_hash: passwordHash, status: 'disabled' }),
      });

      const error = await captureAppError(() => service.login({ account: PHONE, password: PLAIN_PASSWORD }));

      expect(error.httpStatus).toBe(403);
      expect(error.code).toBe(ErrorCode.FORBIDDEN);
      expect(audit.records[0]?.input).toMatchObject({
        action: ORG_AUDIT_ACTIONS.loginRejected,
        detail: { status: 'disabled' },
      });
    });

    it('密码哈希损坏（脏数据）→ 401 而不是 500（脏数据不该把登录打成系统故障）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: 'not-a-valid-hash' }),
      });

      const error = await captureAppError(() => service.login({ account: PHONE, password: PLAIN_PASSWORD }));

      expect(error.httpStatus).toBe(401);
    });
  });

  describe('M1-09 refresh', () => {
    /** 用「旧上下文」签一枚刷新令牌（模拟前端手里那枚） */
    function signRefreshToken(
      context: RequestContext,
      options: { secret?: string; expiresIn?: JwtSignOptions['expiresIn'] } = {},
    ): string {
      const signer = new JwtService({ secret: options.secret ?? SECRET });
      return signer.sign(
        { ...toClaims(context), tk: REFRESH_TOKEN_MARK },
        { expiresIn: options.expiresIn ?? REFRESH_TOKEN_TTL },
      );
    }

    const OLD_CONTEXT: RequestContext = {
      employeeId: 7n,
      deptIds: [1n],
      roleCodes: ['sale'],
      dataScope: { type: 'self', deptIds: [] },
    };

    it('有效刷新令牌 → 换到新的一对，且**重新装载**最新角色 / 管辖部门（刚被撤经理的人不能靠旧范围继续查数）', async () => {
      const { service, verifier } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        // 库里的**当前**状态：已升为经理并管辖 3 号部门
        roleCodes: ['dept_manager', 'sale'],
        managedDeptIds: [3n],
      });

      const result = await service.refresh(signRefreshToken(OLD_CONTEXT));

      expect(Object.keys(result).sort()).toEqual(['access_token', 'refresh_token']);
      expect(fromClaims(verifier.verify(result.access_token))).toEqual({
        employeeId: 7n,
        deptIds: [1n, 3n],
        roleCodes: ['dept_manager', 'sale'],
        dataScope: { type: 'dept', deptIds: [3n] },
      });
      expect(verifier.verify<{ tk?: string }>(result.refresh_token).tk).toBe(REFRESH_TOKEN_MARK);
    });

    it('过期的 access_token 仍可用 refresh_token 换新（判据「过期 token 可刷新」的真实语义）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
      });
      const expiredAccess = new JwtService({ secret: SECRET }).sign(toClaims(OLD_CONTEXT), {
        expiresIn: '-1s',
      });

      // 前置：这枚 access 确实已过期（守卫会拒它）
      expect(() => new JwtService({ secret: SECRET }).verify(expiredAccess)).toThrow();

      const result = await service.refresh(signRefreshToken(OLD_CONTEXT));

      expect(typeof result.access_token).toBe('string');
      expect(() => new JwtService({ secret: SECRET }).verify(result.access_token)).not.toThrow();
    });

    it('把 `access_token` 当刷新令牌用 → 401 / 20002（判别位 `tk` 把关，否则等于无限续期）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
      });
      const accessToken = new JwtService({ secret: SECRET }).sign(toClaims(OLD_CONTEXT));

      const error = await captureAppError(() => service.refresh(accessToken));

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('account.refresh.kind');
    });

    it('伪造（换一把密钥签）→ 401', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
      });

      const error = await captureAppError(() =>
        service.refresh(signRefreshToken(OLD_CONTEXT, { secret: 'attacker-secret-'.padEnd(48, 'z') })),
      );

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('account.refresh.verify');
    });

    it('已过期的 refresh_token → 401（过期就是过期，不能续）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
      });

      const error = await captureAppError(() =>
        service.refresh(signRefreshToken(OLD_CONTEXT, { expiresIn: '-1s' })),
      );

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('account.refresh.verify');
    });

    it('令牌合法但人已被删 → 401（续期的前提是人还在）', async () => {
      const { service } = createService({});

      const error = await captureAppError(() => service.refresh(signRefreshToken(OLD_CONTEXT)));

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('account.employee.missing');
    });

    it('令牌合法但人已停用 → 403 / 20003（停用的账号不许靠旧刷新令牌复活）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash, status: 'resigned' }),
      });

      const error = await captureAppError(() => service.refresh(signRefreshToken(OLD_CONTEXT)));

      expect(error.httpStatus).toBe(403);
      expect(error.code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('M1-10 me', () => {
    it('不在请求链上（无上下文）→ 401 / 20002，**不静默降级成匿名**', async () => {
      const { service } = createService({});

      const error = await captureAppError(() => service.me());

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('account.me.no_context');
    });

    it('有上下文 → `UserVO` 结构与接口 §5.2 一致（含 role / dept / managed_dept_ids / permissions）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale', 'dept_manager'],
        managedDeptIds: [3n],
        departments: [{ id: 1n, name: '华东一部' }],
        permissions: [{ perm_key: 'customer.view', role_code: 'dept_manager', level: 'visible' }],
      });

      const context: RequestContext = {
        employeeId: 7n,
        deptIds: [1n, 3n],
        roleCodes: ['sale', 'dept_manager'],
        dataScope: { type: 'dept', deptIds: [3n] },
      };

      await expect(runWithContext(context, () => service.me())).resolves.toEqual({
        id: 7n,
        name: '张三',
        username: 'zhangsan',
        role: 'dept_manager',
        dept: { id: 1n, name: '华东一部' },
        managed_dept_ids: [3n],
        permissions: { 'customer.view': 'visible' },
      });
    });

    it('主部门在主数据里查不到 → `dept` 为 null（不编造、不抛错）', async () => {
      const { service } = createService({
        employee: employeeFixture({ password_hash: passwordHash }),
        roleCodes: ['sale'],
        departments: [],
      });

      const context: RequestContext = {
        employeeId: 7n,
        deptIds: [1n],
        roleCodes: ['sale'],
        dataScope: { type: 'self', deptIds: [] },
      };

      const user = await runWithContext(context, () => service.me());

      expect(user.dept).toBeNull();
    });
  });

  describe('M1-13 只读列表的装配（真正需要逻辑的两处：经理聚合、产品线反向索引）', () => {
    it('部门列表：`manager_ids` 按部门聚合；`product_line_ids` 由**产品线侧**的 `dept_ids` 反查（含字符串脏数据容错）', async () => {
      const { service } = createService({
        departmentRows: [
          { id: 1n, name: '华东', parent_id: 0n, service_enabled: false, status: 'active' },
          { id: 2n, name: '一部', parent_id: 1n, service_enabled: true, status: 'active' },
        ],
        deptManagers: [
          { dept_id: 2n, employee_id: 7n },
          { dept_id: 2n, employee_id: 8n },
        ],
        // `dept_ids` 里刻意混一个字符串 "3"（手工导入的脏数据）→ 必须照样解析出来
        productLines: [{ id: 5n, name: '标准线', code: 'STD', dept_ids: [2, '3'] }],
      });

      const departments = await service.listDepartments();

      expect(departments).toEqual([
        {
          id: 1n,
          name: '华东',
          parent_id: 0n,
          service_enabled: false,
          status: 'active',
          manager_ids: [],
          product_line_ids: [],
        },
        {
          id: 2n,
          name: '一部',
          parent_id: 1n,
          service_enabled: true,
          status: 'active',
          manager_ids: [7n, 8n],
          product_line_ids: [5n],
        },
      ]);
    });

    it('产品线列表：`dept_ids` 转十进制字符串（含脏数据）、`color_key` 未配置保持 `null`（→ 接口 §5.3）', async () => {
      const { service } = createService({
        productLines: [
          // `dept_ids` 里混一个字符串 "3"（手工导入的脏数据）；配色 / 服务周期 / 状态均走缺省
          { id: 5n, name: '标准线', code: 'STD', dept_ids: [2, '3'] },
          {
            id: 6n,
            name: '小程序线',
            code: 'MP',
            dept_ids: null,
            color_key: 'green',
            service_cycle_days: 180,
            status: 'disabled',
          },
        ],
      });

      const lines = await service.listProductLines();

      expect(lines).toEqual([
        {
          id: 5n,
          name: '标准线',
          code: 'STD',
          // ★ 未配置 = `null`（**不编默认色**：假默认色会让页面理直气壮渲染错颜色）
          color_key: null,
          dept_ids: ['2', '3'],
          service_cycle_days: null,
          status: 'active',
        },
        {
          id: 6n,
          name: '小程序线',
          code: 'MP',
          color_key: 'green',
          dept_ids: [],
          service_cycle_days: 180,
          status: 'disabled',
        },
      ]);
    });

    it('员工列表：主 / 兼部门、产品线、直属经理都装配成 `{id,name}`，且**不含密码哈希**', async () => {
      const { service } = createService({
        employeeRows: [
          {
            id: 7n,
            work_no: 'A007',
            name: '张三',
            phone: PHONE,
            username: 'zhangsan',
            primary_dept_id: 1n,
            extra_dept_ids: [2],
            product_line_ids: [5],
            direct_manager_id: 9n,
            status: 'active',
          },
        ],
        rolesByEmployee: new Map([['7', ['sale']]]),
        departments: [
          { id: 1n, name: '华东' },
          { id: 2n, name: '一部' },
        ],
        productLines: [{ id: 5n, name: '标准线', code: 'STD', dept_ids: [] }],
        employeeRefs: [{ id: 9n, name: '李四' }],
      });

      const employees = await runWithContext(ALL_SCOPE_CONTEXT, () => service.listEmployees());

      expect(employees).toEqual([
        {
          id: 7n,
          work_no: 'A007',
          name: '张三',
          phone: PHONE,
          username: 'zhangsan',
          primary_dept: { id: 1n, name: '华东' },
          extra_depts: [{ id: 2n, name: '一部' }],
          product_lines: [{ id: 5n, name: '标准线' }],
          direct_manager: { id: 9n, name: '李四' },
          roles: ['sale'],
          status: 'active',
        },
      ]);
      // 出参里**一个哈希字段都不许有**（列表接口不是登录路径，没有任何理由带它出库）
      expect(Object.keys(employees[0] ?? {})).not.toContain('password_hash');
    });

    it('员工列表：无直属经理 / 关联已删部门 → 对应字段为 null / 被丢弃（不编造占位值）', async () => {
      const { service } = createService({
        employeeRows: [
          {
            id: 7n,
            work_no: 'A007',
            name: '张三',
            phone: PHONE,
            username: null,
            primary_dept_id: 1n,
            extra_dept_ids: [99],
            product_line_ids: [],
            direct_manager_id: null,
            status: 'active',
          },
        ],
        departments: [{ id: 1n, name: '华东' }],
      });

      const employees = await runWithContext(ALL_SCOPE_CONTEXT, () => service.listEmployees());

      expect(employees[0]?.direct_manager).toBeNull();
      expect(employees[0]?.extra_depts).toEqual([]);
      expect(employees[0]?.roles).toEqual([]);
      // `username` 可空（→ §5.2）：无账号名时给 `null`，**不是**把它当异常
      expect(employees[0]?.username).toBeNull();
    });

    it('**G7 收敛**（→ 接口 §4.2）：`all` 一条不少 / `dept` 只留管辖部门 / `self` 只留同部门（**兼部门命中也算**）', async () => {
      /** 四条员工：本部门 / 同部门 / 靠兼部门命中的异地员工 / 完全不相干的部门 */
      const rows: EmployeeRowFixture[] = [
        {
          id: 7n,
          work_no: 'A007',
          name: '我（主部门 1）',
          phone: PHONE,
          username: null,
          primary_dept_id: 1n,
          extra_dept_ids: null,
          product_line_ids: [],
          direct_manager_id: null,
          status: 'active',
        },
        {
          id: 8n,
          work_no: 'A008',
          name: '同部门（主部门 2）',
          phone: '13800000001',
          username: null,
          primary_dept_id: 2n,
          extra_dept_ids: null,
          product_line_ids: [],
          direct_manager_id: null,
          status: 'active',
        },
        {
          id: 9n,
          work_no: 'A009',
          name: '主部门 9、兼部门 1',
          phone: '13800000002',
          username: null,
          primary_dept_id: 9n,
          extra_dept_ids: [1],
          product_line_ids: [],
          direct_manager_id: null,
          status: 'active',
        },
        {
          id: 10n,
          work_no: 'A010',
          name: '别的部门（主部门 3）',
          phone: '13800000003',
          username: null,
          primary_dept_id: 3n,
          extra_dept_ids: null,
          product_line_ids: [],
          direct_manager_id: null,
          status: 'active',
        },
      ];
      const { service } = createService({ employeeRows: rows });

      // 总经理 / 管理员（all）：不过滤
      const all = await runWithContext(ALL_SCOPE_CONTEXT, () => service.listEmployees());
      expect(all.map((employee) => employee.id)).toEqual([7n, 8n, 9n, 10n]);

      // 销售（self，所属部门 1 / 2）：同部门可见 —— 9 号靠**兼部门** 1 命中，不能漏
      const self = await runWithContext(
        {
          employeeId: 7n,
          deptIds: [1n, 2n],
          roleCodes: ['sale'],
          dataScope: { type: 'self', deptIds: [] },
        },
        () => service.listEmployees(),
      );
      expect(self.map((employee) => employee.id)).toEqual([7n, 8n, 9n]);

      // 经理（dept，管辖部门 3）：只看 10 号 —— 管辖部门与我所属部门是两回事
      const dept = await runWithContext(
        {
          employeeId: 7n,
          deptIds: [1n, 3n],
          roleCodes: ['dept_manager'],
          dataScope: { type: 'dept', deptIds: [3n] },
        },
        () => service.listEmployees(),
      );
      expect(dept.map((employee) => employee.id)).toEqual([10n]);
    });

    it('**G7 收敛**：拿不到上下文 → 401 / 20002（**绝不兜底成全量** —— 兜底＝越权读全公司通讯录）', async () => {
      const { service } = createService({ employeeRows: [] });

      const error = await captureAppError(() => service.listEmployees());

      expect(error.httpStatus).toBe(401);
      expect(error.constraint).toBe('org.employees.no_context');
    });

    it('角色列表与权限矩阵：直接透传仓储结果（这一层不该有加工，加工了就是双真相源）', async () => {
      const { service, repository } = createService({
        roles: [{ code: 'sale', name: '销售', is_builtin: true }],
        permissionMatrix: [{ perm_key: 'customer.view', role_code: 'sale', level: 'visible' }],
      });

      await expect(service.listRoles()).resolves.toEqual([
        { code: 'sale', name: '销售', is_builtin: true },
      ]);
      await expect(service.listPermissions()).resolves.toEqual([
        { perm_key: 'customer.view', role_code: 'sale', level: 'visible' },
      ]);
      expect(repository.listRoles).toHaveBeenCalledTimes(1);
      expect(repository.listPermissionMatrix).toHaveBeenCalledTimes(1);
    });
  });

  it('`toRequestMeta` 只带有的键（controller 侧的元信息组装契约）', async () => {
    const meta: RequestMeta = { ip: '10.0.0.8' };
    const { service, audit } = createService({
      employee: employeeFixture({ password_hash: passwordHash }),
      roleCodes: ['sale'],
    });

    await service.login({ account: PHONE, password: PLAIN_PASSWORD }, meta);

    expect(audit.records[0]?.input.ip).toBe('10.0.0.8');
    expect(audit.records[0]?.input.user_agent).toBeUndefined();
    expect(audit.records[0]?.input.req_id).toBeUndefined();
  });
});

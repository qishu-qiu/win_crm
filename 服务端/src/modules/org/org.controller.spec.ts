// =============================================================================
// A 域控制器用例（M1-11 / M1-12 / M1-13 的「路由契约」与本层纪律）
//
// 判据逐字（《开发计划》）：M1-11「`/docs` 可见 + 真调通，返回统一包」· M1-13「curl 返回列表且字段齐」。
// ★ 真调通 / 真返回由 curl 现场验（M1 完成报告里贴命令与输出）；**单测负责另外两件 curl 看不出来的事**：
//   ① 路由与公开性**恰好**是规格里那 7 条（多一条 = 多一个未授权入口，少一条 = 前端 404）；
//   ② controller **只解析请求 + 调一个 service**（注入的东西多了就是分层被侵蚀，坑 15 的正面用法）。
// =============================================================================
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { IS_PUBLIC_KEY } from '../../kernel/index';
import { OrgController, toRequestMeta } from './org.controller';
import { OrgService } from './org.service';

type HandlerName = 'login' | 'refresh' | 'me' | 'listDepartments' | 'listEmployees' | 'listRoles' | 'listPermissions';

interface RouteExpectation {
  handler: HandlerName;
  /** → 接口API文档 §三 接口总览（路径不带前导斜杠，与 `@Post('account/login')` 的字面量一致） */
  path: string;
  method: (typeof RequestMethod)[keyof typeof RequestMethod];
  /** `true` ＝ 免鉴权（只有登录与刷新，→ §2.2） */
  isPublic: boolean;
}

const ROUTES: RouteExpectation[] = [
  { handler: 'login', path: 'account/login', method: RequestMethod.POST, isPublic: true },
  { handler: 'refresh', path: 'account/refresh', method: RequestMethod.POST, isPublic: true },
  { handler: 'me', path: 'account/me', method: RequestMethod.GET, isPublic: false },
  { handler: 'listDepartments', path: 'org/departments', method: RequestMethod.GET, isPublic: false },
  { handler: 'listEmployees', path: 'org/employees', method: RequestMethod.GET, isPublic: false },
  { handler: 'listRoles', path: 'org/roles', method: RequestMethod.GET, isPublic: false },
  { handler: 'listPermissions', path: 'org/permissions', method: RequestMethod.GET, isPublic: false },
];

function createServiceStub() {
  return {
    login: jest.fn(async () => ({ access_token: 'a', refresh_token: 'r', user: { id: 7n } })),
    refresh: jest.fn(async () => ({ access_token: 'a2', refresh_token: 'r2' })),
    me: jest.fn(async () => ({ id: 7n })),
    listDepartments: jest.fn(async () => [{ id: 1n }]),
    listEmployees: jest.fn(async () => [{ id: 7n }]),
    listRoles: jest.fn(async () => [{ code: 'sale' }]),
    listPermissions: jest.fn(async () => [{ perm_key: 'customer.view' }]),
  };
}

function createController() {
  const stub = createServiceStub();
  return { controller: new OrgController(stub as unknown as OrgService), stub };
}

describe('A 域控制器（M1-11 / M1-12 / M1-13）', () => {
  describe('路由契约（与接口API文档 §三 / §2.2 逐条对齐）', () => {
    it.each(ROUTES)(
      '$method $path → OrgController.$handler',
      ({ handler, path, method }) => {
        const target = OrgController.prototype[handler];

        expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
        expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(method);
      },
    );

    it.each(ROUTES.filter((route) => route.isPublic))(
      '$path 免鉴权（`@Public()`）：不打这一枪就会被全局守卫 401 挡死，登录根本进不来',
      ({ handler }) => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, OrgController.prototype[handler])).toBe(true);
      },
    );

    it.each(ROUTES.filter((route) => !route.isPublic))(
      '$path 必须鉴权（**没有** `@Public()`）',
      ({ handler }) => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, OrgController.prototype[handler])).toBeUndefined();
      },
    );

    it('类级路径前缀为空（Nest 归一成 `/`），且**只挂了这 7 条路由**（多一条就是多一个没人评审过的入口）', () => {
      // Nest 会把 `@Controller()` 的空前缀归一成 `/`，路径拼接时再被各 handler 的完整路径覆盖
      expect(Reflect.getMetadata(PATH_METADATA, OrgController)).toBe('/');

      const prototype = OrgController.prototype as unknown as Record<string, unknown>;
      const routed = Object.getOwnPropertyNames(prototype)
        // `prototype.constructor` 会**继承到类级**的 PATH_METADATA（自身没有 handler 元数据），必须排掉
        .filter((name) => name !== 'constructor')
        .filter((name) => Reflect.getMetadata(PATH_METADATA, prototype[name] as object) !== undefined);
      // `toRequestMeta` 是模块级导出（不在 prototype 上），故这里应**恰好**是 ROUTES 的 7 个 handler
      expect(routed.sort()).toEqual([...ROUTES.map((route) => route.handler)].sort());
    });
  });

  describe('本层纪律：只解析请求 + 调一个 service（架构 §5.4）', () => {
    it('构造签名只有 1 个依赖（`OrgService`）—— 不许注入仓储 / Prisma / 审计（那是 service 的事）', () => {
      expect(OrgController.length).toBe(1);

      const paramTypes = Reflect.getMetadata('design:paramtypes', OrgController) as unknown[];
      expect(paramTypes).toEqual([OrgService]);
    });

    /** 每个 handler 的最小合法入参（位置与运行时装饰器注入顺序一致：body → ip → ua → req_id） */
    const HANDLER_ARGS: Record<HandlerName, unknown[]> = {
      login: [{ phone: '13800000000', password: 'Passw0rd!' }, '10.0.0.8', 'jest-agent', 'req-1'],
      refresh: [{ refresh_token: 'opaque-token' }],
      me: [],
      listDepartments: [],
      listEmployees: [],
      listRoles: [],
      listPermissions: [],
    };

    it.each(ROUTES.map((route) => route.handler))('%s 转交 service，且**只调一次**（本层不做编排）', async (handler) => {
      const { controller, stub } = createController();

      await (controller[handler] as (...args: unknown[]) => Promise<unknown>)(...HANDLER_ARGS[handler]);

      expect(stub[handler]).toHaveBeenCalledTimes(1);
    });

    it('login 把 body 与「IP / UA / req_id」两件东西一起交给 service（controller 不自己拼审计入参）', async () => {
      const { controller, stub } = createController();
      const body = { phone: '13800000000', password: 'Passw0rd!' };

      await controller.login(body, '10.0.0.8', 'jest-agent', 'req-0001');

      expect(stub.login).toHaveBeenCalledWith(body, {
        ip: '10.0.0.8',
        user_agent: 'jest-agent',
        req_id: 'req-0001',
      });
    });

    it('refresh 只把 `refresh_token` 一个字段交给 service（不接受整包过手，避免把 body 直接塞进 jwt.verify）', async () => {
      const { controller, stub } = createController();

      await controller.refresh({ refresh_token: 'opaque-token' });

      expect(stub.refresh).toHaveBeenCalledWith('opaque-token');
    });
  });

  describe('toRequestMeta：空值不写键（审计入参语义「缺省 = 不写该列」）', () => {
    it('三个值都在 → 三个键都在', () => {
      expect(toRequestMeta('10.0.0.8', 'jest-agent', 'req-1')).toEqual({
        ip: '10.0.0.8',
        user_agent: 'jest-agent',
        req_id: 'req-1',
      });
    });

    it('三个都没有（直连 / 无头）→ 空对象，**不是** `{ip: undefined, ...}`', () => {
      expect(toRequestMeta(undefined, undefined, undefined)).toEqual({});
    });

    it('空串与缺失同等对待（头存在但为空，不该在审计里留一个空壳字段）', () => {
      expect(toRequestMeta('', '', '')).toEqual({});
    });

    it('缺哪个就不写哪个（不影响其它键）', () => {
      expect(toRequestMeta('10.0.0.8', undefined, 'req-1')).toEqual({ ip: '10.0.0.8', req_id: 'req-1' });
    });
  });
});

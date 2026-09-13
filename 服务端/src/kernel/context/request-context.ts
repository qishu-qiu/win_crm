// =============================================================================
// 请求上下文（M0-26）—— 一次解析、全程可用（架构 §7.1）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.1 §7.1：
//       `RequestContext = { employeeId, deptIds, roleCodes, dataScope: { type: 'self'|'dept'|'all', deptIds } }`
//       （计划行 M0-26 把字段概写成「userId / deptIds / roles / scope」——**字段名以规格 §7.1 为准**，
//        否则 M0-32 守卫 / M0-36 拦截器会跟着写错名字）
//   · 同 §7.1「★ 关键」：横切层**只读这个上下文、不查数据库**（避免「A 域调权限、权限查 A 域」的循环依赖）
//   · 同 §7.2：`dataScope.type` 决定「我能看到谁」—— 销售 self / 部门经理 dept / 总经理 all
//   · ID 类型 `bigint`：46 张表主键统一 `BigInt @db.UnsignedBigInt`（schema.prisma）
//
// 分层约束（架构 §5.4）：`kernel/**` 零业务、谁都能用 —— 本文件**不许 import `modules/*`**。
// =============================================================================
import { AsyncLocalStorage } from 'node:async_hooks';

import { AppError, ErrorCode } from '../errors/app-error';

/** 数据范围档位（→ 架构 §7.2；码值与《数据架构文档》§十一口径一致） */
export type DataScopeType = 'self' | 'dept' | 'all';

/** 「我能看到谁」（→ §7.1） */
export interface DataScope {
  readonly type: DataScopeType;
  /** `type='dept'` 时＝我管辖的部门集合；`'self'` / `'all'` 时可为空数组 */
  readonly deptIds: readonly bigint[];
}

/** 一次请求的「我是谁」（→ §7.1） */
export interface RequestContext {
  /** 当前登录员工 id（`employee.id`，BigInt 主键） */
  readonly employeeId: bigint;
  /** 我所属 / 管辖的部门 id 集合 */
  readonly deptIds: readonly bigint[];
  /** 我持有的角色码（`role.code`，如 sales / dept_manager / gm） */
  readonly roleCodes: readonly string[];
  /** 我能看到谁（数据范围，§7.2） */
  readonly dataScope: DataScope;
}

/**
 * 进程内上下文存储（模块级单例：Web / Worker 各自一份）。
 * 用 `AsyncLocalStorage` 是因为**不能用请求作用域单例**：回调 / 定时器 / 并发请求会串味。
 */
const storage = new AsyncLocalStorage<RequestContext>();

/**
 * 在当前 async 链上**包裹**执行 —— 链内（含 await、微任务、定时器回调）都能读回同一个上下文。
 * 用途：单测、中间件、定时任务（Worker 里手工造一个「系统上下文」）。
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * 在当前 async 链上**填入**上下文（供鉴权守卫使用，→ M0-32「解 JWT → 填 context」）。
 * ⚠ 与 `runWithContext` 的区别：这是 `enterWith`，只影响**当前链之后的执行**、不负责恢复原值，
 *   故只应由「一次请求只跑一次」的守卫 / 中间件调用；业务代码一律走 `getRequestContext` 读。
 */
export function setRequestContext(context: RequestContext): void {
  storage.enterWith(context);
}

/** 只读当前上下文；**不在请求链上时返回 `undefined`**（如 Worker 定时任务、应用启动期） */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * 取当前上下文，取不到就抛 —— 给「一定要有人」的写操作 / 审计场景用。
 * 缺上下文 ＝ 守卫没跑 ＝ 编程错误（→ API §2.4：500 / 20099 服务异常），**不静默降级成匿名**。
 */
export function requireRequestContext(): RequestContext {
  const context = storage.getStore();
  if (context === undefined) {
    throw new AppError(ErrorCode.INTERNAL, 500, '缺少请求上下文（鉴权守卫未执行）');
  }
  return context;
}

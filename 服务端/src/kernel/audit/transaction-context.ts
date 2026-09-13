// =============================================================================
// 业务事务上下文（M0-30 的配套机制）—— 审计「只接受事务上下文」的判定依据
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.1 §7.4：敏感动作「在**业务事务内**写 `operation_log`，
//     **业务失败则一起回滚**」。
//   · 《过程产出/CONSTRAINTS.md》§二.4（不可协商硬约束）：审计必须在业务事务内写；
//     同 §二.5：跨域只走 service / 领域事件，**禁止跨域大事务**（故本机制只在**本域** `$transaction` 内用）。
//   · 《开发计划-V1》M0-30 判据：**无事务上下文时抛错**（防审计逃逸）。
//
// 为什么用 ALS，而不是「把 tx 当参数一路往下传」：
//   业务 service 写敏感动作就得记审计；靠参数传递意味着**每一层都得多带一个 tx**，
//   而漏传时编译器往往拦不住（可选参数 / 类型放宽）—— 那正是「审计逃逸」的温床。
//   ALS 把「当前有没有事务」变成**运行期可判定的事实**：没有就抛，绝不静默降级。
//
// ★ 本文件是 kernel 里**唯一的 Prisma 类型依赖点**（刻意集中）：
//   事务客户端形状直接取真实的 `Prisma.TransactionClient`，**不手抄字段** ——
//   避免「M0-46 接真库时才发现结构对不上」的返工。
//   `Prisma.TransactionClient = Omit<PrismaClient, ITXClientDenyList>`，即
//   `$transaction(async tx => …)` 回调里的那个 `tx`（见 `src/generated/prisma/internal/prismaNamespace.ts`）。
// =============================================================================
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Prisma } from '../../generated/prisma/client';
import { AppError, ErrorCode } from '../errors/app-error';

/** 业务事务客户端（＝ `$transaction(async tx => …)` 的 `tx`） */
export type TransactionClient = Prisma.TransactionClient;

const storage = new AsyncLocalStorage<TransactionClient>();

/**
 * 开一段「业务事务」并把 `tx` 挂到上下文（**每个 `$transaction` 只包一次**）：
 *
 * ```ts
 * await this.prisma.$transaction(async (tx) =>
 *   runInTransaction(tx, async () => {
 *     await this.repository.update(...);           // 业务写入
 *     await this.audit.record({ action: '...' });  // 审计写入：同一个 tx，一起成功 / 一起回滚
 *   }),
 * );
 * ```
 */
export function runInTransaction<T>(tx: TransactionClient, fn: () => T): T {
  return storage.run(tx, fn);
}

/** 只读当前事务客户端；不在事务里（如纯查询路径）＝ `undefined` */
export function getTransactionClient(): TransactionClient | undefined {
  return storage.getStore();
}

/**
 * 取当前事务客户端，取不到即抛 —— **审计专用**（→ M0-30 判据）。
 * 缺事务 ＝ 编程错误 → API §2.4 的 500 / 20099（与 M0-26「缺请求上下文」同一口径）。
 * **绝不自动 `$transaction` 兜底**：那会让审计逃出业务事务，业务回滚时留下脏审计记录。
 */
export function requireTransactionClient(): TransactionClient {
  const client = storage.getStore();
  if (client === undefined) {
    throw new AppError(ErrorCode.INTERNAL, 500, '审计必须在业务事务内写入（当前无事务上下文）');
  }
  return client;
}

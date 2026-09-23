// =============================================================================
// E 域（合同）纯业务规则（M9-E / B2）
//
// 分层约束（架构 §5.4）：本目录**零框架依赖**——不 import `@nestjs/*`、不 import Prisma、
// 不查库。假数据即可单测（→ CODEBUDDY.md §5）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》E1（`contract.status` 取值 `unpaid/partial/running/done/terminated`）
//   · 《销售CRM接口API文档》§5.9（出参 `pay_progress` / `expire_level`）
// =============================================================================

/** 合同状态（→ 数据架构 E1） */
export const CONTRACT_STATUSES = ['unpaid', 'partial', 'running', 'done', 'terminated'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** 状态白名单（→ DTO `@IsIn` 与 service 校验共用，避免两处各抄一份字面量） */
export function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === 'string' && (CONTRACT_STATUSES as readonly string[]).includes(value);
}

/**
 * 由「应收 / 已收」派生状态（→ 数据架构 E1）。
 * ⚠ `terminated` 是**人工终态**，**不靠金额算**——本函数只管 unpaid/partial/done 三档；
 *   `running` / `terminated` 由业务动作（开始服务 / 终止）显式置位，不在此推导。
 */
export function deriveContractStatus(amount: string | number, paidAmount: string | number): ContractStatus {
  const a = Number(amount);
  const p = Number(paidAmount);
  if (!Number.isFinite(a) || a <= 0) return 'unpaid';
  if (p <= 0) return 'unpaid';
  if (p >= a) return 'done';
  return 'partial';
}

/** 回款进度（0~100，向下取整；金额非法 / 未回款给 0） */
export function computePayProgress(amount: string | number, paidAmount: string | number): number {
  const a = Number(amount);
  const p = Number(paidAmount);
  if (!Number.isFinite(a) || a <= 0) return 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.min(100, Math.floor((p / a) * 100));
}

/**
 * 距服务到期天数 → 预警档（→ 接口 §5.9 `expire_level: 0|30|60|90`）。
 * ★ 语义：返回「落在哪个 30 天窗口」—— `30`＝30 天内、`60`＝60 天内、`90`＝90 天内、
 *   `0`＝已过到期日 / 无到期日 / 不预警（>90 天）。与 §5.9 的取值集合一致。
 */
export function expireLevelOf(serviceEnd: Date | null, now: Date = new Date()): 0 | 30 | 60 | 90 {
  if (serviceEnd === null) return 0;
  const days = Math.ceil((serviceEnd.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return 0;
  if (days <= 30) return 30;
  if (days <= 60) return 60;
  if (days <= 90) return 90;
  return 0;
}

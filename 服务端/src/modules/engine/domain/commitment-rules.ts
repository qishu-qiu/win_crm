// =============================================================================
// D 域纯规则（M4-09）—— 承诺三型 / 类型 / 状态流转
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》D1（`commitment`）：
//       `party` ∈ **me**（我答应客户）/ **them**（客户答应我）/ **verdict**（我定的判定点）；
//       `ctype` ∈ reply / quote / meet / deliver / decision / followup /
//                 social_meal / social_gift / social_greeting；
//       `status` ∈ open / done / expired / **waived（豁免，必填原因）** / cancelled。
//   · 《销售CRM业务需求文档》§10.1：me 催自己 / them 催客户 / verdict 给结论；
//     「到期 → 进今日动线；逾期 → 次日置顶标红；**豁免必须填原因**」。
//
// ★ 三条人工流转**全部开放**（2026-09-15）：`done` 兑现 / `cancelled` 取消 / `waived` 豁免。
//   `waived` 此前被卡住的理由：规格要求「豁免必填原因」，而 `commitment` 表**没有存原因的列**
//   （收下原因却无处可存＝**假契约**）。2026-09-15 七叔拍板分界 ＋ 补列
//   （`commitment.waive_reason`，migration `0005`）后**开放**：
//     · `cancelled` 取消 ＝ **录错了 / 这事不成立了**（**不需原因**，纠正误录）；
//     · `waived` 豁免 ＝ **确有其事但做不成**（客户变卦 / 特殊原因…）—— **必须填原因**。
//   （→ 需求 §10.1 / 数据架构 D1）
//
// ★ `expired` 不在这里判：它是**派生态**（`due_at` 过了还没 done），由「每日组装」或
//   查询时按时间算，**不靠写库流转** —— 此处只列允许**由人**触发的目标态。
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 —— 不 import `@nestjs/*` / Prisma。
// =============================================================================

/** 承诺三型（→ D1 `party`） */
export const COMMITMENT_PARTIES = ['me', 'them', 'verdict'] as const;
export type CommitmentParty = (typeof COMMITMENT_PARTIES)[number];

/** 承诺类型（→ D1 `ctype`，9 种；`social_*` 三种＝客情类） */
export const COMMITMENT_CTYPES = [
  'reply',
  'quote',
  'meet',
  'deliver',
  'decision',
  'followup',
  'social_meal',
  'social_gift',
  'social_greeting',
] as const;
export type CommitmentCtype = (typeof COMMITMENT_CTYPES)[number];

/** 承诺状态（→ D1 `status`；`expired` 由时间派生，同样入白名单） */
export const COMMITMENT_STATUSES = ['open', 'done', 'expired', 'waived', 'cancelled'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

/** 允许**人工流转**到的目标态（→ 需求 §10.1 收尾三态：兑现 / 取消 / 豁免） */
export const CLOSABLE_STATUSES = ['done', 'cancelled', 'waived'] as const;
export type ClosableStatus = (typeof CLOSABLE_STATUSES)[number];

/** 已结束的承诺（不再允许改期 / 再次关闭） */
const TERMINAL_STATUSES: readonly string[] = ['done', 'cancelled', 'waived'];

/**
 * 「**还没结束**」的那一档（→ D1 `status` 的 `open`）—— 领取公海 / 转交时「承诺跟随关系换人」
 * 改的就是这一档（→ 接口 §5.6 尾：「领取瞬间，该关系所有 **open 承诺 `owner_id` 转新 owner**」）。
 *
 * ★ `expired` **不在这一档里**：它是**派生态**（`due_at` 过了还没 done，按时间算，不靠写库流转
 *   —— 见文件头 ★），库里不会有这个值，故没有「漏掉 expired」这回事；
 *   `done` / `cancelled` / `waived` 已结束，改它的归属＝篡改历史（谁答应的事就是谁答应的）。
 */
export const OPEN_COMMITMENT_STATUS = 'open';

/** 一句话承诺内容的上限（→ D1：`content` `VarChar(255)`） */
export const COMMITMENT_CONTENT_MAX_LENGTH = 255;

/** 豁免原因的上限（→ D1：`waive_reason` `VarChar(255)`） */
export const COMMITMENT_WAIVE_REASON_MAX_LENGTH = 255;

/** 目标态是否**要求填原因**（→ 需求 §10.1：只有 `waived` 豁免要；`done` 兑现 / `cancelled` 取消都不要） */
export function requiresWaiveReason(status: string): boolean {
  return status === 'waived';
}

export function isKnownParty(value: string): value is CommitmentParty {
  return (COMMITMENT_PARTIES as readonly string[]).includes(value);
}

export function isKnownCtype(value: string): value is CommitmentCtype {
  return (COMMITMENT_CTYPES as readonly string[]).includes(value);
}

/** 是否已结束（`done` / `cancelled` / `waived`）—— 结束后一律不再改动 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 改承诺前的准入：**已结束的承诺不能再改**（避免「done 又被改回 open」把兑现记录抹掉）。
 *
 * @returns 不通过时给人话（service 直接拿去抛 422 / 20403）
 */
export function checkCommitmentMutable(status: string | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (isTerminalStatus(status)) {
    return { ok: false, reason: '该承诺已结束（已兑现 / 已取消 / 已豁免），不能再改' };
  }
  return { ok: true };
}

/**
 * 豁免原因校验（→ 需求 §10.1「**豁免必须填原因**」）。
 *
 * ★ 为什么必填：**豁免 ＝ 确有其事但做不成**（客户变卦 / 特殊原因…）——
 *   不写原因，经理事后就分不清"这条线到底还有没有戏"，逾期抽屉会变成藏事的地方
 *   （与 §10.4「动线条目 `ignored` 必填原因」是同一道闸）。
 *
 * @returns 不通过时给人话（service 直接拿去抛 422 / 20403 必填未填）
 */
export function checkWaiveReason(
  reason: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  const value = (reason ?? '').trim();
  if (value === '') {
    return { ok: false, reason: '豁免必须填原因（写清为什么做不成：客户变卦 / 特殊原因…）' };
  }
  if (value.length > COMMITMENT_WAIVE_REASON_MAX_LENGTH) {
    return { ok: false, reason: `豁免原因最多 ${COMMITMENT_WAIVE_REASON_MAX_LENGTH} 字` };
  }
  return { ok: true };
}

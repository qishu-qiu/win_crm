// =============================================================================
// D 域纯规则（M4-09）—— 承诺三型 / 类型 / 状态流转
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.31 D1（`commitment`）：
//       `party` ∈ **me**（我答应客户）/ **them**（客户答应我）/ **verdict**（我定的判定点）；
//       `ctype` ∈ reply / quote / meet / deliver / decision / followup /
//                 social_meal / social_gift / social_greeting；
//       `status` ∈ open / done / expired / **waived（豁免，必填原因）** / cancelled。
//   · 《销售CRM业务需求文档》§10.1：me 催自己 / them 催客户 / verdict 给结论；
//     「到期 → 进今日动线；逾期 → 次日置顶标红；**豁免必须填原因**」。
//
// ★ 本批**只开放两条流转**（`done` 兑现 / `cancelled` 取消）——**`waived` 豁免暂不做**：
//   规格要求豁免**必填原因**，但 `commitment` 表**没有存原因的列**（D1 全文无 `reason` /
//   `waive_reason`；`daily_agenda.action_reason` 是动线条目的，不是承诺的）。
//   不给落点就实现＝**假契约**（收下原因却没地方存），故本批**不做**、登记为待拍板项
//   （→ 交接说明 §二）。⚠ 这是「先查是否被封路」的结论（铁律坑 8 / 23），不是漏做。
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

/** 本批允许**人工流转**到的目标态（`waived` 待拍板，见文件头 ★） */
export const CLOSABLE_STATUSES = ['done', 'cancelled'] as const;
export type ClosableStatus = (typeof CLOSABLE_STATUSES)[number];

/** 已结束的承诺（不再允许改期 / 再次关闭） */
const TERMINAL_STATUSES: readonly string[] = ['done', 'cancelled', 'waived'];

/** 一句话承诺内容的上限（→ D1：`content` `VarChar(255)`） */
export const COMMITMENT_CONTENT_MAX_LENGTH = 255;

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
    return { ok: false, reason: '该承诺已结束（已兑现 / 已取消），不能再改' };
  }
  return { ok: true };
}

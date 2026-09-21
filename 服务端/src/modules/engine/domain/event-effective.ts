// =============================================================================
// D 域纯规则（M4-04）—— 「有效沟通」判定（**快速标记不算**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》D2（`action_event`）：
//       `action_type` ∈ phone / wechat / visit / onsite / email / meal / gift / greeting /
//                       ask_help / note / system；
//       `outcome` 可空：**有效沟通**＝ advanced / stalled / await_reply；
//                       **快速标记（无效沟通）**＝ not_contacted / no_answer / brief_hangup；
//                       空＝中性（非必填）。
//   · 同 D2「★ 快速标记口径」：**快速标记『不』更新 `business_relation.last_event_at`**
//     —— 只有有效沟通才更新；否则销售对 100 个客户点一下，掉海倒计时就被刷爆（→ 需求 §6.3）。
//   · 《销售CRM业务需求文档》§10.2：有效沟通**必须写跟单**（一句话结果）；
//     无效沟通**点一下即可，不强制写一个字** ⇒ `summary` 仅在**非**快速标记时必填。
//
// ★ 「空 `outcome` 算不算有效沟通」：**算**。判据＝ D2 原文「`last_event_at` 回写逻辑中
//   **排除** outcome ∈ 三型 quick_mark 的事件」—— 排除的是那三个值，**空值不在其中**。
//   （反过来理解会得出「没填结果＝不记得有没有聊过」这种对销售更苛刻的读法，规格没这么说。）
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 —— 不 import `@nestjs/*` / `@prisma/client`。
// =============================================================================

/** 动作类型（→ D2 `action_type`） */
export const ACTION_TYPES = [
  'phone',
  'wechat',
  'visit',
  'onsite',
  'email',
  'meal',
  'gift',
  'greeting',
  'ask_help',
  'note',
  'system',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * **系统事件**那一码（→ D2 `action_type` 值域里的最后一个）。
 *
 * ★ 为什么单列一个常量：这个码出现在**三处**（建档事件 / 领取事件 / 「跟单条数」把它排除掉），
 *   字面量散着写就是「同一事实三处落点」—— 改一处漏一处。
 * ★ 语义：**系统动作**（激活建档 / 领取公海），**不是销售写的跟单**（→ 本域 service 注释）。
 *   故「跟单条数」（→ 接口 §5.4 `event_count_30d`）**不计**它。
 */
export const SYSTEM_ACTION_TYPE = 'system';

/**
 * **系统自动生成**的事件来源（→ D2 `action_event.source` 值域 `manual / auto / import`）。
 *
 * ★ 建档 / 领取两条系统事件写这个码 —— 原来写的是 `'system'`，**那个值不在 D2 的值域里**
 *   （→《欠账登记表》D-65，2026-09-21 拍板改码）。
 * ★ 为什么不干脆把 `system` 补进 D2 值域：值域里 `auto` 与 `system` 在这里**同义**
 *   （都指"系统自动产生、不是人手写"）—— 让两个同义码并存，正是"同一事实两个落点"的病根。
 */
export const AUTO_EVENT_SOURCE = 'auto';

/** 有效沟通的三种结果（→ D2） */
export const EFFECTIVE_OUTCOMES = ['advanced', 'stalled', 'await_reply'] as const;

/** 快速标记三型（无效沟通，→ 需求 §10.2 / D2） */
export const QUICK_MARK_OUTCOMES = ['not_contacted', 'no_answer', 'brief_hangup'] as const;

/** `outcome` 全量白名单（空值不入列：**空是合法值**，只是没有码） */
export const OUTCOME_VALUES = [...EFFECTIVE_OUTCOMES, ...QUICK_MARK_OUTCOMES] as const;
export type Outcome = (typeof OUTCOME_VALUES)[number];

/** 一句话结果的长度上限（→ D2：`summary` ≤ 200 字） */
export const SUMMARY_MAX_LENGTH = 200;

export function isKnownActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

export function isKnownOutcome(value: string): value is Outcome {
  return (OUTCOME_VALUES as readonly string[]).includes(value);
}

/**
 * 是否**快速标记**（无效沟通）。
 * ★ 空值**不是**快速标记（见文件头 ★）——点选框没动过 ≠ 勾了「未联系」。
 */
export function isQuickMarkOutcome(outcome: string | null | undefined): boolean {
  if (outcome === null || outcome === undefined || outcome === '') return false;
  return (QUICK_MARK_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * 是否**有效沟通**（→ M4-04 判据本体）。
 * 只有它为真时，才回写 `business_relation.last_event_at`（→ `last-event.ts`）。
 */
export function isEffectiveCommunication(outcome: string | null | undefined): boolean {
  return !isQuickMarkOutcome(outcome);
}

/**
 * 一句话结果是否**必填**（→ 需求 §10.2「有效沟通写字，没接通点一下」）。
 * 快速标记（三型 `outcome`）时 `summary` 可空；其余一律必填。
 */
export function isSummaryRequired(outcome: string | null | undefined): boolean {
  return isEffectiveCommunication(outcome);
}

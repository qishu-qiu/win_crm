// =============================================================================
// C 域纯规则（M3-10 改属性的口径）—— 枚举 ＋ 「非灰度必标开发价值」校验
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.30 C1：
//       `urgency` ∈ `weekly / monthly / quarterly / long_term / gray(默认)`，**纯手动、无自动降级**，
//         `gray` **不豁免**掉海规则；
//       `value_tier` ∈ `high / medium / low / pending(默认空)`，**手动**；
//       `competition` ∈ `none / in_use / comparing`（**快照**，录入在事件侧 D2，M3 只读改）。
//   · 同 C1「★ 校验（2026-09-10 定）」：**`urgency != gray` 的关系必须已标 `value_tier`**
//     —— 紧迫档离开灰度时服务端 **422** 拦截（一个点选，系统给建议值，→ 需求 §9）。
//   · 废止口径 #25：「愿标才标」**只适用于灰度**；非灰度**必标**（服务端 422）
//     —— 旧表述的风险是「照表格写就不做服务端强制校验」。
//   · 《销售CRM接口API文档》V1.15 §2.4：422 用 `204xx` —— 本文件对应 **`20403` 必填未填**。
//
// ★ 「必标」如何判定（本项目技术口径，已在交接说明 §五 登记）：
//   `pending` 的语义是**尚未定档**（C1 原文标作「默认空」），故「必标」＝ `value_tier` 落在
//   **已定档三值** `high / medium / low` 之内。若只判「列非空」，销售点一下 `pending` 就能绕过
//   这条闸门 —— 那等于没有闸门。规格未逐字写清这一点，故在代码与报告双处标注待确认。
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 —— 不 import `@nestjs/*` / `@prisma/client`。
// =============================================================================

/** 紧迫档（→ C1；顺序＝从紧到松，展示层也按它排） */
export const URGENCY_VALUES = ['weekly', 'monthly', 'quarterly', 'long_term', 'gray'] as const;
export type Urgency = (typeof URGENCY_VALUES)[number];

/** 开发价值档（→ C1） */
export const VALUE_TIER_VALUES = ['high', 'medium', 'low', 'pending'] as const;
export type ValueTier = (typeof VALUE_TIER_VALUES)[number];

/** 竞品态势快照（→ C1；`null`＝未知） */
export const COMPETITION_VALUES = ['none', 'in_use', 'comparing'] as const;
export type Competition = (typeof COMPETITION_VALUES)[number];

/** 灰度档：唯一允许「不标开发价值」的紧迫档（→ 废止口径 #25） */
export const GRAY_URGENCY = 'gray';

/** 已定档的三值（「必标」的实际判据，见文件头 ★） */
const DECIDED_VALUE_TIERS: readonly string[] = ['high', 'medium', 'low'];

export function isKnownUrgency(value: string): value is Urgency {
  return (URGENCY_VALUES as readonly string[]).includes(value);
}

export function isKnownValueTier(value: string): value is ValueTier {
  return (VALUE_TIER_VALUES as readonly string[]).includes(value);
}

export function isKnownCompetition(value: string): value is Competition {
  return (COMPETITION_VALUES as readonly string[]).includes(value);
}

/** 「非灰度必标开发价值」的判定结果 */
export type ValueTierVerdict = { ok: true } | { ok: false; kind: 'value_tier_required' };

/**
 * 非灰度关系是否已标开发价值（→ C1 校验；**这是 M3-10 的判据本体**）。
 *
 * ★ 只看**合并后**的最终态（`urgency` 与 `value_tier` 都取「改完之后的样子」）：
 *   规格拦的是「离开灰度」这个**结果**，不是「本次请求里有没有带 value_tier」——
 *   之前已标过的关系，这次只改 urgency 也应当放行（否则销售得每次把两个字段一起提交）。
 */
export function checkValueTierForUrgency(
  urgency: string,
  valueTier: string | null,
): ValueTierVerdict {
  if (urgency === GRAY_URGENCY) return { ok: true };
  if (valueTier !== null && DECIDED_VALUE_TIERS.includes(valueTier)) return { ok: true };
  return { ok: false, kind: 'value_tier_required' };
}

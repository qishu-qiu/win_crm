/**
 * 业务关系的**展示口径**（角色 → 中文名一类的小映射，→ 与 `home.ts` 同一性质）。
 *
 * ★ 全部**逐字取自规格**，不自造：
 *   · 阶段 7 档 →《销售CRM业务需求文档》§8.1 表格（1 初步建联 / 2 需求确认 / 3 面访产品讲解 /
 *     4 异议与卡点 / 5 逼单 / 6 已合作 / 7 已流失）。
 *   · 紧迫 5 档与颜色 → 同文档 §8.2 表格（周重点红 / 月重点橙 / 季度跟蓝 / 长期跟绿 / 灰度灰）；
 *     颜色取**设计 token**（`styles/tokens.css` 的 `--crm-color-urgency-*`），不写死色值
 *     —— 写死就绕过了设计规范这条单一事实源。
 *   · 开发价值 4 档 → 同文档 §5 术语表「**高/中/低/待定**，手动」。
 *   · `sea_status` 语义 →《数据架构文档》C1：`private`＝有主人（私海）/ `company_sea`＝无主人（公海）。
 *
 * ⚠ 未知取值**原样回显码值**（不猜中文）：库里的枚举若先于规格扩了值，页面要看得出来、
 *   而不是显示成空白 —— 空白会让人以为「没填」。
 */

/** 阶段（→ 需求 §8.1；7 ＝ 流失终态） */
const STAGE_NAMES: Record<number, string> = {
  1: '初步建联',
  2: '需求确认',
  3: '面访产品讲解',
  4: '异议与卡点',
  5: '逼单',
  6: '已合作',
  7: '已流失',
}

export function stageNameOf(stage: number): string {
  return STAGE_NAMES[stage] ?? `阶段 ${stage}`
}

/** 紧迫档中文名（→ 需求 §8.2） */
const URGENCY_NAMES: Record<string, string> = {
  weekly: '周重点',
  monthly: '月重点',
  quarterly: '季度跟',
  long_term: '长期跟',
  gray: '灰度',
}

export function urgencyNameOf(urgency: string): string {
  return URGENCY_NAMES[urgency] ?? urgency
}

/**
 * 紧迫档颜色（→ 需求 §8.2 颜色列；取值是**设计 token 变量名**）。
 * `gray` ＝ 默认档「暂未下结论」，用中性灰 —— 别拿它当「无数据」隐藏掉。
 */
const URGENCY_TOKENS: Record<string, string> = {
  weekly: 'var(--crm-color-urgency-week)',
  monthly: 'var(--crm-color-urgency-month)',
  quarterly: 'var(--crm-color-urgency-quarter)',
  long_term: 'var(--crm-color-urgency-long)',
  gray: 'var(--crm-color-urgency-gray)',
}

export function urgencyColorOf(urgency: string): string {
  return URGENCY_TOKENS[urgency] ?? 'var(--crm-color-urgency-gray)'
}

/**
 * 紧迫档**筛选选项**（→ 需求 §8.2，**顺序照规格表**：周 / 月 / 季度 / 长期 / 灰度）。
 * ★ 为什么另列一份而不是拿 `URGENCY_NAMES` 的键：对象键序在语义上不可依赖，
 *   而筛选 chip 的**排列顺序是规格要求的**（周重点必须在最前）。
 */
export const URGENCY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'weekly', label: '周重点' },
  { value: 'monthly', label: '月重点' },
  { value: 'quarterly', label: '季度跟' },
  { value: 'long_term', label: '长期跟' },
  { value: 'gray', label: '灰度' },
]

/**
 * 视图筛选选项（→ 接口 §5.6；**各档判定在服务端** `domain/relation-list-filter.ts`）。
 * ⚠ **只有 4 档**：前端文档 §5 的第五档「逾期未跟进」**服务端暂不提供**
 *   （它要判"逾期"，而逾期来自承诺 / 预约，字段尚未落地，→《欠账登记表》D-09 / D-10）——
 *   **页面上不摆一个点了没用的按钮**（那等于骗用户"这功能有"）。
 */
export const RELATION_VIEW_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'all', label: '我的全部' },
  { value: 'following', label: '跟进中' },
  { value: 'cooperated', label: '已合作' },
  { value: 'churned', label: '已流失' },
]

/** 开发价值档中文名（→ 需求 §5 术语表：高 / 中 / 低 / 待定） */
const VALUE_TIER_NAMES: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  pending: '待定',
}

/** `null` ＝ 未标（灰度客户允许留空）→ 给占位符，**别显示成「待定」**（那是另一件事） */
export function valueTierNameOf(valueTier: string | null): string {
  if (valueTier === null || valueTier === '') return '—'
  return VALUE_TIER_NAMES[valueTier] ?? valueTier
}

/**
 * 开发价值档**选项**（→ 需求 §5 术语表；值与《数据架构文档》C1 的 `VALUE_TIER_VALUES` 逐字一致）。
 * ★ `pending`（待定）**是合法档位**，不是"没填" —— 需求 §8.3：非灰度**必标**，而「已标」＝
 *   有值且合法即可、**`pending` 也算标过**（2026-09-15 拍板）。故它必须在选项里。
 * ★ **公海唯一可改的属性**就是它（开发价值＝部门共同维护，销售也能标，→ 前端文档 §5 第 9/10 条）。
 * ★ `as const`：让下面的 `ValueTierValue` **从这个表推出**，而不是再手抄一份字面量
 *   （手抄的那份迟早与这张表分叉，→ 本项目点名的双真相源）。
 */
export const VALUE_TIER_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
  { value: 'pending', label: '待定' },
] as const

/** 开发价值档**值域**（唯一落点＝上面的选项表） */
export type ValueTierValue = (typeof VALUE_TIER_OPTIONS)[number]['value']

/**
 * 任意来源的值 → 合法的开发价值档；**不认识就给 `null`（＝未标）**。
 * ★ 用在「接口出参 → 表单草稿」这一步：出参的 `value_tier` 是**宽 `string`**
 *   （OpenAPI 里是 `string | null`），而提交时要的是**收窄后的值域**。
 *   `some(...)` 逐个比对＝**真校验**（不是 `as` 硬转），库里若先于规格冒出新码，
 *   这里会**当未标处理**（而不是把非法值原样回传，被服务端 400/422 打回来）。
 */
export function toValueTier(value: string | null | undefined): ValueTierValue | null {
  if (value === null || value === undefined || value === '') return null
  return VALUE_TIER_OPTIONS.some((item) => item.value === value)
    ? (value as ValueTierValue)
    : null
}

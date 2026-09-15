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

/** ISO 时间 → `YYYY-MM-DD HH:mm`（本地时区）；`null` → `—`（**不显示 `null` 字面量**） */
export function formatDateTime(value: string | null): string {
  if (value === null || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

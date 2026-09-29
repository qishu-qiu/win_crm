import type { components } from './types'
import request from './request'

/**
 * 数据看板接口封装（→《销售CRM接口API文档》§5.13 `GET /reports/dashboard`）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）。
 *
 * ⚠ **类型债（运行时）**：当前**部署中的后端二进制**早于本轮 DTO 定稿，其暴露的 OpenAPI
 *   （`/docs-json`）把 `DashboardResultDto` 的 5 个列表分区标成 `Record<string, never>[]`（占位）。
 *   5 区的**权威形状**以 `服务端/src/modules/report/dto/report-response.dto.ts` 为唯一真相源，
 *   下方 `PendingTodoItem` / `WarningItem` / `DeptCompareItem` / `TopSalesItem` / `ZombieWeeklyItem`
 *   是从该 DTO**逐字段转录**的。后端重新部署后，重跑 `gen:types` 即可把这些内联 item 类型
 *   全部替换为 `components['schemas']['XxxItemDto']` 并删掉本段注释（→ 欠账登记表）。
 *
 * 出参不脱敏（§2.4），真实金额直出。
 */

export type DashboardKpi = components['schemas']['DashboardKpiDto']
export type SeaManagerTodoResult = components['schemas']['SeaManagerTodoResultDto']
export type SeaManagerTodoItem = components['schemas']['SeaManagerTodoItemDto']

// —— 以下 5 个 item 类型转录自 `report-response.dto.ts`（运行时后端已落真实数据）——
/** 今日/逾期待跟进明细（承诺 `status=open` 且 `due_at`≤今日结束） */
export interface PendingTodoItem {
  relation_id: string
  relation_name: string | null
  contact_id: string | null
  contact_name: string | null
  due_at: string
  overdue: boolean
  content: string | null
}

/** 活跃预警项：`contract_expire` 签约到期 / `new_biz` 新商机 / `sea_drop` 掉公海 */
export type WarningType = 'contract_expire' | 'new_biz' | 'sea_drop'

export interface WarningItem {
  type: WarningType
  relation_id: string
  relation_name: string | null
  owner_id: string | null
  owner_name: string | null
  service_end: string | null
  days_left: number | null
  created_at: string | null
  dropped_days: number | null
}

/** 部门对比：各管辖部门当月签约额 ＋ 当前私海关系数（按签约额降序） */
export interface DeptCompareItem {
  dept_id: string
  dept_name: string
  signed_amount: number
  relation_count: number
}

/** 销冠榜：按签单人（业绩归属）聚当月签约额，Top 10 */
export interface TopSalesItem {
  owner_id: string
  owner_name: string
  signed_amount: number
  contract_count: number
}

/** 周重点僵尸榜：`urgency=weekly` 且 ≥14 天无有效跟进 */
export interface ZombieWeeklyItem {
  relation_id: string
  relation_name: string | null
  owner_id: string | null
  owner_name: string | null
  last_event_at: string | null
  no_progress_days: number
}

/** 看板结果（5 区为转录类型；kpi / sea_todo 取自生成物） */
export interface DashboardResult {
  kpi: DashboardKpi
  pending_todo: PendingTodoItem[]
  warnings: WarningItem[]
  dept_compare: DeptCompareItem[]
  top_sales: TopSalesItem[]
  zombie_weekly: ZombieWeeklyItem[]
  sea_todo: SeaManagerTodoResult
}

/**
 * 拉取数据看板（老板 / 经理 / 管理员可见，销售·客服 403；不脱敏）。
 * 失败由请求层统一弹错；本封装只负责把 data 落为 `DashboardResult`。
 */
export async function fetchDashboard(): Promise<DashboardResult> {
  const { data } = await request.get<DashboardResult>('/reports/dashboard')
  return data
}

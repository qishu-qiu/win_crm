import type { components } from './types'
import request from './request'

/**
 * 行动引擎接口封装（→《销售CRM接口API文档》§5.7）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，`npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（禁止手写对接，→ M0-57）。
 *
 * ⚠ **只封装页面真用到的那几个**：
 *   时间线 / 写跟单（关系页的时间线抽屉）、承诺列表与建/改（同一抽屉）、今日动线（工作台）、
 *   **批量快速标记（M6-09 片 3）**；
 *   动线条目的处理动作（`/today-agenda/:id/action`）属后续里程碑 ——
 *   先写没人调的封装，等于把「契约」和「调用方」拆开维护。
 */
export type ActionEvent = components['schemas']['ActionEventVoDto']
export type Commitment = components['schemas']['CommitmentVoDto']
export type AgendaItem = components['schemas']['AgendaItemVoDto']
export type QuickMarkInput = components['schemas']['QuickMarkDto']
export type QuickMarkResult = components['schemas']['QuickMarkResultDto']

/** 时间窗（→ §5.7：默认 `1m` ＝近 1 个月） */
export type EventRange = '1m' | 'all'

/** 写跟单入参（→ §5.7 `POST /relations/:id/events`；本页用到的子集） */
export interface RecordEventInput {
  action_type: string
  summary?: string
  outcome?: string
  contact_id?: string
  duration_min?: number
}

/** 建承诺入参（→ §5.7 `POST /relations/:id/commitments`） */
export interface CreateCommitmentInput {
  party: string
  ctype: string
  content: string
  due_at?: string
}

/** 改承诺入参（→ §5.7 `PUT /relations/:id/commitments`） */
export interface UpdateCommitmentInput {
  id: string
  /** `done` 兑现 / `cancelled` 取消（**录错了 / 不成立**，不填原因）/ `waived` 豁免（**必填 `waive_reason`**） */
  status?: string
  /** 豁免原因（**仅 `status=waived` 时传且必填**；取消 / 兑现 / 改期都不传，→ 需求 §10.1） */
  waive_reason?: string
  due_at?: string
}

/** 关系时间线（**按事件时间倒序**；可见性由服务端按业务关系权限收敛） */
export async function listEvents(
  relationId: string,
  range: EventRange = '1m',
): Promise<ActionEvent[]> {
  const { data } = await request.get<ActionEvent[]>(`/relations/${relationId}/events`, {
    params: { range },
  })
  return data
}

/** 记一条跟单（**有效沟通必写一句话结果**，快速标记点一下即可 → 需求 §10.2） */
export async function recordEvent(
  relationId: string,
  input: RecordEventInput,
): Promise<ActionEvent> {
  const { data } = await request.post<ActionEvent>(`/relations/${relationId}/events`, input)
  return data
}

/**
 * 「待关联」阶段记一条跟单（`POST /contacts/:id/events`，→ 接口 §5.7 第 4 行 / 需求 §6.1 模型 B）
 * —— 联系人详情页（页 15）用（D-45 的前端接线）。
 *
 * ★ **只在没挂公司时能记**（服务端判「该联系人的**当前归属人**」，→ 接口 §5.7）：
 *   别人 → 403 `contact_event.not_mine`；**已挂公司**（`owner_id` 为 `null`）**同为 403**，
 *   人话一并指引「到业务关系里记」⇒ **页面只在"尚未关联公司"处摆本入口**，
 *   摆在别处＝点了必报错的**假入口**（设计规范 §3.2 第 11 条，本项目已犯过）。
 * ★ 语义：这条跟单**只挂在联系人身上**（服务端落库 `relation_id` 与 `owner_snapshot` 均 `null`）、
 *   **不回写 `last_event_at`**（那列在 C 域，本条根本没有关系）；**关联公司后服务端批量挂到新关系**。
 * ★ 校验（同关系侧）：**有效沟通必写一句话结果**（缺 → 422）；同内容重复 → 409（幂等键 `relationId=null`）。
 */
export async function recordContactEvent(
  contactId: string,
  input: RecordEventInput,
): Promise<ActionEvent> {
  const { data } = await request.post<ActionEvent>(`/contacts/${contactId}/events`, input)
  return data
}

/** 某关系的承诺列表 */
export async function listCommitments(relationId: string): Promise<Commitment[]> {
  const { data } = await request.get<Commitment[]>(`/relations/${relationId}/commitments`)
  return data
}

/** 建一条承诺（`party`：me 催自己 / them 催客户 / verdict 给结论 → 需求 §10.1） */
export async function createCommitment(
  relationId: string,
  input: CreateCommitmentInput,
): Promise<Commitment> {
  const { data } = await request.post<Commitment>(
    `/relations/${relationId}/commitments`,
    input,
  )
  return data
}

/** 改承诺（收尾三态：`done` 兑现 / `cancelled` 取消 / `waived` 豁免；→ 需求 §10.1） */
export async function updateCommitment(
  relationId: string,
  input: UpdateCommitmentInput,
): Promise<Commitment> {
  const { data } = await request.put<Commitment>(`/relations/${relationId}/commitments`, input)
  return data
}

/** 今日该找谁（工作台；**只返回登录人自己的**条目） */
export async function fetchTodayAgenda(): Promise<AgendaItem[]> {
  const { data } = await request.get<AgendaItem[]>('/today-agenda')
  return data
}

/**
 * 批量快速标记（`POST /events/quick-mark`，→ 接口 §5.7）—— 业务关系列表页（M6-09 片 3）用。
 *
 * ★ `outcome` 三型：`not_contacted` 未联系 / `no_answer` 未接电话 / `brief_hangup` 说两句挂了
 *   （三型常量在前端 `src/engine.ts` 的 `QUICK_MARK_OUTCOME_OPTIONS`，**不在这里再抄一份**）。
 * ★ `relation_ids` 与 `contact_ids` **至少一组非空**（服务端校验）。
 * ★ 语义（→ 需求 §6.3 / §10.2）：**落库、可批量，但不算有效跟进、不重置掉海倒计时**，
 *   也**不回写 `last_event_at`** —— 页面**不许**在界面上写「已刷新跟进时间」这类话
 *   （写了就是在替服务端编业务结论）。重复点同一条**会落多条**（「打过 N 次」正是这么统计的）。
 * ★ 判定分两组且**都在服务端**：关系侧判**可写**（越权 / 只读 → 403）；
 *   「待关联」联系人侧判**归属人**（只有当前归属人能标，别人 → 403）。
 * ★ 出参 `{marked}` ＝ 实际落库条数（**只信服务端**）；页面按它报「已标记 N 条」。
 */
export async function quickMark(input: QuickMarkInput): Promise<QuickMarkResult> {
  const { data } = await request.post<QuickMarkResult>('/events/quick-mark', input)
  return data
}

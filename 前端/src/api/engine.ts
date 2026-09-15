import type { components } from './types'
import request from './request'

/**
 * 行动引擎接口封装（→《销售CRM接口API文档》V1.17 §5.7）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，`npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（禁止手写对接，→ M0-57）。
 *
 * ⚠ 本批（M4-17）**只封装页面真用到的那几个**：
 *   时间线 / 写跟单（关系页的时间线抽屉）、承诺列表与建/改（同一抽屉）、今日动线（工作台）。
 *   快速标记（`/events/quick-mark`）、动线条目的处理动作（`/today-agenda/:id/action`）
 *   属后续里程碑 —— 先写没人调的封装，等于把「契约」和「调用方」拆开维护。
 */
export type ActionEvent = components['schemas']['ActionEventVoDto']
export type Commitment = components['schemas']['CommitmentVoDto']
export type AgendaItem = components['schemas']['AgendaItemVoDto']

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
  status?: string
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

/** 改承诺（本批只开放 `done` 兑现 / `cancelled` 取消；`waived` 豁免待拍板） */
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

import type { components } from './types'
import request from './request'

/**
 * 预约接口封装（→《销售CRM接口API文档》§4.7 / §5.8）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（M0-57 判据：禁止手写）。
 *
 * ⚠ **只封装页面真用到的那几个**：列表（四 Tab）/ 新建 / 改期 / 完成。
 *   后端落点在 D 域（完成预约强制生成 `action_event`，→ 架构 §3 不另立 appointment 模块），
 *   路径直接 `/appointments`（无前缀）。
 */
export type AppointmentItem = components['schemas']['AppointmentItemVoDto']
export type CreateAppointmentInput = components['schemas']['CreateAppointmentDto']
export type RescheduleAppointmentInput = components['schemas']['RescheduleAppointmentDto']

/** 四 Tab（→ §5.8 / 前端 §五 页 4） */
export type AppointmentTab = 'today' | 'future' | 'expired' | 'missing'

/** 预约管理列表（→ §5.8 `GET /appointments?tab=`；范围＝我可见的私海关系） */
export async function listAppointments(tab: AppointmentTab): Promise<AppointmentItem[]> {
  const { data } = await request.get<AppointmentItem[]>('/appointments', { params: { tab } })
  return data
}

/** 新建预约（`POST /appointments`，→ §5.8） */
export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentItem> {
  const { data } = await request.post<AppointmentItem>('/appointments', input)
  return data
}

/** 改期（`PUT /appointments/:id`，→ §5.8） */
export async function rescheduleAppointment(
  id: string,
  input: RescheduleAppointmentInput,
): Promise<AppointmentItem> {
  const { data } = await request.put<AppointmentItem>(`/appointments/${id}`, input)
  return data
}

/**
 * 完成预约（`POST /appointments/:id/complete`，→ §5.8）：
 * ★ 服务端**强制生成一条跟单事件**，并回写关系 `last_event_at`；已完成再点 → 422。
 */
export async function completeAppointment(id: string): Promise<{ event_id: string }> {
  const { data } = await request.post<{ event_id: string }>(`/appointments/${id}/complete`)
  return data
}

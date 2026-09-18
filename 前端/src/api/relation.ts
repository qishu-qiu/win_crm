import type { components } from './types'
import request from './request'

/**
 * 业务关系接口封装（→《销售CRM接口API文档》§5.6）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（M0-57 判据：禁止手写）。
 *
 * ⚠ **只封装页面真正用到的那几个**：
 *   列表（M3-14）／详情（M6-08）／激活（M6-09 片 1）／**改属性（D-32：公海标开发价值）**；
 *   加成员 / 换阶段（后端已可用）随对应页面（后续里程碑）接入 ——
 *   先写一堆没人调的封装，等于把「契约」和「调用方」拆开维护，改一处漏一处。
 */
export type RelationVo = components['schemas']['RelationVoDto']
export type RelationDetail = components['schemas']['RelationDetailVoDto']
export type RelationMember = components['schemas']['RelationMemberVoDto']
export type RelationPage = components['schemas']['RelationPageVoDto']
export type CreateRelationInput = components['schemas']['CreateRelationDto']
export type UpdateRelationInput = components['schemas']['UpdateRelationDto']

/** 列表页签（→ 接口 §4.4：私海 / 公海） */
export type RelationTab = 'private' | 'sea'

/** 每页条数默认值（→ 接口 §2.7：默认 20、最大 100） */
export const RELATION_PAGE_SIZE_DEFAULT = 20

/**
 * 关系列表（`GET /relations`）—— **M6-07 起分页**（→ 接口 §2.3 分页形态 / §2.7）。
 *
 * ★ 服务端按数据范围收敛（→ §2.2）：销售＝我参与的关系 ＋ **我所属部门**的公海；
 *   经理＝管辖部门；总经理 / 管理员＝全部；**交付 / 客服看公海 → 403**
 *   —— 页面要**把 403 当正常分支**展示（「该角色不进公海」），不是崩掉。
 * ★ `total` **只信服务端**（同一个 where 的全量计数）：拿 `list.length` 当总数，
 *   一到第二页就会显示成「共 20 条」——「共 N 条」数的是**结果集**，不是本页。
 * ★ 页码 / 每页条数的归一（默认 1 / 20、上限 100）**由后端做**（→ §2.7）：
 *   前端再夹一遍＝第二套夹紧规则，改了后端忘了前端就分叉。
 */
export interface ListRelationsQuery {
  tab: RelationTab
  /** 页码（从 1 起；默认 1 —— **归一只在后端**，→ 接口 §2.7） */
  page?: number
  /** 每页条数（默认 20、最大 100 —— 归一只在后端） */
  pageSize?: number
  /** 视图（→ 接口 §5.6：`all` / `following` / `cooperated` / `churned`） */
  view?: string
  /** 紧迫档**多选**（→ 需求 §8.2 五档）；空数组＝不筛 */
  urgencies?: readonly string[]
}

export async function listRelations(query: ListRelationsQuery): Promise<RelationPage> {
  const { tab, page = 1, pageSize = RELATION_PAGE_SIZE_DEFAULT, view, urgencies = [] } = query
  const { data } = await request.get<RelationPage>('/relations', {
    params: {
      tab,
      page,
      page_size: pageSize,
      // ⚠ 没筛就**整个不带这个参数**（而不是带空串）：少一个参数更干净，
      //   后端两种都当"没筛"，但前端不该把"空值语义"当协议传出去
      ...(view === undefined ? {} : { view }),
      ...(urgencies.length === 0 ? {} : { urgency: urgencies.join(',') }),
    },
  })
  return data
}

/**
 * 关系详情（`GET /relations/:id`，→ 接口 §5.6）。
 * ★ 本片（M6-08）只消费「详情 ＋ `members`」—— 详情里其余分组（`stage_logs` / `labels` /
 *   `competitors` / `rounds`）属后续里程碑，**服务端尚未返回**（→《欠账登记表》D-11），
 *   故页面也**不摆点了没用的入口**。
 */
export async function getRelation(id: string): Promise<RelationDetail> {
  const { data } = await request.get<RelationDetail>(`/relations/${id}`)
  return data
}

/**
 * 激活业务关系（`POST /relations`，→ 接口 §5.6）—— 录入页第 3 步「确认」用。
 *
 * ★ **归属＝发起人自己**（服务端定；换人走 `transfer` 审批）—— 前端**不传归属人**。
 * ★ 三元组（公司 × 部门 × 产品线）已有活跃关系 → **409 / 20401**，服务端给的是**人话**
 *   （「该公司在该部门·产品线下已有归属，请走转交或协同」）—— 页面**把那句直接显示**，
 *   不翻译、不自己判「是不是重复」（前端再判一遍＝第二套规则，迟早与后端分叉）。
 * ★ `dept_id` **必须落在我可建范围内**（销售＝我所属部门含兼职、经理＝管辖部门…），
 *   否则服务端 **403**；这个判定**只在服务端**，前端不自己筛部门列表。
 */
export async function createRelation(input: CreateRelationInput): Promise<RelationVo> {
  const { data } = await request.post<RelationVo>('/relations', input)
  return data
}

/**
 * 改关系属性（`PUT /relations/:id`，→ 接口 §5.6）。
 *
 * ★★ **本端点是公海（无主）关系唯一的写口**（2026-09-18 拍板，→ D-32）：
 *   **只传 `value_tier`** 时放行（开发价值＝**部门共同维护**，**销售也能标**）；
 *   **再带任何一个别的字段** → 服务端 **422 / `20408`**（「该公司还在公海（未领取）…」）。
 *   ⇒ 公海那边**只准**用 `{ value_tier }` 调它 —— 这条不靠页面自觉，是**服务端的硬口径**，
 *     页面只要不加别的字段就不会踩（→ 前端文档 §5 第 9/10 条「其余动作不出现」）。
 * ★ 私海侧照旧：判定（能不能改这条）**全在服务端**，`403 / 409 / 422` 的人话直接显示。
 */
export async function updateRelation(
  id: string,
  input: UpdateRelationInput,
): Promise<RelationVo> {
  const { data } = await request.put<RelationVo>(`/relations/${id}`, input)
  return data
}

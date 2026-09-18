import type { components } from './types'
import request from './request'

/**
 * 公司 / 联系人接口封装（→《销售CRM接口API文档》§5.4 / §5.5）—— M2-17 建档页用。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（M0-57 判据：禁止手写）。
 */
export type CreateCompanyInput = components['schemas']['CreateCompanyDto']
export type CompanyVo = components['schemas']['CompanyVoDto']
export type SearchDupInput = components['schemas']['SearchDupDto']
export type DupCandidate = components['schemas']['DupCandidateVoDto']
export type SearchDupResult = components['schemas']['SearchDupResultVoDto']
export type CreateContactInput = components['schemas']['CreateContactDto']
export type ContactBrief = components['schemas']['ContactBriefVoDto']
export type CreatedContact = components['schemas']['ContactCreatedVoDto']

/**
 * 撞库查重（→ §5.4 `POST /companies/search-dup`）。
 *
 * ★ 建档**前**必须走一次：命中候选时由**人**决定「挂现有公司」还是「确认新建」
 *   （需求 §12.1 分支 4：系统只提示、**不自动合并、不拦截**）；
 *   后端 `suggest` 也只在「一条候选都没有」时才给 `create_new`。
 */
export async function searchDupCompanies(input: SearchDupInput): Promise<SearchDupResult> {
  const { data } = await request.post<SearchDupResult>('/companies/search-dup', input)
  return data
}

/** 建档公司（→ §5.4）：`name_core` 由**服务端**生成；`credit_code` 撞码 → 409「请使用已有档案」 */
export async function createCompany(input: CreateCompanyInput): Promise<CompanyVo> {
  const { data } = await request.post<CompanyVo>('/companies', input)
  return data
}

/**
 * 建档联系人（→ §5.5）：服务端会先做号码归一；重复手机号 → **409 人话**（不是 DB 原话）；
 * 给了 `company_id` 时同时写一条就职关系（`company_contact`）。
 */
export async function createContact(input: CreateContactInput): Promise<CreatedContact> {
  const { data } = await request.post<CreatedContact>('/contacts', input)
  return data
}

/**
 * 该公司下的联系人（→ §5.4 `GET /companies/:id/contacts`）。
 * ⚠ 出参是 `ContactBrief`：**列表 / 卡片一律 `phone_masked`**（§2.8 明文：这是**出参形态**、不是权限）。
 */
export async function listCompanyContacts(companyId: string): Promise<ContactBrief[]> {
  const { data } = await request.get<ContactBrief[]>(`/companies/${companyId}/contacts`)
  return data
}

/**
 * 联系人列表（→ §5.5 `GET /contacts`）—— 联系人档案页（M6-09 片 2）用。
 *
 * ★ `onlyUnlinked: true` ＝ 只看「**未关联公司**」的待跟进（＝「待关联」视图，→ 需求 §6.1 ③）：
 *   判定在**服务端**（该联系人**无任何 `company_contact` 记录**，派生、不加字段）。
 * ★ 可见范围**由服务端收敛**（服务端 §5.5：未挂公司的「待关联」**只给归属人自己**；
 *   已挂公司者暂按现状 —— 公司维度收敛待补，→《欠账登记表》D-28）：
 *   页面**不为了"看到更多"自己拼参数**（前端再筛一遍＝第二套范围口径）。
 * ★ 出参一律 `phone_masked`（**出参形态、不是权限**）—— 页面**不要再打一次码**。
 */
export async function listContacts(options: { onlyUnlinked?: boolean } = {}): Promise<ContactBrief[]> {
  const { data } = await request.get<ContactBrief[]>('/contacts', {
    // ⚠ 不筛就**整个不带这个参数**（而不是带 `false`）：别把"空值语义"当协议传出去
    params: options.onlyUnlinked === true ? { only_unlinked: 'true' } : {},
  })
  return data
}

/** 「关联公司并激活业务关系」的入参 / 出参（→ §5.6，欠账 D-29） */
export type ActivateRelationInput = components['schemas']['ActivateRelationDto']
export type ActivateRelationResult = components['schemas']['ActivateRelationResultDto']

/**
 * 关联公司并激活业务关系（→ §5.6 `POST /contacts/:id/activate-relation`）：
 * 把一条「**待关联**」联系人（还没挂公司）关联到公司 ＋ 激活一条业务关系。
 *
 * ★ **一个动作含三件事，全在服务端**（前端不做任何编排）：① 写就职关系 ② 建业务关系
 *   ③ 把该联系人名下**孤儿跟单**批量挂到新关系 —— 历史不断（→ 需求 §6.1 ④）。
 * ★ 出参 ＝ **新关系的列表项**（字段与 `api/relation.ts` 的列表项同形，可直接跳详情）
 *   ＋ `linked_events`（本次搬运了几条跟单）。⚠ 服务端**可重入**：重复调用不会二次搬运。
 * ★ 错误人话由服务端给、页面**照显示**：三元组已有活跃关系 → **409 / 20401**（与
 *   `createRelation` 同一句）；该联系人已挂过公司 → **409**；部门越权 / 只读角色 → **403**；
 *   各类 id 不存在 → **400**。
 * ⚠ 失败后**不要自作主张"补一次"另两件事**（比如失败了自己再去调 `createRelation`）：
 *   本动线跨 B / C / D 三域且**不共享事务**（架构 §5.2 禁跨域大事务），前端补一套补偿逻辑
 *   就是第二套口径 —— 该由服务端决定重试语义。
 */
export async function activateContactRelation(
  contactId: string,
  input: ActivateRelationInput,
): Promise<ActivateRelationResult> {
  const { data } = await request.post<ActivateRelationResult>(
    `/contacts/${contactId}/activate-relation`,
    input,
  )
  return data
}

import type { components } from './types'
import request from './request'

/**
 * 公司 / 联系人接口封装（→《销售CRM接口API文档》V1.17 §5.4 / §5.5）—— M2-17 建档页用。
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

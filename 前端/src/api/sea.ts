import type { components } from './types'
import request from './request'

/**
 * 公海接口封装（→《销售CRM接口API文档》§4.5 海域端点）。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（M0-57 判据：禁止手写）。
 *
 * ⚠ **只封装页面真正用到的那几个**：目前**只有「领取到私海」一条**（F-01 片 2）——
 *   `GET /sea/company` / `GET /sea/department` / `GET /sea/records` / 经理决策等**服务端尚未建**
 *   （→《欠账登记表》D-33 余项）；先写一堆没人调的封装＝把「契约」和「调用方」拆开维护，改一处漏一处。
 */
export type SeaClaimVo = components['schemas']['SeaClaimVoDto']
export type ClaimSeaRelationInput = components['schemas']['ClaimSeaRelationDto']

/** 公海规则行（→ 接口 §5.16 `SeaRuleVoDto`） */
export type SeaRuleVo = components['schemas']['SeaRuleVoDto']
/** 提交公海规则新版本（→ 接口 §5.16 `UpdateSeaRuleDto`；两段式：`confirmed` 控「只预告 / 落库」） */
export type UpdateSeaRuleInput = components['schemas']['UpdateSeaRuleDto']
/** 提交结果（→ 接口 §5.16 `SeaRuleUpdateResultDto`） */
export type SeaRuleUpdateResult = components['schemas']['SeaRuleUpdateResultDto']
/** 公海列表分页（→ 接口 §5.16 `SeaListPageVoDto`） */
export type SeaListPageVo = components['schemas']['SeaListPageVoDto']
/** 公海列表项（→ 接口 §5.16 `SeaListItemVoDto`） */
export type SeaListItem = components['schemas']['SeaListItemVoDto']

/**
 * 领取公海客户到私海（`POST /sea/company/:id/claim`，→ 接口 §4.5 / 需求 §6.3 动线）。
 *
 * ★ `companyId` 是**公司 id**，**不是关系 id**；req `{dept_id, product_line_id}` 定位
 *   「公司 × 部门 × 产品线」下**那一条公海关系**（与 `POST /relations` 逐字同形 ——
 *   一条业务关系＝公司 × 部门 × 产品线，→ 需求 §6.3）。
 * ★ **谁能领由服务端判**（可写角色 ＋ 读范围，与公海读门同一档，不另开一格权限）：
 *   前端**不自己判角色、不自己判"是不是公海"** —— 再判一遍＝第二套权限口径，
 *   改了服务端忘了前端就分叉（本项目点名的坑）。
 * ★ 失败人话**由请求层统一弹出**，页面不翻译：**409**＝刚被同事领走（抢输了）、
 *   **400**＝定位不到（已被领 / 参数指错）、**403**＝越部门或只读角色。
 * ★ 幂等（语义）：领成功后关系已是私海，**重复调用 → 400**（不是 500、不会双写；
 *   `Idempotency-Key` 横切尚未实现 →《欠账登记表》D-06）。
 */
export async function claimSeaRelation(
  companyId: string,
  input: ClaimSeaRelationInput,
): Promise<SeaClaimVo> {
  const { data } = await request.post<SeaClaimVo>(`/sea/company/${companyId}/claim`, input)
  return data
}

/**
 * 公海规则列表（`GET /sea/rules`，→ 接口 §5.16 / 需求 §6.3）—— **含待生效行**（7 天缓冲期内
 * 的新版本行 `pending=true`）。★ 各天数 `null` ＝ 该维度**未配置**，前端显示"未配置"、
 * **不要回落成默认天数**（→ 接口 §5.16）。谁能看由服务端判（gm/admin 全量、部门经理管辖部门、
 * 销售/交付/客服 403），前端不自己判角色。
 */
export async function listSeaRules(): Promise<SeaRuleVo[]> {
  const { data } = await request.get<SeaRuleVo[]>('/sea/rules')
  return data
}

/**
 * 提交公海规则新版本（`PUT /sea/rules`，→ 接口 §5.16）—— **两段式确认**（不新增端点）：
 * `confirmed` 不传 / `false` ⇒ **只回预告**（`affected_customers`，零写库）；`true` ⇒ 落库
 * （插新版本行 ＋ 旧行 `status=disabled`，新版本 **7 天后生效**）。★ 整行覆盖：没给的字段＝
 * 该维度不配（落 `null`），不做"缺省＝沿用"推断。**失败人话由请求层统一弹出**
 * （层级与 key 搭配错 → 400；越权 → 403；部门/产品线不存在 → 400），页面不翻译。
 */
export async function updateSeaRules(input: UpdateSeaRuleInput): Promise<SeaRuleUpdateResult> {
  const { data } = await request.put<SeaRuleUpdateResult>('/sea/rules', input)
  return data
}

/**
 * 公海列表查询入参（→ 接口 §5.16 `GET /sea/company` · `/sea/department`）。
 * ★ 分页默认 1 / 20、上限 100 的**归一归后端**（→ §2.7）；前端不夹第二套。
 * ★ `urgency` 多选**以逗号串传**（后端按逗号拆；空数组＝整个不带该参数，不传空语义）。
 * ★ `desc` 以布尔传，落 query 时转 `'true' / 'false'`（后端白名单只收这两串）。
 */
export interface SeaListQuery {
  page?: number
  pageSize?: number
  view?: string
  urgencies?: readonly string[]
  order_by?: string
  desc?: boolean
  keyword?: string
}

/** 把 `SeaListQuery` 摊成后端要的 query（缺省项整个不带，→ 同 `listRelations` 姿势） */
function toSeaParams(query: SeaListQuery): Record<string, unknown> {
  const { page, pageSize, view, urgencies, order_by, desc, keyword } = query
  return {
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { page_size: pageSize }),
    ...(view === undefined ? {} : { view }),
    ...(urgencies === undefined || urgencies.length === 0 ? {} : { urgency: urgencies.join(',') }),
    ...(order_by === undefined ? {} : { order_by }),
    ...(desc === undefined ? {} : { desc: desc ? 'true' : 'false' }),
    ...(keyword === undefined ? {} : { keyword }),
  }
}

/**
 * 系统公海列表（`GET /sea/company`，→ 接口 §5.16 / Phase 6）。
 *
 * ★ **谁看得到什么由服务端判**（销售＝本部门公海 / 经理＝管辖部门 / 总经理·管理员＝全部；
 *   交付·客服 **403**）—— 前端**不自己判角色**、不自己决定"该列哪些"；把 403 当正常分支展示
 *   （「该角色不进公海」），不是崩掉。
 * ★ `total` **只信服务端**（同一个 where 的全量计数），不拿 `list.length` 当总数。
 */
export async function listCompanySea(query: SeaListQuery = {}): Promise<SeaListPageVo> {
  const { data } = await request.get<SeaListPageVo>('/sea/company', { params: toSeaParams(query) })
  return data
}

/**
 * 部门公海列表（`GET /sea/department`，→ 接口 §5.16 / Phase 6）。
 *
 * ★ `deptId` 必填：只列该部门下的公海关系；越出 viewer 可读部门 → 服务端 **403**（不反推）。
 * ★ 其余口径与 `listCompanySea` 一致。
 */
export async function listDepartmentSea(
  deptId: string,
  query: SeaListQuery = {},
): Promise<SeaListPageVo> {
  const { data } = await request.get<SeaListPageVo>('/sea/department', {
    params: { dept_id: deptId, ...toSeaParams(query) },
  })
  return data
}

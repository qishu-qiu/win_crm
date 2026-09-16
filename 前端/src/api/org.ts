import type { components } from './types'
import request from './request'

/**
 * 组织（部门 / 产品线）接口封装（→《销售CRM接口API文档》§4.1 / §5.3）。
 *
 * ★ 本批（M6-09 片 1）**只封装录入页真正用到的那两个只读端点**：
 *   录入页第 3 步「确认」要选**部门**与**产品线**（`POST /relations` req 含 `dept_id` /
 *   `product_line_id`），此前没有封装 ⇒ 录入页建不出关系。
 *   员工 / 角色 / 权限矩阵等属后续里程碑，**先写没人调的封装＝把契约和调用方拆开维护**。
 *
 * ★ 类型**一律取自 OpenAPI 生成物**（`src/api/types.ts`，由 `npm run gen:types` 生成）：
 *   前后端各维护一份接口类型是本项目点名的「双真相源」重灾区（禁止手写对接）。
 */
export type DepartmentVo = components['schemas']['DepartmentVoDto']
export type ProductLineVo = components['schemas']['ProductLineVoDto']

/**
 * 部门列表（`GET /org/departments`）。
 *
 * ★ 出参是**扁平**的（树形关系由 `parent_id` 自带，接口 §5.3 明文「前端自行组树」）——
 *   录入页只需在「可建部门」里选一个，故**按扁平列表渲染、不加层级前缀**：
 *   现在组一遍树，等组织架构页真要层级时还得再写一次（届时再抽公共件）。
 * ★ **服务端不按数据范围收敛**（这是全公司组织配置，不是业务数据）；
 *   「这个部门我能不能建」由 `POST /relations` 服务端判（越权 → 403，→ §5.6）——
 *   前端**不自己筛**（前端筛一遍＝第二套权限口径）。
 */
export async function listDepartments(): Promise<DepartmentVo[]> {
  const { data } = await request.get<DepartmentVo[]>('/org/departments')
  return data
}

/**
 * 产品线列表（`GET /org/product-lines`）。
 *
 * ⚠ `color_key` **可能为 `null`**（尚未配置配色）：页面**自行回落**（不加色块），
 *   **不许编一个默认色** —— 假默认色会让页面理直气壮地渲染错颜色，且没人会回来改
 *   （→《数据架构文档》A7 / 需求 §13.3）。
 */
export async function listProductLines(): Promise<ProductLineVo[]> {
  const { data } = await request.get<ProductLineVo[]>('/org/product-lines')
  return data
}

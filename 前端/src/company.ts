/**
 * 公司 / 撞库的**展示口径与前端态**（与 `contact.ts` / `relation.ts` 同一性质：
 * 只做「码 → 中文」与「页面中间态」的定义，**不含任何业务判断**）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 查重判级 `match_type` 两码 →《销售CRM接口API文档》§5.4 `POST /companies/search-dup` 出参：
 *     `same` ＝ 核心词完全相同 / `high_sim` ＝ 高度疑似。
 *   · 撞库 4 分支（含分支 4「挂现有公司」的两条出口）→《销售CRM业务需求文档》§12.1。
 *
 * ⚠ 未知取值**原样回显码值**（不猜中文）：库里的枚举若先于规格扩了值，页面要看得出来，
 *   而不是显示成空白 —— 空白会让人以为「没填」（同 `contact.ts` 约定）。
 */

/** 查重判级中文名（→ 接口 §5.4 `match_type`） */
const DUP_MATCH_NAMES: Record<string, string> = {
  same: '核心词完全相同',
  high_sim: '高度疑似',
}

/** 判级 → 中文（未知码原样回显） */
export function dupMatchLabelOf(matchType: string): string {
  return DUP_MATCH_NAMES[matchType] ?? matchType
}

/**
 * 撞库选定的公司 —— **页面内的中间态，不是接口出参**（接口出参一律取 OpenAPI 生成物）：
 * · `existing` ＝ 沿用已有档案（查重候选里选中的，**或**「本次新建」成功后的实际档案）；
 * · `new` ＝ **将新建**（还没写库 —— 真正的 `POST /companies` 由**页面**在提交时做）。
 *
 * ★ 两个消费者各一处：录入页第 2 步「公司」／联系人详情页「关联公司」（→ 需求 §6.1 ③），
 *   故它必须有唯一落点，不能各页各写一个形状（→《架构设计说明》§4.4）。
 */
export type CompanyChoice =
  | { kind: 'existing'; id: string; full_name: string }
  | { kind: 'new'; full_name: string; credit_code: string }

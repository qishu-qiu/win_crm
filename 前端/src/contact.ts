/**
 * 联系人的**展示口径**（码 → 中文的小映射，与 `relation.ts` / `engine.ts` 同一性质：
 * **只做「码 → 中文」**，不含任何业务判断）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 决策角色三型 →《销售CRM数据架构文档》B2 的 `decision_role`：`decision/influence/execute
 *     （决策/影响/执行）`。
 *   · 「未关联公司」筛选 →《销售CRM业务需求文档》§6.1 ③：判定＝该联系人**无任何
 *     `company_contact` 记录**（**派生、不加字段**），入口之一就是联系人列表的这个筛选。
 *
 * ⚠ 未知取值**原样回显码值**（不猜中文）：库里的枚举若先于规格扩了值，页面要看得出来，
 *   而不是显示成空白 —— 空白会让人以为「没填」。
 * ⚠ 字典域（`dict_item`）落地后，这里的常量应改为**读字典**（与 `engine.ts` 同一约定）。
 */

/** 决策角色中文名（→ 数据架构 B2）；`null`/空 ＝ 未定 */
const DECISION_ROLE_NAMES: Record<string, string> = {
  decision: '决策',
  influence: '影响',
  execute: '执行',
}

/** `null` ＝ 未标 → 给占位符（**别显示成「执行」**，那是另一件事，→ 同 `valueTierNameOf`） */
export function decisionRoleNameOf(role: string | null | undefined): string {
  if (role === null || role === undefined || role === '') return '—'
  return DECISION_ROLE_NAMES[role] ?? role
}

/**
 * 「是否只看未关联公司」两档（→ 需求 §6.1 ③）。
 * ★ 选项**只有两档**：第三档（比如"已关联"）在服务端**没有对应入参** ——
 *   页面上不摆一个点了没用的按钮（那等于骗用户"这功能有"）。
 */
export const CONTACT_LINK_FILTERS: readonly { value: 'all' | 'unlinked'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unlinked', label: '未关联公司' },
]

/** 视角取值（＝上面两档的 `value`） */
export type ContactLinkFilter = 'all' | 'unlinked'

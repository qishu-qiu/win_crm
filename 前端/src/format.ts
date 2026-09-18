/**
 * 日期 / 时间的**展示口径**（唯一落点）。
 *
 * ★ 为什么单开一个文件：日期格式化会被多个页面用到（关系列表 / 关系详情 / 联系人详情…），
 *   两处各写一遍就是本项目点名的「双真相源」的**展示版**（改一处漏一处）—— 故格式只在这里定义。
 *   `relation.ts` / `contact.ts` / `company.ts` 只放「业务码 → 中文名」这类业务映射。
 *
 * ⚠ 时区口径：接口出参是 **ISO 8601**（→ 接口 §2.3），`new Date()` 解析后按**本机时区**渲染。
 *   **不要**对 ISO 串做 `slice(0, 10)`：DATETIME 列存的是本地时刻，按 UTC 截断会把
 *   「1 月 1 日」显示成「上一年 12 月 31 日」。
 *   （服务端只对 **DATE 列**（生日）按 UTC 截断成 `YYYY-MM-DD` —— 那是「只存日期」的列，
 *   故本文件对**已是 `YYYY-MM-DD` 形态**的入参**原样返回**，不再绕时区一圈。）
 *
 * ⚠ 解析不出来（坏值）时**原样回显**，不显示成空白 / `Invalid Date` —— 空白会被当成「没填」。
 */

const pad = (n: number): string => n.toString().padStart(2, '0')

/** 已是「只到日」的形态（服务端 DATE 列出参，→ `company.service.ts` 生日口径） */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** ISO 时间 → `YYYY-MM-DD HH:mm`（本机时区）；`null` / 空串 → `—`（**不显示 `null` 字面量**） */
export function formatDateTime(value: string | null): string {
  if (value === null || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * ISO 时间 → `YYYY-MM-DD`（本机时区）；用于**只到日**的字段（生日 / 入职 / 离职）。
 * ★ 入参已经是 `YYYY-MM-DD` 时**原样返回**（见文件头 ⚠：不拿日期串再绕一次时区）。
 */
export function formatDate(value: string | null): string {
  if (value === null || value === '') return '—'
  if (DATE_ONLY.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

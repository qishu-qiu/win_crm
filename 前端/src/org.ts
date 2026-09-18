/**
 * 组织（部门 / 产品线）的**展示口径**（与 `relation.ts` / `contact.ts` 同一性质：
 * 只做「值 → 展示文案」，**不含任何业务判断**）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 部门状态两档 →《销售CRM数据架构文档》A1：`active` / `disabled`；
 *   · 产品线状态 → 同 A7（`status`）；配色键 `color_key` **可空**（未配置给 `null`）。
 *   · 录入页「激活业务关系」要选**部门 × 产品线**（→ 接口 §5.6 `POST /relations` 入参），
 *     该选择件在录入页与联系人详情页各出现一次 ⇒ 按《架构设计说明》§4.4 收口成一份。
 *
 * ★ **停用的选项不隐藏、只标注**：能不能用是**服务端**的判断（越权 → 403，→ 接口 §5.6），
 *   前端把状态**显示出来**即可 —— 隐藏＝替服务端做了决定，且用户看不到"为什么少了那条线"。
 */

/** 部门显示名：停用的标注出来（**不隐藏、也不拦**） */
export function deptLabelOf(dept: { name: string; status: string }): string {
  return dept.status === 'active' ? dept.name : `${dept.name}（已停用）`
}

/** 产品线显示名（同上；色块另由 `color_key` 画出，为 `null` 时**不画**，→ A7） */
export function productLineLabelOf(line: { name: string; status: string }): string {
  return line.status === 'active' ? line.name : `${line.name}（已停用）`
}

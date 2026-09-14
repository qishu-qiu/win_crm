/**
 * 角色 → 登录后首屏名（→《销售CRM业务需求文档》V1.25 §4.1 角色表「主入口」列）。
 *
 * 口径逐字：
 *   销售 → **工作台**（今日动线）｜交付 / 客服 → **工作台·工单待办版**｜
 *   部门经理 / 总经理 → **数据看板**｜管理员 → **组织架构**。
 *
 * ⚠ 这里只负责「叫什么」，**不负责路由跳转**：M1-18 是方案 A 的最小页（登录 → 空壳），
 *   真正的首屏页面属 M2 起的里程碑；本函数保证空壳上写的是**规格里的那个名字**，
 *   而不是随手写「欢迎使用」——那样等真页面接上时会出现两套说法。
 */
export function homeNameOf(role: string): string {
  switch (role) {
    case 'sale':
      return '工作台'
    case 'service':
    case 'delivery':
      return '工作台（工单待办版）'
    case 'dept_manager':
    case 'gm':
      return '数据看板'
    case 'admin':
      return '组织架构'
    default:
      // 未知 / 自定义角色码：不编造化页面名，回落到最中性的「工作台」
      return '工作台'
  }
}

/** 角色码 → 中文名（内置 6 条，→《数据架构文档》V1.30 A4）；用于空壳上的角色小标 */
export function roleNameOf(role: string): string {
  const names: Record<string, string> = {
    sale: '销售',
    service: '客服',
    delivery: '交付',
    admin: '管理员',
    dept_manager: '部门经理',
    gm: '总经理',
  }
  return names[role] ?? role
}

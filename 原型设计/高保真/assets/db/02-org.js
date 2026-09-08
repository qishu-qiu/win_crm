/* ============================================================
 * DB 域 2：组织与人员（org）
 * 部门、员工、产品线、角色、权限 —— 全原型人员/部门数据唯一来源
 * ============================================================ */
window.DB = window.DB || {};
window.DB.org = {

  /* 部门（含部门规则 N12；rule=null 表示未配置） */
  departments: [
    { id: 1, name: '线上营销一部', parentName: '营销中心', productLineIds: [1, 3], serviceEnabled: true,  managerId: 101, status: 'active',
      rule: { levelTiers: [{ level: 'A', minAmount: 100000 }, { level: 'B', minAmount: 50000 }, { level: 'C', minAmount: 10000 }, { level: 'D', minAmount: 0 }], grayRemindDays: 7, grayReleaseDays: 15 } },
    { id: 2, name: '线上营销二部', parentName: '营销中心', productLineIds: [2], serviceEnabled: false, managerId: 102, status: 'active',
      rule: { levelTiers: [{ level: 'A', minAmount: 80000 }, { level: 'B', minAmount: 30000 }, { level: 'C', minAmount: 8000 }, { level: 'D', minAmount: 0 }], grayRemindDays: 10, grayReleaseDays: 20 } },
    { id: 3, name: '财税事业部',   parentName: '总部',     productLineIds: [4], serviceEnabled: true,  managerId: 103, status: 'active',
      rule: { levelTiers: [{ level: 'A', minAmount: 60000 }, { level: 'B', minAmount: 20000 }, { level: 'C', minAmount: 5000 }, { level: 'D', minAmount: 0 }], grayRemindDays: 5, grayReleaseDays: 12 } },
    { id: 4, name: '法律咨询部',   parentName: '总部',     productLineIds: [5], serviceEnabled: false, managerId: 104, status: 'active', rule: null },
    { id: 5, name: '房产事业部',   parentName: '总部',     productLineIds: [6], serviceEnabled: true,  managerId: 105, status: 'active',
      rule: { levelTiers: [{ level: 'A', minAmount: 150000 }, { level: 'B', minAmount: 60000 }, { level: 'C', minAmount: 15000 }, { level: 'D', minAmount: 0 }], grayRemindDays: 7, grayReleaseDays: 14 } },
    { id: 6, name: '招聘事业部',   parentName: '总部',     productLineIds: [7], serviceEnabled: true,  managerId: 106, status: 'active',
      rule: { levelTiers: [{ level: 'A', minAmount: 50000 }, { level: 'B', minAmount: 20000 }, { level: 'C', minAmount: 5000 }, { level: 'D', minAmount: 0 }], grayRemindDays: 7, grayReleaseDays: 14 } }
  ],

  /* 产品线 */
  productLines: [
    { id: 1, code: 'short_video', name: '短视频推广', deptIds: [1], serviceCycleDays: 90, seaDefaults: { freq: 3, deal: 30, stay: 7 } },
    { id: 2, code: 'website',     name: '网站建设',   deptIds: [2], serviceCycleDays: 180, seaDefaults: { freq: 3, deal: 30, stay: 7 } },
    { id: 3, code: 'geo',         name: 'GEO',        deptIds: [1], serviceCycleDays: 180, seaDefaults: { freq: 5, deal: 60, stay: 10 } },
    { id: 4, code: 'tax',         name: '财税咨询',   deptIds: [3], serviceCycleDays: 365, seaDefaults: { freq: 5, deal: 20, stay: 7 } },
    { id: 5, code: 'law',         name: '法律咨询',   deptIds: [4], serviceCycleDays: 365, seaDefaults: { freq: 5, deal: 25, stay: 7 } },
    { id: 6, code: 'estate',      name: '房产网',     deptIds: [5], serviceCycleDays: 180, seaDefaults: { freq: 7, deal: 30, stay: 7 } },
    { id: 7, code: 'recruit',     name: '招牌网',     deptIds: [6], serviceCycleDays: 180, seaDefaults: { freq: 5, deal: 20, stay: 7 } }
  ],

  /* 员工（姓名+头像哈希 av0~av11+角色码） */
  employees: [
    { id: 101, name: '王强',  workNo: 'E001', deptId: 1, roleCodes: ['dept_manager'], av: 'av3',  status: 'active', phone: '138****0001' },
    { id: 102, name: '刘敏',  workNo: 'E002', deptId: 2, roleCodes: ['dept_manager'], av: 'av5',  status: 'active', phone: '138****0002' },
    { id: 103, name: '陈静',  workNo: 'E003', deptId: 3, roleCodes: ['dept_manager'], av: 'av7',  status: 'active', phone: '138****0003' },
    { id: 104, name: '赵磊',  workNo: 'E004', deptId: 4, roleCodes: ['dept_manager'], av: 'av9',  status: 'active', phone: '138****0004' },
    { id: 105, name: '孙丽',  workNo: 'E005', deptId: 5, roleCodes: ['dept_manager'], av: 'av11', status: 'active', phone: '138****0005' },
    { id: 106, name: '周涛',  workNo: 'E006', deptId: 6, roleCodes: ['dept_manager'], av: 'av1',  status: 'active', phone: '138****0006' },
    { id: 201, name: '张伟',  workNo: 'S101', deptId: 1, roleCodes: ['sale'], av: 'av0',  status: 'active', phone: '138****0011' },
    { id: 202, name: '王芳',  workNo: 'S102', deptId: 1, roleCodes: ['sale'], av: 'av4',  status: 'active', phone: '138****0012' },
    { id: 203, name: '刘洋',  workNo: 'S201', deptId: 2, roleCodes: ['sale'], av: 'av6',  status: 'active', phone: '138****0013' },
    { id: 204, name: '陈昊',  workNo: 'S301', deptId: 3, roleCodes: ['sale'], av: 'av10', status: 'active', phone: '138****0014' },
    { id: 205, name: '郑凯',  workNo: 'S401', deptId: 4, roleCodes: ['sale'], av: 'av2',  status: 'active', phone: '138****0015' },
    { id: 206, name: '林峰',  workNo: 'S501', deptId: 5, roleCodes: ['sale'], av: 'av8',  status: 'active', phone: '138****0016' },
    { id: 207, name: '徐蕾',  workNo: 'S601', deptId: 6, roleCodes: ['sale'], av: 'av11', status: 'active', phone: '138****0017' },
    { id: 301, name: '李娜',  workNo: 'V101', deptId: 1, roleCodes: ['service'], av: 'av2',  status: 'active', phone: '138****0021' },
    { id: 302, name: '吴敏',  workNo: 'V201', deptId: 2, roleCodes: ['service'], av: 'av8',  status: 'active', phone: '138****0022' },
    { id: 401, name: '赵总',  workNo: 'G001', deptId: 0, roleCodes: ['gm'], av: 'av6',  status: 'active', phone: '138****0099' }
  ],

  /* 角色 */
  roles: [
    { code: 'sale',         name: '销售',   isBuiltin: true },
    { code: 'service',      name: '客服',   isBuiltin: true },
    { code: 'delivery',     name: '交付',   isBuiltin: true },
    { code: 'dept_manager', name: '部门经理', isBuiltin: true },
    { code: 'gm',           name: '总经理', isBuiltin: true },
    { code: 'admin',        name: '行政',   isBuiltin: true }
  ],

  /* 当前登录人（全站顶栏统一渲染；原型演示选总经理便于看全公司数据） */
  currentUser: {
    id: 401, name: '赵总', workNo: 'G001', deptId: 1, deptName: '线上营销一部',
    roleCodes: ['gm'], roleName: '总经理', av: 'av6', phone: '138****0099',
    managedDeptIds: [1, 2, 3, 4, 5, 6]
  },

  /* 权限矩阵（简化：permKey → 角色可见级别） */
  permissionMatrix: {
    cross_dept_private:  { sale: 'denied', dept_manager: 'visible', gm: 'visible' },
    contract_amount:     { sale: 'masked', dept_manager: 'visible', gm: 'visible' },
    company_total_value: { sale: 'masked', dept_manager: 'visible', gm: 'visible' },
    cross_line_amount:   { sale: 'masked', dept_manager: 'masked',  gm: 'visible' }
  }
};

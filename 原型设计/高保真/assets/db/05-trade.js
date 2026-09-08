/* ============================================================
 * DB 域 5：交易 / 服务 / 系统（trade）
 * 合同、回款、工单、台账、审批、通知、看板、报表 —— 交易与系统页数据来源
 * ============================================================ */
window.DB = window.DB || {};
window.DB.trade = {

  /* 看板 KPI 与预警（dashboard） */
  dashboard: {
    summary: { todayNew: 3, todayFollow: 8, todayOverdue: 2, monthSignAmount: 586000, monthSignRatio: 12.4, relationCount: 140 },
    distribution: [
      { status: 'data', count: 32 }, { status: 'intent', count: 58 },
      { status: 'customer', count: 26 }, { status: 'renew', count: 14 }, { status: 'lost', count: 10 }
    ],
    alerts: { expiringContracts: { count30: 5, count60: 8, count90: 12 }, droppingSoon: [{ relationId: 'R1011', companyName: '义乌电商城', hoursLeft: 24 }], newOpportunity: { count: 3 } },
    deptCompare: [
      { deptName: '线上营销一部', signAmount: 216000, ratio: 18.2 },
      { deptName: '线上营销二部', signAmount: 98000, ratio: 8.6 },
      { deptName: '财税事业部', signAmount: 132000, ratio: 11.5 },
      { deptName: '法律咨询部', signAmount: 0, ratio: 0 },
      { deptName: '房产事业部', signAmount: 85000, ratio: -3.2 },
      { deptName: '招聘事业部', signAmount: 55000, ratio: 5.1 }
    ],
    salesTop: [
      { name: '张伟', amount: 168000 }, { name: '林峰', amount: 126000 },
      { name: '王芳', amount: 98000 }, { name: '陈昊', amount: 76000 }, { name: '徐蕾', amount: 42000 }
    ],
    trend12: [32000, 46000, 38000, 52000, 61000, 48000, 72000, 66000, 58000, 89000, 76000, 96000]
  },

  /* 合同（contract 列表/详情/创建） */
  contracts: [
    { id: 'CT001', contractNo: 'HT-2026-0001', relationId: 'R1008', companyName: '美家家居', productLineName: '房产网', signerName: '林峰', signerId: 206,
      amount: 160000, paidAmount: 50000, paidRatio: 31.2, payType: 'installment', signDate: '2026-06-20', serviceEnd: '2026-12-20',
      status: 'running', maintainerName: '何静', remindDays: 30, autoRenew: false },
    { id: 'CT002', contractNo: 'HT-2026-0002', relationId: 'R1001', companyName: '云启科技', productLineName: '短视频推广', signerName: '张伟', signerId: 201,
      amount: 88000, paidAmount: 88000, paidRatio: 100, payType: 'once', signDate: '2026-03-18', serviceEnd: '2026-09-18',
      status: 'running', maintainerName: '李娜', remindDays: 60, autoRenew: true },
    { id: 'CT003', contractNo: 'HT-2026-0003', relationId: 'R1007', companyName: '中远物流', productLineName: '法律咨询', signerName: '郑凯', signerId: 205,
      amount: 60000, paidAmount: 20000, paidRatio: 33.3, payType: 'monthly', signDate: '2026-01-15', serviceEnd: '2027-01-15',
      status: 'running', maintainerName: '孙倩', remindDays: 90, autoRenew: false },
    { id: 'CT004', contractNo: 'HT-2026-0004', relationId: 'R1009', companyName: '顺风人力', productLineName: '招牌网', signerName: '徐蕾', signerId: 207,
      amount: 12000, paidAmount: 0, paidRatio: 0, payType: 'yearly', signDate: '2026-09-01', serviceEnd: '2027-09-01',
      status: 'unpaid', maintainerName: '马涛', remindDays: 30, autoRenew: false },
    { id: 'CT005', contractNo: 'HT-2025-0117', relationId: 'R1002', companyName: '恒盛机械', productLineName: 'GEO', signerName: '张伟', signerId: 201,
      amount: 60000, paidAmount: 60000, paidRatio: 100, payType: 'once', signDate: '2025-11-02', serviceEnd: '2026-05-02',
      status: 'terminated', maintainerName: '李娜', remindDays: 30, autoRenew: false, terminateReason: '服务期满' }
  ],
  payments: [
    { id: 'PY001', contractNo: 'HT-2026-0001', amount: 50000, paidAt: '2026-07-01', method: '对公转账', creatorName: '林峰' },
    { id: 'PY002', contractNo: 'HT-2026-0002', amount: 88000, paidAt: '2026-03-18', method: '对公转账', creatorName: '张伟' },
    { id: 'PY003', contractNo: 'HT-2026-0003', amount: 20000, paidAt: '2026-01-15', method: '对公转账', creatorName: '郑凯' }
  ],

  /* 工单（aftersale 售后 / opportunity 商机） */
  workorders: [
    { id: 'WO001', orderNo: 'WO-2026-0101', type: 'aftersale', title: '短视频账号数据异常', companyName: '云启科技', relationId: 'R1001',
      source: '客户来电', priority: 'P1', slaDeadline: '2026-09-08 18:00', assigneeName: '李娜', creatorName: '张伟',
      status: 'processing', createdAt: '2026-09-06 15:00' },
    { id: 'WO002', orderNo: 'WO-2026-0102', type: 'opportunity', title: '官网 SEO 优化咨询', companyName: '文理教育', relationId: 'R1004',
      source: '销售转商机', priority: 'P2', slaDeadline: null, assigneeName: '吴敏', creatorName: '刘洋',
      status: 'confirming', createdAt: '2026-09-02 10:00' },
    { id: 'WO003', orderNo: 'WO-2026-0103', type: 'aftersale', title: '网站后台无法登录', companyName: '中远物流', relationId: 'R1007',
      source: '工单升级', priority: 'P0', slaDeadline: '2026-09-07 12:00', assigneeName: '孙倩', creatorName: '郑凯',
      status: 'assigned', createdAt: '2026-09-07 08:30' }
  ],

  /* 台账（ledger：客户台账，extra_fields 扩展） */
  ledger: [
    { id: 'LD001', contractNo: 'HT-2026-0001', companyName: '美家家居', productLineName: '房产网', customerLevel: 'A', signDate: '2026-06-20', expireDate: '2026-12-20', contactName: '孙经理', deliveryName: '何静', saleName: '林峰', extra: { 抖音号: 'meijia_live', 投放城市: '杭州/湖州' } },
    { id: 'LD002', contractNo: 'HT-2026-0002', companyName: '云启科技', productLineName: '短视频推广', customerLevel: 'B', signDate: '2026-03-18', expireDate: '2026-09-18', contactName: '周敏', deliveryName: '李娜', saleName: '张伟', extra: { 抖音号: 'yunqi_official', 重点优化: '线索转化率' } },
    { id: 'LD003', contractNo: 'HT-2026-0003', companyName: '中远物流', productLineName: '法律咨询', customerLevel: 'B', signDate: '2026-01-15', expireDate: '2027-01-15', contactName: '赵总', deliveryName: '孙倩', saleName: '郑凯', extra: {} },
    { id: 'LD004', contractNo: 'HT-2026-0004', companyName: '顺风人力', productLineName: '招牌网', customerLevel: 'C', signDate: '2026-09-01', expireDate: '2027-09-01', contactName: '徐总', deliveryName: '马涛', saleName: '徐蕾', extra: {} }
  ],

  /* 审批（transfer/collaborate/phone_change/reimburse） */
  approvals: [
    { id: 'AP001', type: 'transfer', title: '业务关系转交：恒盛机械(GEO)', applicantName: '王芳', applicantId: 202, approverName: '王强',
      createdAt: '2026-09-07 09:00', status: 'pending', payload: { toUser: '刘洋', reason: '区域调整' } },
    { id: 'AP002', type: 'phone_change', title: '联系人手机号变更：周敏', applicantName: '张伟', approverName: '王强',
      createdAt: '2026-09-06 11:20', status: 'pending', payload: { newPhone: '138****8899' } },
    { id: 'AP003', type: 'collaborate', title: '协同申请：嘉和餐饮(短视频)', applicantName: '王芳', approverName: '王强',
      createdAt: '2026-09-05 16:00', status: 'approved', payload: { colleague: '郑凯', reason: '需要法律条款支持' } }
  ],

  /* 通知（notice 中心） */
  notifications: [
    { id: 'NT001', type: 'risk', title: '灰度预警：华远进出口已 18 天未定性', bizType: 'gray', targetUrl: 'relation-detail.html?id=R1005', createdAt: '2026-09-07 08:00', read: false },
    { id: 'NT002', type: 'todo', title: '待审批：王芳提交业务关系转交', bizType: 'approval', targetUrl: 'approval.html', createdAt: '2026-09-07 09:00', read: false },
    { id: 'NT003', type: 'system', title: '部门规则已更新：线上营销一部', bizType: 'rule', targetUrl: 'org-department.html', createdAt: '2026-09-06 18:00', read: true }
  ],

  /* 报表口径（report：6 步漏斗/紧迫分布/灰度预警/公海/续约/SLA） */
  funnel: [
    { stageId: 1, name: '初步建联', count: 320 },
    { stageId: 2, name: '需求确认', count: 186 },
    { stageId: 3, name: '面访产品讲解', count: 95 },
    { stageId: 4, name: '异议与卡点', count: 62 },
    { stageId: 5, name: '逼单', count: 41 },
    { stageId: 6, name: '已合作', count: 23 }
  ],
  urgencyStats: [
    { code: 'weekly', name: '周重点', count: 12 },
    { code: 'monthly', name: '月重点', count: 28 },
    { code: 'quarterly', name: '季度跟', count: 35 },
    { code: 'long_term', name: '长期跟', count: 19 },
    { code: 'gray', name: '灰度', count: 46 }
  ],
  grayAlerts: [
    { relationId: 'R1005', companyName: '华远进出口', ownerName: '陈昊', deptName: '财税事业部', grayDays: 18, remindDays: 5, releaseDays: 12, level: 'release', action: '列为公海释放候选，待经理确认' },
    { relationId: 'R1006', companyName: '启明装饰', ownerName: '王芳', deptName: '线上营销一部', grayDays: 23, remindDays: 7, releaseDays: 15, level: 'release', action: '列为公海释放候选，待经理确认' },
    { relationId: 'R1010', companyName: '青山农业', ownerName: '王芳', deptName: '线上营销一部', grayDays: 28, remindDays: 7, releaseDays: 15, level: 'remind', action: '已提醒 2 次，请销售下结论' }
  ],
  seaReport: { totalCount: 47, byLine: [{ name: '短视频推广', count: 12 }, { name: '网站建设', count: 8 }, { name: 'GEO', count: 9 }, { name: '财税咨询', count: 5 }, { name: '法律咨询', count: 4 }, { name: '房产网', count: 6 }, { name: '招牌网', count: 3 }] },
  renewAlerts: { count30: 5, count60: 8, count90: 12, list: [{ companyName: '云启科技', amount: 88000, expireDate: '2026-09-18' }, { companyName: '美家家居', amount: 110000, expireDate: '2026-12-20' }] },
  slaStats: { total: 42, p0Rate: 98, p1Rate: 92, p2Rate: 88, p3Rate: 85 }
};

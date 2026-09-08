/* ============================================================
 * DB 域 1：字典与口径（dict）
 * 挂在 window.DB.dict —— 全原型唯一数据真相源
 * ============================================================ */
window.DB = window.DB || {};
window.DB.dict = {

  /* 6 步状态机（V2.5 5.6.2，替换旧 5 步） */
  stages: [
    { id: 1, name: '初步建联',     desc: '首次有效电话/微信沟通' },
    { id: 2, name: '需求确认',     desc: '聊清预算/需求/决策链' },
    { id: 3, name: '面访产品讲解', desc: '当面演示过产品' },
    { id: 4, name: '异议与卡点',   desc: '客户提出效果/价格疑虑' },
    { id: 5, name: '逼单',         desc: '明确报价、要求表态' },
    { id: 6, name: '已合作',       desc: '签约回款，isTerminal' }
  ],

  /* 紧迫档 5 档（纯手动、默认灰度、无自动降级） */
  urgency: [
    { code: 'weekly',    name: '周重点', color: '#F56C6C', sort: 1 },
    { code: 'monthly',   name: '月重点', color: '#E6A23C', sort: 2 },
    { code: 'quarterly', name: '季度跟', color: '#409EFF', sort: 3 },
    { code: 'long_term', name: '长期跟', color: '#67C23A', sort: 4 },
    { code: 'gray',      name: '灰度',   color: '#909399', sort: 5 } // 默认
  ],

  /* 业务线价值 4 档（默认空 = pending） */
  valueLevel: [
    { code: 'high',    name: '高',   color: '#F56C6C' },
    { code: 'medium',  name: '中',   color: '#E6A23C' },
    { code: 'low',     name: '低',   color: '#409EFF' },
    { code: 'pending', name: '待定', color: '#C0C4CC' }
  ],

  /* 风险标签（自动为主+人工可补，auto 只读 ⚙） */
  riskTags: [
    { id: 501, code: 'lost_signal',     name: '流失信号',   label: '流失信号',   usageCount: 14, builtin: true, status: 'active', rule: '连续 7 天无跟进且阶段∈(1,2,3)' },
    { id: 502, code: 'payment_risk',    name: '回款风险',   label: '回款风险',   usageCount: 6,  builtin: true, status: 'active', rule: '合同回款逾期 15 天' },
    { id: 503, code: 'delivery_risk',   name: '交付风险',   label: '交付风险',   usageCount: 3,  builtin: true, status: 'active', rule: '工单超时未处理（SLA 超标）' },
    { id: 504, code: 'contact_changed', name: '对接人变动', label: '对接人变动', usageCount: 2,  builtin: true, status: 'active', rule: '联系人离职/在职状态变更' }
  ],

  /* 协同标签（手动，可 @ 同事） */
  coopTags: [
    { id: 601, code: 'need_visit',    name: '需陪访',     label: '需陪访',     usageCount: 9, builtin: true, status: 'active' },
    { id: 602, code: 'need_tech',     name: '需技术支持', label: '需技术支持', usageCount: 5, builtin: true, status: 'active' },
    { id: 603, code: 'need_proposal', name: '需方案支持', label: '需方案支持', usageCount: 7, builtin: true, status: 'active' }
  ],

  /* 公司画像：身份标签（多选，全公司共享） */
  companyIdentityTags: [
    { id: 101, code: 'local_well_known', label: '本地知名', usageCount: 42, builtin: true,  status: 'active' },
    { id: 102, code: 'listed',           label: '上市公司', usageCount: 8,  builtin: true,  status: 'active' },
    { id: 103, code: 'state_owned',      label: '国资背景', usageCount: 5,  builtin: true,  status: 'active' },
    { id: 104, code: 'chain_group',      label: '连锁集团', usageCount: 17, builtin: true,  status: 'active' },
    { id: 105, code: 'group_type',       label: '集团型',   usageCount: 23, builtin: true,  status: 'active' },
    { id: 106, code: 'new_industry',     label: '新兴行业', usageCount: 3,  builtin: false, status: 'active' }
  ],

  /* 公司画像：制度标签（多选） */
  companyPolicyTags: [
    { id: 201, code: 'need_bidding',      label: '需招投标',     usageCount: 12, builtin: true,  status: 'active' },
    { id: 202, code: 'used_competitor',   label: '已用竞品',     usageCount: 27, builtin: true,  status: 'active' },
    { id: 203, code: 'group_procurement', label: '集团统一采购', usageCount: 6,  builtin: true,  status: 'active' },
    { id: 204, code: 'annual_review',     label: '年度框架采购', usageCount: 0,  builtin: false, status: 'disabled' }
  ],

  /* 公司画像：决策链（单选） */
  decisionChain: [
    { id: 301, code: 'short',   label: '决策链短（老板直拍）', usageCount: 35, builtin: true, status: 'active' },
    { id: 302, code: 'long',    label: '决策链长（多层评审）', usageCount: 21, builtin: true, status: 'active' },
    { id: 303, code: 'unknown', label: '未知',                 usageCount: 9,  builtin: true, status: 'active' }
  ],

  /* 联系人谈判特质（≤3，换公司保留） */
  contactTraits: [
    { id: 401, code: 'price_sensitive', label: '价格敏感',        usageCount: 31, builtin: true,  status: 'active' },
    { id: 402, code: 'relationship',    label: '关系型',          usageCount: 24, builtin: true,  status: 'active' },
    { id: 403, code: 'case_oriented',   label: '方案型（要案例）', usageCount: 18, builtin: true,  status: 'active' },
    { id: 404, code: 'professional',    label: '专业控',          usageCount: 11, builtin: true,  status: 'active' },
    { id: 405, code: 'data_driven',     label: '数据驱动',        usageCount: 2,  builtin: false, status: 'active' }
  ],

  /* 关系状态 */
  relationStatus: [
    { code: 'data',     name: '资料',   color: '#909399' },
    { code: 'intent',   name: '意向',   color: '#409EFF' },
    { code: 'customer', name: '客户',   color: '#67C23A' },
    { code: 'renew',    name: '续约',   color: '#E6A23C' },
    { code: 'lost',     name: '流失',   color: '#F56C6C' }
  ],

  /* 跟单态度 / 意向进展 / 决策权 / 公海状态 / 跟进方式 */
  attitude: [
    { code: 'positive', name: '积极' }, { code: 'neutral', name: '中立' }, { code: 'negative', name: '消极' }
  ],
  progress: [
    { code: 'forward', name: '推进↑' }, { code: 'flat', name: '持平→' }, { code: 'back', name: '后退↓' }
  ],
  decisionRole: [
    { code: 'decision', name: '决策人' }, { code: 'influence', name: '影响人' }, { code: 'execute', name: '执行人' }
  ],
  seaStatus: [
    { code: 'private',     name: '私海',     color: '#67C23A' },
    { code: 'dept_sea',    name: '部门公海', color: '#E6A23C' },
    { code: 'company_sea', name: '系统公海', color: '#F56C6C' },
    { code: 'to_release',  name: '待释放',   color: '#909399' }
  ],
  followMethod: [
    { code: 'phone',  name: '电话' }, { code: 'wechat', name: '微信' },
    { code: 'visit',  name: '陌拜' }, { code: 'onsite', name: '到访' }, { code: 'email', name: '邮件' }
  ],

  /* 客户等级档位默认展示（实际为部门级 dept_rule.levelTiers） */
  customerLevels: [
    { code: 'A', name: 'A 级', color: '#F56C6C' }, { code: 'B', name: 'B 级', color: '#E6A23C' },
    { code: 'C', name: 'C 级', color: '#409EFF' }, { code: 'D', name: 'D 级', color: '#909399' }
  ],

  /* 流失原因 / 掉公海原因 / 审批类型 / 工单优先级 */
  lostReason: [
    { code: 'price', name: '价格原因' }, { code: 'no_need', name: '暂无需求' },
    { code: 'competitor', name: '选择竞品' }, { code: 'decision', name: '决策链变动' }
  ],
  seaReason: [
    { code: 'follow_timeout', name: '跟进超时' }, { code: 'deal_timeout', name: '成单超时' },
    { code: 'stagnant', name: '进展停滞' }, { code: 'release', name: '主动释放' }
  ],
  approvalType: [
    { code: 'transfer', name: '转交' }, { code: 'collaborate', name: '协同' },
    { code: 'phone_change', name: '手机号变更' }, { code: 'reimburse', name: '报销' }
  ],
  woPriority: [
    { code: 'P0', name: 'P0', color: '#F56C6C' }, { code: 'P1', name: 'P1', color: '#E6A23C' },
    { code: 'P2', name: 'P2', color: '#409EFF' }, { code: 'P3', name: 'P3', color: '#909399' }
  ]
};

/* ============================================================
 * DB 域 3：客户资产（customer）
 * 公司档案、联系人、画像标签、谈判特质 —— 公司/联系人页面数据来源
 * ============================================================ */
window.DB = window.DB || {};
window.DB.customer = {

  /* 公司档案（G01/G02 数据源；画像标签=公司级共享） */
  companies: [
    { id: 'C2001', fullName: '杭州云启科技有限公司', shortName: '云启科技', creditCode: '91330106MA27X****1',
      industryL1: '信息技术', industryL2: '软件服务', province: '浙江', city: '杭州', scale: '中型',
      completeness: { c1: 100, c2: 80, c3: 40 }, missingFields: ['bank_name', 'invoice_title'],
      identityTagCodes: ['listed', 'local_well_known'], policyTagCodes: ['need_bidding'], decisionChain: 'long',
      businessLineCount: 2, totalValue: 208000, firstSignAt: '2026-03-18', website: 'www.yunqi.example.com',
      address: '杭州市西湖区文三路 100 号', contactIds: ['P3001', 'P3002', 'P3003'] },
    { id: 'C2002', fullName: '宁波恒盛机械制造有限公司', shortName: '恒盛机械', creditCode: '91330206MA2A****2',
      industryL1: '制造业', industryL2: '装备制造', province: '浙江', city: '宁波', scale: '大型',
      completeness: { c1: 100, c2: 90, c3: 60 }, missingFields: [],
      identityTagCodes: ['group_type'], policyTagCodes: ['need_bidding', 'used_competitor'], decisionChain: 'long',
      businessLineCount: 3, totalValue: 88000, firstSignAt: '2025-11-02', website: 'www.hsm.example.com',
      address: '宁波市鄞州区工业园区', contactIds: ['P3004'] },
    { id: 'C2003', fullName: '温州嘉和餐饮管理有限公司', shortName: '嘉和餐饮', creditCode: '91330302MA2A****3',
      industryL1: '生活服务', industryL2: '餐饮连锁', province: '浙江', city: '温州', scale: '中型',
      completeness: { c1: 90, c2: 60, c3: 0 }, missingFields: ['bank_name', 'invoice_title', 'tax_no'],
      identityTagCodes: ['chain_group'], policyTagCodes: [], decisionChain: 'short',
      businessLineCount: 1, totalValue: 45000, firstSignAt: null, website: '',
      address: '温州市鹿城区五马街 88 号', contactIds: ['P3005'] },
    { id: 'C2004', fullName: '绍兴文理教育咨询有限公司', shortName: '文理教育', creditCode: '91330602MA2A****4',
      industryL1: '教育', industryL2: '职业教育', province: '浙江', city: '绍兴', scale: '小型',
      completeness: { c1: 100, c2: 40, c3: 0 }, missingFields: ['bank_name', 'invoice_title'],
      identityTagCodes: [], policyTagCodes: [], decisionChain: 'unknown',
      businessLineCount: 1, totalValue: 30000, firstSignAt: null, website: '',
      address: '绍兴市越城区人民路 12 号', contactIds: ['P3006'] },
    { id: 'C2005', fullName: '台州华远进出口贸易有限公司', shortName: '华远进出口', creditCode: '91331001MA2A****5',
      industryL1: '商贸', industryL2: '进出口', province: '浙江', city: '台州', scale: '中型',
      completeness: { c1: 80, c2: 20, c3: 0 }, missingFields: ['invoice_title'],
      identityTagCodes: ['state_owned'], policyTagCodes: [], decisionChain: 'unknown',
      businessLineCount: 1, totalValue: 20000, firstSignAt: null, website: '',
      address: '台州市椒江区海门街道', contactIds: ['P3007'] },
    { id: 'C2006', fullName: '金华启明建筑装饰工程有限公司', shortName: '启明装饰', creditCode: '91330701MA2A****6',
      industryL1: '建筑', industryL2: '装饰装修', province: '浙江', city: '金华', scale: '小型',
      completeness: { c1: 60, c2: 10, c3: 0 }, missingFields: ['bank_name', 'invoice_title', 'tax_no'],
      identityTagCodes: [], policyTagCodes: [], decisionChain: 'short',
      businessLineCount: 1, totalValue: 15000, firstSignAt: null, website: '',
      address: '金华市婺城区双龙南街 66 号', contactIds: ['P3008'] },
    { id: 'C2007', fullName: '嘉兴中远物流有限公司', shortName: '中远物流', creditCode: '91330401MA2A****7',
      industryL1: '物流', industryL2: '公路运输', province: '浙江', city: '嘉兴', scale: '中型',
      completeness: { c1: 100, c2: 70, c3: 30 }, missingFields: ['invoice_title'],
      identityTagCodes: [], policyTagCodes: [], decisionChain: 'long',
      businessLineCount: 1, totalValue: 60000, firstSignAt: '2026-01-15', website: '',
      address: '嘉兴市秀洲区中环西路 500 号', contactIds: ['P3009'] },
    { id: 'C2008', fullName: '湖州美家家居用品有限公司', shortName: '美家家居', creditCode: '91330501MA2A****8',
      industryL1: '零售', industryL2: '家居建材', province: '浙江', city: '湖州', scale: '中型',
      completeness: { c1: 100, c2: 100, c3: 80 }, missingFields: [],
      identityTagCodes: ['local_well_known'], policyTagCodes: [], decisionChain: 'short',
      businessLineCount: 2, totalValue: 160000, firstSignAt: '2025-06-20', website: '',
      address: '湖州市吴兴区太湖路 1 号', contactIds: ['P3010'] }
  ],

  /* 联系人（特质跟着人走、换公司保留；companyCount=跨公司就职数） */
  contacts: [
    { id: 'P3001', name: '周敏',   title: '市场总监', decisionRole: 'decision', phoneMasked: '138****6677', companyCount: 1, status: 'active', traitCodes: ['price_sensitive', 'case_oriented'], personalTags: ['爱喝茶'], companyId: 'C2001', markedBy: '张伟', markedAt: '2026-09-07 09:15' },
    { id: 'P3002', name: '吴建国', title: '总经理',   decisionRole: 'decision', phoneMasked: '139****2233', companyCount: 1, status: 'active', traitCodes: ['relationship'], personalTags: [], companyId: 'C2001', markedBy: '李娜', markedAt: '2026-09-05 16:40' },
    { id: 'P3003', name: '陈小雨', title: '品牌专员', decisionRole: 'execute',  phoneMasked: '137****8899', companyCount: 1, status: 'active', traitCodes: ['professional', 'data_driven'], personalTags: ['老板亲戚'], companyId: 'C2001', markedBy: '张伟', markedAt: '2026-09-06 10:05' },
    { id: 'P3004', name: '刘建国', title: '采购总监', decisionRole: 'influence', phoneMasked: '136****4455', companyCount: 2, status: 'active', traitCodes: ['price_sensitive'], personalTags: [], companyId: 'C2002', markedBy: '张伟', markedAt: '2026-09-06 11:20' },
    { id: 'P3005', name: '陈伟',   title: '运营经理', decisionRole: 'decision', phoneMasked: '135****7788', companyCount: 1, status: 'active', traitCodes: ['relationship', 'case_oriented'], personalTags: [], companyId: 'C2003', markedBy: '王芳', markedAt: '2026-09-04 09:00' },
    { id: 'P3006', name: '孙校长', title: '校长',     decisionRole: 'decision', phoneMasked: '134****9900', companyCount: 1, status: 'active', traitCodes: ['professional'], personalTags: [], companyId: 'C2004', markedBy: '刘洋', markedAt: '2026-09-01 10:00' },
    { id: 'P3007', name: '王总',   title: '总经理',   decisionRole: 'decision', phoneMasked: '133****1122', companyCount: 1, status: 'active', traitCodes: [], personalTags: [], companyId: 'C2005', markedBy: '陈昊', markedAt: '2026-08-20 14:00' },
    { id: 'P3008', name: '李工',   title: '工程部经理', decisionRole: 'influence', phoneMasked: '132****3344', companyCount: 1, status: 'active', traitCodes: ['price_sensitive'], personalTags: [], companyId: 'C2006', markedBy: '王芳', markedAt: '2026-08-15 11:20' },
    { id: 'P3009', name: '赵总',   title: '总经理',   decisionRole: 'decision', phoneMasked: '131****5566', companyCount: 1, status: 'active', traitCodes: ['relationship'], personalTags: ['高尔夫'], companyId: 'C2007', markedBy: '郑凯', markedAt: '2026-09-02 09:30' },
    { id: 'P3010', name: '孙经理', title: '采购负责人', decisionRole: 'decision', phoneMasked: '130****7788', companyCount: 1, status: 'active', traitCodes: ['case_oriented'], personalTags: [], companyId: 'C2008', markedBy: '林峰', markedAt: '2026-09-05 17:00' },
    { id: 'P3011', name: '钱英',   title: '人力总监', decisionRole: 'decision', phoneMasked: '159****2211', companyCount: 1, status: 'left',   traitCodes: [], personalTags: [], companyId: 'C2002', markedBy: '张伟', markedAt: '2026-08-28 15:00' }
  ],

  /* 公司画像标签打标记录（G09 出参带打标人留痕） */
  profileMarks: {
    'C2001': [
      { group: 'company_identity_tag', code: 'listed', label: '上市公司', markedByName: '张伟', markedAt: '2026-08-12 14:20' },
      { group: 'company_identity_tag', code: 'local_well_known', label: '本地知名', markedByName: '李娜', markedAt: '2026-08-12 14:20' },
      { group: 'company_policy_tag', code: 'need_bidding', label: '需招投标', markedByName: '张伟', markedAt: '2026-08-12 14:20' },
      { group: 'decision_chain', code: 'long', label: '决策链长（多层评审）', markedByName: '张伟', markedAt: '2026-08-12 14:20' }
    ]
  },

  /* 联系人特质打标记录（G11 出参） */
  traitMarks: {
    'P3001': [
      { code: 'price_sensitive', label: '价格敏感', markedByName: '张伟', markedAt: '2026-09-07 09:15' },
      { code: 'case_oriented', label: '方案型（要案例）', markedByName: '张伟', markedAt: '2026-09-07 09:15' }
    ]
  }
};

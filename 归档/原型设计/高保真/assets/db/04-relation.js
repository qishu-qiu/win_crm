/* ============================================================
 * DB 域 4：业务关系与跟进（relation）
 * 业务关系、跟单记录、预约、公海 —— 关系/预约/公海/工作台数据来源
 * ============================================================ */
window.DB = window.DB || {};
window.DB.relation = {

  /* 业务关系（E01 列表数据源；seaStatus=private 为私海活跃） */
  relations: [
    { id: 'R1001', companyId: 'C2001', companyName: '杭州云启科技有限公司', shortName: '云启科技', productLineId: 1, productLineName: '短视频推广', deptId: 1, deptName: '线上营销一部',
      status: 'intent', stageId: 4, urgency: 'weekly', valueLevel: 'high', riskTags: ['lost_signal'], coopTags: ['need_visit'],
      ownerId: 201, ownerName: '张伟', ownerAv: 'av0', maintainerId: 301, maintainerName: '李娜', maintainerAv: 'av2',
      nextFollowAt: '2026-09-08 10:00', lastFollowAt: '2026-09-05 15:20', valueEstimate: 120000, customerLevel: 'B',
      competitorFlag: false, seaStatus: 'private', crossLineTags: ['已合作 GEO'], grayDays: 0 },
    { id: 'R1002', companyId: 'C2002', companyName: '宁波恒盛机械制造有限公司', shortName: '恒盛机械', productLineId: 3, productLineName: 'GEO', deptId: 1, deptName: '线上营销一部',
      status: 'intent', stageId: 5, urgency: 'weekly', valueLevel: 'high', riskTags: [], coopTags: ['need_proposal'],
      ownerId: 201, ownerName: '张伟', ownerAv: 'av0', maintainerId: 301, maintainerName: '李娜', maintainerAv: 'av2',
      nextFollowAt: '2026-09-07 14:30', lastFollowAt: '2026-09-06 09:10', valueEstimate: 88000, customerLevel: 'B',
      competitorFlag: true, seaStatus: 'private', crossLineTags: [], grayDays: 0 },
    { id: 'R1003', companyId: 'C2003', companyName: '温州嘉和餐饮管理有限公司', shortName: '嘉和餐饮', productLineId: 1, productLineName: '短视频推广', deptId: 1, deptName: '线上营销一部',
      status: 'intent', stageId: 3, urgency: 'monthly', valueLevel: 'medium', riskTags: [], coopTags: [],
      ownerId: 202, ownerName: '王芳', ownerAv: 'av4', maintainerId: 301, maintainerName: '李娜', maintainerAv: 'av2',
      nextFollowAt: '2026-09-10 09:00', lastFollowAt: '2026-09-04 16:40', valueEstimate: 45000, customerLevel: 'C',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 0 },
    { id: 'R1004', companyId: 'C2004', companyName: '绍兴文理教育咨询有限公司', shortName: '文理教育', productLineId: 2, productLineName: '网站建设', deptId: 2, deptName: '线上营销二部',
      status: 'intent', stageId: 2, urgency: 'quarterly', valueLevel: 'pending', riskTags: [], coopTags: [],
      ownerId: 203, ownerName: '刘洋', ownerAv: 'av6', maintainerId: 302, maintainerName: '吴敏', maintainerAv: 'av8',
      nextFollowAt: '2026-09-15 11:00', lastFollowAt: '2026-09-01 10:00', valueEstimate: 30000, customerLevel: 'C',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 0 },
    { id: 'R1005', companyId: 'C2005', companyName: '台州华远进出口贸易有限公司', shortName: '华远进出口', productLineId: 4, productLineName: '财税咨询', deptId: 3, deptName: '财税事业部',
      status: 'intent', stageId: 1, urgency: 'gray', valueLevel: 'pending', riskTags: [], coopTags: [],
      ownerId: 204, ownerName: '陈昊', ownerAv: 'av10', maintainerId: 0, maintainerName: '周雪', maintainerAv: 'av1',
      nextFollowAt: '2026-09-09 15:00', lastFollowAt: '2026-08-20 14:00', valueEstimate: 20000, customerLevel: 'D',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 18 },
    { id: 'R1006', companyId: 'C2006', companyName: '金华启明建筑装饰工程有限公司', shortName: '启明装饰', productLineId: 3, productLineName: 'GEO', deptId: 1, deptName: '线上营销一部',
      status: 'data', stageId: 1, urgency: 'gray', valueLevel: 'pending', riskTags: [], coopTags: [],
      ownerId: 202, ownerName: '王芳', ownerAv: 'av4', maintainerId: 301, maintainerName: '李娜', maintainerAv: 'av2',
      nextFollowAt: '2026-09-08 16:00', lastFollowAt: '2026-08-15 11:20', valueEstimate: 15000, customerLevel: 'D',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 23 },
    { id: 'R1007', companyId: 'C2007', companyName: '嘉兴中远物流有限公司', shortName: '中远物流', productLineId: 5, productLineName: '法律咨询', deptId: 4, deptName: '法律咨询部',
      status: 'intent', stageId: 4, urgency: 'long_term', valueLevel: 'medium', riskTags: ['contact_changed'], coopTags: [],
      ownerId: 205, ownerName: '郑凯', ownerAv: 'av3', maintainerId: 0, maintainerName: '孙倩', maintainerAv: 'av5',
      nextFollowAt: '2026-09-20 10:00', lastFollowAt: '2026-09-02 09:30', valueEstimate: 60000, customerLevel: 'B',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 0 },
    { id: 'R1008', companyId: 'C2008', companyName: '湖州美家家居用品有限公司', shortName: '美家家居', productLineId: 6, productLineName: '房产网', deptId: 5, deptName: '房产事业部',
      status: 'customer', stageId: 6, urgency: 'monthly', valueLevel: 'high', riskTags: ['payment_risk'], coopTags: ['need_tech'],
      ownerId: 206, ownerName: '林峰', ownerAv: 'av7', maintainerId: 0, maintainerName: '何静', maintainerAv: 'av9',
      nextFollowAt: '2026-09-12 14:00', lastFollowAt: '2026-09-05 17:00', valueEstimate: 160000, customerLevel: 'A',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 0 },
    { id: 'R1009', companyId: 'C2009', companyName: '衢州顺风人力资源服务有限公司', shortName: '顺风人力', productLineId: 7, productLineName: '招牌网', deptId: 6, deptName: '招聘事业部',
      status: 'renew', stageId: 6, urgency: 'quarterly', valueLevel: 'low', riskTags: [], coopTags: [],
      ownerId: 207, ownerName: '徐蕾', ownerAv: 'av11', maintainerId: 0, maintainerName: '马涛', maintainerAv: 'av0',
      nextFollowAt: '2026-09-18 09:30', lastFollowAt: '2026-09-03 13:00', valueEstimate: 12000, customerLevel: 'C',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 0 },
    { id: 'R1010', companyId: 'C2010', companyName: '丽水青山农业开发有限公司', shortName: '青山农业', productLineId: 1, productLineName: '短视频推广', deptId: 1, deptName: '线上营销一部',
      status: 'lost', stageId: 4, urgency: 'long_term', valueLevel: 'low', riskTags: ['lost_signal'], coopTags: [],
      ownerId: 202, ownerName: '王芳', ownerAv: 'av4', maintainerId: 301, maintainerName: '李娜', maintainerAv: 'av2',
      nextFollowAt: null, lastFollowAt: '2026-08-10 10:00', valueEstimate: 8000, customerLevel: 'D',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 28, lostReason: '价格原因' },
    { id: 'R1011', companyId: 'C2011', companyName: '义乌小商品城电子商务有限公司', shortName: '义乌电商城', productLineId: 1, productLineName: '短视频推广', deptId: 1, deptName: '线上营销一部',
      status: 'intent', stageId: 2, urgency: 'gray', valueLevel: 'pending', riskTags: ['lost_signal'], coopTags: [],
      ownerId: 0, ownerName: null, ownerAv: null, maintainerId: 0, maintainerName: null, maintainerAv: null,
      nextFollowAt: null, lastFollowAt: '2026-07-28 15:00', valueEstimate: 26000, customerLevel: 'D',
      competitorFlag: false, seaStatus: 'dept_sea', crossLineTags: [], dropDaysLeft: 6, grayDays: 41 },
    { id: 'R1012', companyId: 'C2012', companyName: '舟山渔业集团有限公司', shortName: '舟山渔业', productLineId: 3, productLineName: 'GEO', deptId: 1, deptName: '线上营销一部',
      status: 'intent', stageId: 1, urgency: 'gray', valueLevel: 'pending', riskTags: [], coopTags: [],
      ownerId: 0, ownerName: null, ownerAv: null, maintainerId: 0, maintainerName: null, maintainerAv: null,
      nextFollowAt: null, lastFollowAt: '2026-07-10 11:00', valueEstimate: 34000, customerLevel: 'D',
      competitorFlag: false, seaStatus: 'to_release', crossLineTags: [], dropDaysLeft: 2, grayDays: 59 },
    /* 撞码合并演示：误录公司「云启网络」的关系，与 R1001 同部门同产品线碰撞 → 子合并为分支（mergedInto→R1001，active_key 排除被并分支） */
    { id: 'R1099', companyId: 'C2099', companyName: '杭州云启网络科技有限公司', shortName: '云启网络', productLineId: 1, productLineName: '短视频推广', deptId: 1, deptName: '线上营销一部',
      status: 'intent', stageId: 3, urgency: 'monthly', valueLevel: 'medium', riskTags: [], coopTags: [],
      ownerId: 202, ownerName: '王芳', ownerAv: 'av4', maintainerId: 301, maintainerName: '李娜', maintainerAv: 'av2',
      nextFollowAt: null, lastFollowAt: '2026-08-20 14:30', valueEstimate: 40000, customerLevel: 'C',
      competitorFlag: false, seaStatus: 'private', crossLineTags: [], grayDays: 0,
      mergedInto: 'R1001', mergedAt: '2026-09-10 14:30', mergedFromCompany: '杭州云启网络科技有限公司', mergedOldOwner: '王芳' }
  ],

  /* 跟单记录（时间轴 / 工作台今日记录 / 详情聚合） */
  follows: [
    { id: 'F001', relationId: 'R1001', companyName: '云启科技', contactName: '周敏', method: 'phone', followAt: '2026-09-07 09:20',
      summary: '讲解短视频套餐报价，客户对价格仍有异议，要求提供同行业案例', attitude: 'neutral', progress: 'flat', nextAction: '整理案例后二次跟进', creatorName: '张伟' },
    { id: 'F002', relationId: 'R1002', companyName: '恒盛机械', contactName: '刘建国', method: 'onsite', followAt: '2026-09-06 09:10',
      summary: '面谈 GEO 方案，客户确认预算，要求下周三前出正式报价', attitude: 'positive', progress: 'forward', nextAction: '输出正式报价单', creatorName: '张伟' },
    { id: 'F003', relationId: 'R1003', companyName: '嘉和餐饮', contactName: '陈伟', method: 'wechat', followAt: '2026-09-04 16:40',
      summary: '发送面访邀约，客户同意下周一到店面谈', attitude: 'positive', progress: 'forward', nextAction: '下周一上门演示', creatorName: '王芳' },
    { id: 'F004', relationId: 'R1001', companyName: '云启科技', contactName: '周敏', method: 'wechat', followAt: '2026-09-05 15:20',
      summary: '客户反馈对同行案例的投放效果有顾虑，约见市场部负责人', attitude: 'neutral', progress: 'flat', nextAction: '邀约面访', creatorName: '张伟' },
    { id: 'F005', relationId: 'R1008', companyName: '美家家居', contactName: '孙经理', method: 'phone', followAt: '2026-09-05 17:00',
      summary: '催收回款，客户承诺本周内安排 10 万回款', attitude: 'neutral', progress: 'forward', nextAction: '跟踪回款到账', creatorName: '林峰' },
    { id: 'F006', relationId: 'R1005', companyName: '华远进出口', contactName: '王总', method: 'phone', followAt: '2026-08-20 14:00',
      summary: '初次沟通财税咨询需求，客户表示近期忙、月底再约', attitude: 'neutral', progress: 'flat', nextAction: '月底再次联系', creatorName: '陈昊' },
    /* 以下为「他人在本客户下跟的单」，用于演示跟单聚合的树杈显示（决策 #30） */
    { id: 'F009', relationId: 'R1099', companyName: '云启网络', contactName: '周敏', method: 'phone', followAt: '2026-08-12 11:00',
      summary: '误录入「云启网络」期间的电话沟通，客户咨询短视频投放预算', attitude: 'neutral', progress: 'flat', nextAction: '待补录信用代码', creatorName: '王芳' },
    { id: 'F010', relationId: 'R1099', companyName: '云启网络', contactName: '周敏', method: 'wechat', followAt: '2026-08-20 14:30',
      summary: '发送案例素材；后补录统一信用代码与「云启科技」撞码，触发合并', attitude: 'neutral', progress: 'flat', nextAction: '已并入云启科技', creatorName: '王芳' },
    { id: 'F011', relationId: 'R1001', companyName: '云启科技', contactName: '周敏', method: 'wechat', followAt: '2026-09-06 10:15',
      summary: '协同跟进：补充发送技术接口方案，客户对对接细节有疑问', attitude: 'neutral', progress: 'flat', nextAction: '技术同事答疑', creatorName: '李娜' }
  ],

  /* 预约（预约管理 4 Tab：today/future/expired/unbooked 由 status 派生） */
  appointments: [
    { id: 'A001', relationId: 'R1007', companyName: '中远物流', contactName: '赵总', productLineName: '法律咨询', status: 'intent',
      appointmentAt: '2026-09-07 15:00', note: '沟通法律顾问年费方案', apptStatus: 'today', ownerName: '郑凯' },
    { id: 'A002', relationId: 'R1008', companyName: '美家家居', contactName: '孙经理', productLineName: '房产网', status: 'customer',
      appointmentAt: '2026-09-07 17:30', note: '回款事宜沟通（已逾期 15 天）', apptStatus: 'today', ownerName: '林峰' },
    { id: 'A003', relationId: 'R1003', companyName: '嘉和餐饮', contactName: '陈伟', productLineName: '短视频推广', status: 'intent',
      appointmentAt: '2026-09-08 10:00', note: '上门演示短视频套餐', apptStatus: 'future', ownerName: '王芳' },
    { id: 'A004', relationId: 'R1002', companyName: '恒盛机械', contactName: '刘建国', productLineName: 'GEO', status: 'intent',
      appointmentAt: '2026-09-09 14:00', note: '提交 GEO 方案报价并讲解', apptStatus: 'future', ownerName: '张伟' },
    { id: 'A005', relationId: 'R1001', companyName: '云启科技', contactName: '周敏', productLineName: '短视频推广', status: 'intent',
      appointmentAt: '2026-09-10 09:30', note: '携同行业案例面访', apptStatus: 'future', ownerName: '张伟' },
    { id: 'A006', relationId: 'R1004', companyName: '文理教育', contactName: '孙校长', productLineName: '网站建设', status: 'intent',
      appointmentAt: '2026-08-28 11:00', note: '官网改版需求沟通', apptStatus: 'done', ownerName: '刘洋', followRecordId: 'F000' },
    { id: 'A007', relationId: 'R1006', companyName: '启明装饰', contactName: '李工', productLineName: 'GEO', status: 'data',
      appointmentAt: '2026-08-20 16:00', note: 'GEO 产品介绍（已过期）', apptStatus: 'expired', ownerName: '王芳' },
    { id: 'A008', relationId: 'R1005', companyName: '华远进出口', contactName: '王总', productLineName: '财税咨询', status: 'intent',
      appointmentAt: '2026-08-15 10:00', note: '财税需求初访（客户未赴约）', apptStatus: 'expired', ownerName: '陈昊' }
  ],

  /* 公海（部门公海/系统公海列表：来自 relations 中 seaStatus != private 的关系 + 扩展） */
  seaList: [
    { id: 'R1011', companyId: 'C2011', companyName: '义乌电商城', region: '浙江·金华', scale: '中型', industry: '电商零售',
      contactNameMasked: '刘**', enteredAt: '2026-08-02 10:00', enterReason: '跟进超时', dropDaysLeft: 6, lineTags: ['短视频推广'], ownerName: null },
    { id: 'R1012', companyId: 'C2012', companyName: '舟山渔业', region: '浙江·舟山', scale: '大型', industry: '渔业水产',
      contactNameMasked: '张**', enteredAt: '2026-07-11 09:00', enterReason: '成单超时', dropDaysLeft: 2, lineTags: ['GEO'], ownerName: null },
    { id: 'S001', companyId: 'C2013', companyName: '海宁皮革城品牌运营有限公司', region: '浙江·嘉兴', scale: '大型', industry: '品牌零售',
      contactNameMasked: '王**', enteredAt: '2026-08-25 14:00', enterReason: '进展停滞', dropDaysLeft: 11, lineTags: ['短视频推广'], ownerName: null },
    { id: 'S002', companyId: 'C2014', companyName: '永康五金产业带供应链有限公司', region: '浙江·金华', scale: '中型', industry: '五金制造',
      contactNameMasked: '应**', enteredAt: '2026-09-01 09:30', enterReason: '主动释放', dropDaysLeft: 15, lineTags: ['GEO'], ownerName: null }
  ],

  /* 工作台：今日记录 / 今日预约（与 follows/appointments 同源视图，供列表快速渲染） */
  todayFollows: [
    { id: 'F001', followAt: '09:20', companyName: '云启科技', contactName: '周敏', method: '电话', summary: '讲解短视频套餐报价，客户对价格仍有异议', attitude: 'neutral', progress: 'flat', suggestedStageId: 4, urgency: 'weekly', visitLog: true, visitNo: 'WC2026090503' },
    { id: 'F002', followAt: '10:40', companyName: '恒盛机械', contactName: '刘建国', method: '到访', summary: '面谈 GEO 方案，确认预算，要求下周出报价', attitude: 'positive', progress: 'forward', suggestedStageId: 5, urgency: 'weekly' },
    { id: 'F003', followAt: '14:00', companyName: '嘉和餐饮', contactName: '陈伟', method: '微信', summary: '发送面访邀约，客户同意下周一到店面谈', attitude: 'positive', progress: 'forward', suggestedStageId: 3, urgency: 'monthly' }
  ],
  todayAppointments: [
    { id: 'A001', appointmentAt: '2026-09-07 15:00', companyName: '中远物流', contactName: '赵总', note: '沟通法律顾问年费方案', stageId: 4, urgency: 'long_term', dropDaysLeft: 12, status: 'future' },
    { id: 'A002', appointmentAt: '2026-09-07 17:30', companyName: '美家家居', contactName: '孙经理', note: '回款事宜沟通（已逾期 15 天）', stageId: 6, urgency: 'monthly', dropDaysLeft: 20, status: 'future' },
    { id: 'A000', appointmentAt: '2026-09-06 15:00', companyName: '启明装饰', contactName: '李工', note: 'GEO 产品介绍', stageId: 1, urgency: 'gray', dropDaysLeft: 0, status: 'expired' }
  ],

  /* D1 写跟单 → 建议阶段规则 */
  suggestRules: [
    { method: 'phone', hintText: '电话沟通', suggestedStageId: 1, suggestedStageName: '初步建联' },
    { method: 'onsite', hintText: '当面拜访', suggestedStageId: 3, suggestedStageName: '面访产品讲解' },
    { method: 'objection', hintText: '客户提出疑虑', suggestedStageId: 4, suggestedStageName: '异议与卡点' },
    { method: 'quote', hintText: '已明确报价', suggestedStageId: 5, suggestedStageName: '逼单' }
  ]
};

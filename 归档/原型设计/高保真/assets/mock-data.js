/* ============================================================
 * 销售 CRM 高保真原型 · 数据组装器（V2.5）
 * ------------------------------------------------------------
 * 唯一数据源：assets/db/ 下按域拆分的 DB 文件（01-dict / 02-org /
 * 03-customer / 04-relation / 05-trade），本文件把它们组装成
 * window.CRM.data / window.CRM.h 供各页面统一调用（含历史兼容字段）。
 * 用法：页面按顺序引 01..05 + 本文件（或引 assets/crm-loader.js 单入口）。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============ 0. DB 引导：若 DB 域文件未先加载，则同步注入 ============
   * 设计：任何页面只需 <script src="../assets/mock-data.js"></script>，
   * 本文件会自动按序引入 db/01..05（document.write 同步执行，file:// 可用）。
   * 若页面已显式引过 db 文件（window.DB 已存在）则跳过。 */
  var win = global.window || global; // Node 模拟时 window 可能即 global
  var DB = global.DB = global.DB || {};

  /* 兜底：仅当 DB 域确实缺失时才用 document.write 同步注入（file:// 直开可用）。
   * 正常情况页面已显式引入 db/01..05，不会走这里。 */
  if (!(DB.dict && DB.org && DB.customer && DB.relation && DB.trade)) {
    var doc = win.document;
    if (doc && typeof doc.write === 'function') {
      var cur = doc.currentScript;
      var dir = cur && cur.src ? cur.src.substring(0, cur.src.lastIndexOf('/') + 1) : '../assets/';
      var files = ['db/01-dict.js', 'db/02-org.js', 'db/03-customer.js', 'db/04-relation.js', 'db/05-trade.js'];
      doc.write('<script src="' + dir + files[0] + '"><\/script>' +
        '<script src="' + dir + files[1] + '"><\/script>' +
        '<script src="' + dir + files[2] + '"><\/script>' +
        '<script src="' + dir + files[3] + '"><\/script>' +
        '<script src="' + dir + files[4] + '"><\/script>');
    }
  }
  // 无 DB 时给出明确提示（避免静默白页）
  if (!DB.dict || !DB.org || !DB.customer || !DB.relation || !DB.trade) {
    if (console) console.error('[mock-data] DB 域文件未加载齐全：需依次引入 db/01-dict.js ~ db/05-trade.js');
  }

  /* ---------- 适配：部门（DB 规范结构 → 页面兼容结构） ---------- */
  function adaptDepts() {
    return (DB.org.departments || []).map(function (d) {
      var mgr = null;
      if (d.managerId) {
        var emp = (DB.org.employees || []).filter(function (e) { return e.id === d.managerId; })[0];
        if (emp) mgr = { name: emp.name, av: emp.av, roleCodes: emp.roleCodes };
      } else if (d.manager) {
        mgr = d.manager;
      }
      var plNames = (d.productLineIds || []).map(function (pid) {
        var pl = (DB.org.productLines || []).filter(function (p) { return p.id === pid; })[0];
        return pl ? pl.name : '';
      }).filter(Boolean);
      return {
        id: d.id, name: d.name, parentName: d.parentName,
        productLines: (d.productLines && d.productLines.length ? d.productLines : plNames),
        serviceEnabled: !!d.serviceEnabled, manager: mgr, status: d.status, rule: d.rule || null
      };
    });
  }

  /* ---------- 组装 CRM.data（页面通用字段，含 7 个改造页已用 key） ---------- */
  var data = {
    // 字典域（dict）
    stages: DB.dict.stages, urgency: DB.dict.urgency, valueLevel: DB.dict.valueLevel,
    riskTags: DB.dict.riskTags, coopTags: DB.dict.coopTags,
    companyIdentityTags: DB.dict.companyIdentityTags, companyPolicyTags: DB.dict.companyPolicyTags,
    decisionChain: DB.dict.decisionChain, contactTraits: DB.dict.contactTraits,
    relationStatus: DB.dict.relationStatus, attitude: DB.dict.attitude, progress: DB.dict.progress,
    decisionRole: DB.dict.decisionRole, seaStatus: DB.dict.seaStatus, followMethod: DB.dict.followMethod,
    customerLevels: DB.dict.customerLevels, lostReason: DB.dict.lostReason,
    seaReason: DB.dict.seaReason, approvalType: DB.dict.approvalType, woPriority: DB.dict.woPriority,

    // 组织域（org）
    depts: adaptDepts(),
    departments: DB.org.departments, employees: DB.org.employees,
    productLines: DB.org.productLines, roles: DB.org.roles,
    permissionMatrix: DB.org.permissionMatrix,
    currentUser: DB.org.currentUser || null,

    // 客户域（customer）
    companies: DB.customer.companies, contacts: DB.customer.contacts,
    companyProfile: (function () {
      // 兼容视图：DB 用 *TagCodes，页面用 identityTags/policyTags 数组 + decisionChain/markedBy/markedAt
      var c = (DB.customer.companies || [])[0] || {};
      var marks = (DB.customer.profileMarks || {})[c.id] || [];
      var arr = function (group) { return marks.filter(function (m) { return m.group === group; }).map(function (m) { return m.code; }); };
      var first = marks[0] || {};
      return {
        companyId: c.id, companyName: c.fullName, shortName: c.shortName,
        identityTags: arr('company_identity_tag').length ? arr('company_identity_tag') : (c.identityTagCodes || []),
        policyTags: arr('company_policy_tag').length ? arr('company_policy_tag') : (c.policyTagCodes || []),
        decisionChain: arr('decision_chain').length ? arr('decision_chain')[0] : (c.decisionChain || 'unknown'),
        markedBy: first.markedByName || '张伟',
        markedAt: first.markedAt || '2026-08-12 14:20'
      };
    })(),
    profileMarks: DB.customer.profileMarks, traitMarks: DB.customer.traitMarks,

    // 关系域（relation）
    relations: DB.relation.relations, follows: DB.relation.follows,
    appointments: DB.relation.appointments, seaList: DB.relation.seaList,
    todayFollows: DB.relation.todayFollows, todayAppointments: DB.relation.todayAppointments,
    suggestRules: DB.relation.suggestRules,

    // 交易域（trade）
    dashboard: DB.trade.dashboard, contracts: DB.trade.contracts, payments: DB.trade.payments,
    workorders: DB.trade.workorders, ledger: DB.trade.ledger, approvals: DB.trade.approvals,
    notifications: DB.trade.notifications, funnel: DB.trade.funnel, urgencyStats: DB.trade.urgencyStats,
    grayAlerts: DB.trade.grayAlerts, seaReport: DB.trade.seaReport,
    renewAlerts: DB.trade.renewAlerts, slaStats: DB.trade.slaStats
  };

  /* ---------- 工具函数 ---------- */
  function byCode(list, code) {
    for (var i = 0; i < list.length; i++) { if (list[i].code === code) return list[i]; }
    return null;
  }
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) return list[i]; }
    return null;
  }
  function empById(id) {
    if (!id) return null;
    return byId(data.employees, id);
  }
  function empName(id) { var e = empById(id); return e ? e.name : '—'; }
  function empAv(id) { var e = empById(id); return e ? e.av : 'av0'; }
  function deptName(id) { var d = byId(data.depts, id); return d ? d.name : '—'; }
  function plName(id) { var p = byId(data.productLines, id); return p ? p.name : '—'; }
  function stageName(id) {
    for (var i = 0; i < data.stages.length; i++) { if (data.stages[i].id === id) return data.stages[i].name; }
    return '—';
  }
  function money(n) {
    if (n === null || n === undefined) return '—';
    return '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s); }
  function findRel(id) { return byId(data.relations, id); }
  function findCompany(id) { return byId(data.companies, id); }

  /* ---------- 渲染片段（统一视觉，与 style.css 第 7 节匹配） ---------- */
  function urgencyChip(code) {
    var u = byCode(data.urgency, code) || byCode(data.urgency, 'gray');
    return '<span class="tag-urgency" style="--uc:' + u.color + '">' + esc(u.name) + '</span>';
  }
  function valueChip(code) {
    var v = byCode(data.valueLevel, code);
    if (!v || code === 'pending') return '<span class="tag-value is-empty">待定</span>';
    return '<span class="tag-value" style="--vc:' + v.color + '">' + esc(v.name) + '</span>';
  }
  function riskChips(codes) {
    if (!codes || !codes.length) return '';
    var out = '';
    for (var i = 0; i < codes.length; i++) {
      var r = byCode(data.riskTags, codes[i]);
      if (r) out += '<span class="tag-risk" title="系统自动：' + esc(r.rule || '') + '">⚙ ' + esc(r.name) + '</span>';
    }
    return out;
  }
  function coopChips(codes) {
    if (!codes || !codes.length) return '';
    var out = '';
    for (var i = 0; i < codes.length; i++) {
      var c = byCode(data.coopTags, codes[i]);
      if (c) out += '<span class="tag-coop">' + esc(c.name) + '</span>';
    }
    return out;
  }
  function traitChips(codes) {
    if (!codes || !codes.length) return '';
    var out = '';
    for (var i = 0; i < codes.length; i++) {
      var t = byCode(data.contactTraits, codes[i]);
      if (t) out += '<span class="tag" style="background:#F0F9EB;color:#67C23A">' + esc(t.label) + '</span>';
    }
    return out;
  }
  function statusDot(code) {
    var s = byCode(data.relationStatus, code);
    if (!s) return '';
    return '<span class="status-dot" style="--sc:' + s.color + '"></span>' + esc(s.name);
  }
  function followColumn(rel, withPlus) {
    var html = '<div class="follow-cell">' + urgencyChip(rel.urgency) + valueChip(rel.valueLevel) +
      riskChips(rel.riskTags) + (withPlus ? '<button class="follow-plus" title="打开跟进设置 D18">＋</button>' : '') + '</div>';
    return html;
  }
  function stageSteps(currentId, clickable) {
    var html = '<div class="wf-steps is-6">';
    for (var i = 0; i < data.stages.length; i++) {
      var s = data.stages[i];
      var cls = 'wf-step';
      if (s.id < currentId) cls += ' done';
      if (s.id === currentId) cls += ' current';
      html += '<div class="' + cls + '"' + (clickable ? ' data-stage-id="' + s.id + '"' : '') + '>' +
        '<span class="wf-dot">' + (s.id < currentId ? '✓' : s.id) + '</span>' +
        '<span class="wf-name">' + esc(s.name) + '</span></div>';
    }
    return html + '</div>';
  }
  function personChipHtml(name, av, roleCls, roleName) {
    if (!name) return '<span class="text-sub">—</span>';
    return '<span class="person-chip mini"><i class="pc-avatar ' + (av || 'av0') + '">' + esc(name.charAt(0)) + '</i>' +
      '<span class="pc-name">' + esc(name) + '</span>' +
      (roleName ? '<span class="pc-role ' + (roleCls || '') + '">' + roleName + '</span>' : '') + '</span>';
  }

  /* ---------- 便捷取数：rel/company/emp 封装 ---------- */
  function rel(id) { return findRel(id); }
  function company(id) { return findCompany(id); }
  function emp(id) { return empById(id); }

  global.CRM = {
    data: data,
    db: DB,
    h: {
      byCode: byCode, byId: byId, esc: esc, money: money,
      stageName: stageName, empName: empName, empAv: empAv, deptName: deptName, plName: plName,
      urgencyChip: urgencyChip, valueChip: valueChip, riskChips: riskChips, coopChips: coopChips,
      traitChips: traitChips, statusDot: statusDot, followColumn: followColumn,
      stageSteps: stageSteps, personChip: personChipHtml
    },
    rel: rel, company: company, emp: emp
  };
})(window);

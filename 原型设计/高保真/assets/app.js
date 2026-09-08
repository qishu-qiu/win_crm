/* ============================================================
 * 销售 CRM 高保真原型 · 全局交互脚本（V3.1 全站可点击）
 * ------------------------------------------------------------
 * 1) 侧边栏子菜单可折叠（状态持久化 + 当前页自动展开）
 * 2) 顶部居中快捷入口（可个性化，配置存 localStorage）
 * 3) 弹窗统一开合：data-dialog="id" 打开 / [data-close] 关闭
 * 4) 通用点击委托：行操作按钮（写跟进/改期/完成/新增预约/详情/转交…）
 *    与无绑定按钮 → 打开对应弹窗 / 跳转页面 / 演示 toast（不再"点了没反应"）
 * 5) 数据兜底：页面内嵌 CRM 渲染失败时不白屏
 * 仅用于静态原型演示，不依赖任何框架。
 * ============================================================ */
(function () {
  'use strict';

  /* ============ 工具：toast / 弹窗 / 跳转 ============ */
  function toast(msg, type) {
    var t = document.getElementById('crm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'crm-toast';
      t.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'background:#303133;color:#fff;font-size:13px;padding:8px 16px;border-radius:4px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:70%;display:none';
      document.body.appendChild(t);
    }
    t.innerHTML = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.display = 'none'; }, 2600);
  }
  window.__toast = toast;

  function openDialog(id) {
    var m = document.getElementById(id);
    if (!m) { toast('演示环境：暂未找到弹窗 ' + id); return false; }
    m.style.display = 'flex';
    return true;
  }
  window.__openDialog = openDialog;

  function closeDialog(m) { if (m && m.id !== 'dialog-block') m.style.display = 'none'; }

  function goto(url) {
    if (url && url !== '#' && url !== '') {
      location.href = url;
    } else { toast('演示环境：此处为占位跳转'); }
  }
  window.__goto = goto;

  /* ---------- 通用弹窗构造器（全局可用，解决"点了没反应"） ---------- */
  function esc(s) {
    var E = window.CRM && window.CRM.h && window.CRM.h.esc;
    return E ? E(s) : String(s == null ? '' : s);
  }
  function optHtml(arr, sel) {
    return (arr || []).map(function (x) {
      var v = x.code != null ? x.code : x.name;
      var n = x.name != null ? x.name : x.label;
      return '<option value="' + esc(v) + '"' + (sel && sel == v ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }
  function modal(id, title, bodyHtml, okText, onOk) {
    var old = document.getElementById(id);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var mask = document.createElement('div');
    mask.className = 'dialog-mask';
    mask.id = id;
    mask.innerHTML = '<div class="dialog" style="width:640px">' +
      '<div class="dialog-head">' + title + '<span class="close" data-mclose style="cursor:pointer">✕</span></div>' +
      '<div class="dialog-body">' + bodyHtml + '</div>' +
      '<div class="dialog-foot"><button class="btn" data-mclose>取 消</button>' +
      '<button class="btn btn-primary" data-mok>' + (okText || '确 定') + '</button></div>' +
      '</div>';
    mask.style.display = 'flex';
    document.body.appendChild(mask);
    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    mask.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t === mask) { close(); return; }
      if (!t.hasAttribute) return;
      if (t.hasAttribute('data-mclose')) { close(); return; }
      if (t.hasAttribute('data-mok')) {
        var keep = onOk ? onOk(mask) : false;
        if (keep !== true) close();
      }
    });
    return mask;
  }
  window.__modal = modal;

  /* ---------- D1 写跟进（全局版：页面无自带弹窗时使用） ---------- */
  function openFollowDialog(rel) {
    var D = (window.CRM && window.CRM.data) || {};
    var rels = D.relations || [];
    var methods = D.followMethods || D.methods || [
      { code: 'phone', name: '电话' }, { code: 'wechat', name: '微信' },
      { code: 'visit', name: '上门拜访' }, { code: 'online', name: '线上会议' }
    ];
    var attitudes = D.attitudes || [
      { code: 'positive', name: '积极' }, { code: 'neutral', name: '中性' }, { code: 'wait', name: '观望' }
    ];
    var progresses = D.progresses || [
      { code: 'contact', name: '初步接触' }, { code: 'sent', name: '资料已送达' },
      { code: 'confirmed', name: '需求已确认' }, { code: 'price', name: '价格谈判中' }
    ];
    var body = '' +
      '<div class="form-item"><label>业务关系</label><select class="input" id="fd-rel" style="flex:1">' +
      rels.map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (rel && rel.id === r.id ? ' selected' : '') + '>' +
          esc(r.companyName) + ' · ' + esc(r.productLineName || '') + '</option>';
      }).join('') + '</select></div>' +
      '<div class="form-item"><label>跟进方式</label><select class="input" id="fd-method" style="flex:1">' + optHtml(methods) + '</select></div>' +
      '<div class="form-item"><label>跟进内容</label><textarea class="input" id="fd-summary" rows="3" style="flex:1" placeholder="本次沟通要点…"></textarea></div>' +
      '<div class="form-item"><label>客户态度</label><select class="input" id="fd-att" style="flex:1">' + optHtml(attitudes) + '</select></div>' +
      '<div class="form-item"><label>跟进进展</label><select class="input" id="fd-prog" style="flex:1">' + optHtml(progresses) + '</select></div>' +
      '<div class="form-item"><label>下次跟进</label><input class="input" type="date" id="fd-next" style="flex:1"></div>' +
      '<div class="text-sub fs12 mt8">提示：提交后系统按「跟进方式 → 建议阶段」规则给出建议阶段，确认即推进（留痕）。</div>';
    modal('g-dialog-follow', '📝 填写跟单记录', body, '提交跟进', function (m) {
      var s = m.querySelector('#fd-summary');
      if (!s || !s.value.trim()) { toast('请填写跟进内容'); return true; }
      toast('✓ 跟进记录已提交（演示）· 建议阶段已生成，可在详情页确认');
    });
  }

  /* ---------- 外出登记（全局版） ---------- */
  function openOutingDialog() {
    var D = (window.CRM && window.CRM.data) || {};
    var rels = D.relations || [];
    var body = '' +
      '<div class="form-item"><label>外出类型</label><select class="input" id="od-type" style="flex:1">' +
      '<option value="visit">客户拜访</option><option value="sign">签约/收款</option>' +
      '<option value="market">市场调研</option><option value="other">其他</option></select></div>' +
      '<div class="form-item"><label>关联客户</label><select class="input" id="od-rel" style="flex:1">' +
      rels.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.companyName) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-item"><label>外出事由</label><textarea class="input" id="od-note" rows="2" style="flex:1" placeholder="例：上门拜访，沟通年度套餐报价"></textarea></div>' +
      '<div class="form-item"><label>出发时间</label><input class="input" type="datetime-local" id="od-start" style="flex:1"></div>' +
      '<div class="form-item"><label>预计返回</label><input class="input" type="datetime-local" id="od-end" style="flex:1"></div>' +
      '<div class="text-sub fs12 mt8">提示：外出登记将同步至工作台「外出中」状态条与考勤统计。</div>';
    modal('g-dialog-outing', '🚗 外出登记', body, '提交登记', function (m) {
      var n = m.querySelector('#od-note');
      if (!n || !n.value.trim()) { toast('请填写外出事由'); return true; }
      toast('✓ 外出登记已提交（演示）· 状态已同步工作台');
    });
  }

  /* ---------- 通用列表筛选（查询/重置，覆盖多数列表页） ---------- */
  function filterTable(mode) {
    var bar = document.querySelector('.filter-bar') || document.querySelector('.toolbar');
    var scope = document.querySelector('.table');
    var isCard = false;
    if (!scope) { scope = document.querySelector('.card-list'); isCard = !!scope; }
    if (!scope) { toast('演示环境：' + (mode === 'reset' ? '已重置' : '查询') + '（本页无列表，原型演示）'); return; }
    if (mode === 'reset') {
      if (bar) Array.prototype.forEach.call(bar.querySelectorAll('input,select'), function (el) { el.value = ''; });
      var all = scope.querySelectorAll(isCard ? '.card' : 'tbody tr');
      Array.prototype.forEach.call(all, function (n) { n.style.display = ''; });
      toast('已重置筛选，显示全部 ' + all.length + ' 条');
      return;
    }
    var conds = [];
    if (bar) Array.prototype.forEach.call(bar.querySelectorAll('input,select'), function (el) {
      var v = (el.value || '').trim(); if (v) conds.push(v.toLowerCase());
    });
    var nodes = scope.querySelectorAll(isCard ? '.card' : 'tbody tr');
    var shown = 0;
    Array.prototype.forEach.call(nodes, function (n) {
      if (isCard && !n.textContent.trim()) return;
      var text = n.textContent.toLowerCase();
      var ok = conds.every(function (c) { return text.indexOf(c) >= 0; });
      n.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    toast('查询完成：命中 ' + shown + ' / ' + nodes.length + ' 条');
  }

  /* ---------- 导出当前表格为 CSV（合同/工单/台账等） ---------- */
  function exportTable() {
    var table = document.querySelector('.table');
    if (!table) { toast('演示环境：导出（本页无表格）'); return; }
    var csv = '';
    Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
      if (tr.style.display === 'none') return;
      var cells = tr.querySelectorAll('th,td');
      var line = Array.prototype.map.call(cells, function (c) {
        var t = (c.textContent || '').replace(/\s+/g, ' ').trim().replace(/"/g, '""');
        return '"' + t + '"';
      }).join(',');
      csv += line + '\n';
    });
    try {
      var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (document.title || 'export') + '.csv';
      a.click();
      toast('✓ 已导出当前表格（' + table.querySelectorAll('tbody tr').length + ' 行）');
    } catch (e) { toast('演示环境：导出（浏览器限制，原型演示）'); }
  }

  /* ---------- 通用表单弹窗（新增/编辑/补全/申请变更） ---------- */
  function openGenericForm(act, relName) {
    var map = { '新增': '🆕 新增', '新建': '🆕 新建', '添加': '➕ 添加', '编辑': '✏️ 编辑',
                '补全': '📝 补全', '去补全': '📝 补全', '申请变更': '🔄 申请变更' };
    var title = '演示表单';
    for (var k in map) { if (act.indexOf(k) >= 0) { title = map[k]; break; } }
    var name = relName || '';
    var body = '';
    if (name) body += '<div class="form-item"><label>对象</label><div class="text-sub">' + esc(name) + '</div></div>';
    body += '<div class="form-item"><label>名称</label><input class="input" id="gf-name" value="' + esc(name) + '" style="flex:1" placeholder="请输入名称"></div>';
    body += '<div class="form-item"><label>备注</label><textarea class="input" id="gf-note" rows="3" style="flex:1" placeholder="补充信息…"></textarea></div>';
    body += '<div class="text-sub fs12 mt8">提示：提交后演示写入（不落库）；真实系统将走对应接口与审批流。</div>';
    modal('g-dialog-generic', title, body, '保 存', function () {
      toast('✓ ' + title.replace(/[🆕➕✏️📝🔄\s]/g, '') + ' 已提交（演示）');
    });
  }

  /* ---------- 侧边栏按角色收起（销售视角减负；管理员看全） ---------- */
  function applyRoleMenu() {
    var C = window.CRM; if (!C || !C.data || !C.data.currentUser) return;
    var rc = C.data.currentUser.roleCodes || [];
    var ADMIN_ROLES = ['gm', 'admin', 'dept_manager', 'manager', 'boss'];
    var isAdmin = rc.some(function (r) { return ADMIN_ROLES.indexOf(r) >= 0; });
    if (isAdmin) return; // 管理员/经理看全部菜单
    var ADMIN = ['org-employee', 'org-department', 'org-role', 'org-permission', 'product-line',
                 'setting-sea-rule', 'setting-workflow', 'setting-dict', 'setting-tag',
                 'ledger', 'report', 'advanced-search', 'data-center'];
    Array.prototype.forEach.call(document.querySelectorAll('.menu-item'), function (a) {
      var h = a.getAttribute('href') || '';
      var base = h.split('/').pop();
      if (ADMIN.indexOf(base) >= 0) a.style.display = 'none';
    });
    // 收起变空的子菜单组
    Array.prototype.forEach.call(document.querySelectorAll('.menu-group'), function (g) {
      var items = g.querySelectorAll('.menu-item');
      var visible = Array.prototype.filter.call(items, function (i) { return i.style.display !== 'none'; });
      if (items.length && visible.length === 0) {
        var head = g.querySelector('.menu-item.has-sub') || g.querySelector('.menu-item');
        if (head) head.style.display = 'none';
        g.style.display = 'none';
      }
    });
  }

  /* ---------- 顶栏身份预览切换（总经理/经理/销售） ---------- */
  var ROLE_SWITCH_KEY = 'crm_role_view_v1';
  function applySavedRole() {
    try {
      var r = localStorage.getItem(ROLE_SWITCH_KEY);
      if (r && window.CRM && window.CRM.data && window.CRM.data.currentUser) {
        var rc = r === 'sale' ? ['sale'] : r === 'manager' ? ['dept_manager'] : ['gm'];
        window.CRM.data.currentUser.roleCodes = rc;
        window.CRM.data.currentUser.roleName = r === 'sale' ? '销售' : r === 'manager' ? '部门经理' : '总经理';
      }
    } catch (e) {}
  }
  function markActiveRole(role) {
    Array.prototype.forEach.call(document.querySelectorAll('.rs-btn'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-role') === role);
    });
  }
  function injectRoleSwitch() {
    var tb = document.querySelector('.topbar');
    if (!tb || document.getElementById('role-switch')) return;
    var wrap = document.createElement('span');
    wrap.id = 'role-switch'; wrap.className = 'role-switch';
    wrap.innerHTML = '<span class="rs-label">视角</span>' +
      '<button class="rs-btn" data-role="gm">总经理</button>' +
      '<button class="rs-btn" data-role="manager">经理</button>' +
      '<button class="rs-btn" data-role="sale">销售</button>';
    var bell = tb.querySelector('.bell');
    tb.insertBefore(wrap, bell);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('.rs-btn'); if (!b) return;
      var role = b.getAttribute('data-role');
      try { localStorage.setItem(ROLE_SWITCH_KEY, role); } catch (e2) {}
      var rc = role === 'sale' ? ['sale'] : role === 'manager' ? ['dept_manager'] : ['gm'];
      window.CRM.data.currentUser.roleCodes = rc;
      window.CRM.data.currentUser.roleName = role === 'sale' ? '销售' : role === 'manager' ? '部门经理' : '总经理';
      renderTopbarUser();
      Array.prototype.forEach.call(document.querySelectorAll('.menu-item'), function (a) { a.style.display = ''; });
      Array.prototype.forEach.call(document.querySelectorAll('.menu-group'), function (g) { g.style.display = ''; var h = g.querySelector('.menu-item.has-sub'); if (h) h.style.display = ''; });
      applyRoleMenu();
      markActiveRole(role);
      toast('已切换为' + (role === 'sale' ? '销售' : role === 'manager' ? '经理' : '总经理') + '视角');
    });
    markActiveRole(localStorage.getItem(ROLE_SWITCH_KEY) || 'gm');
  }

  /* ---------- 快捷动作分发：同一动作在不同页面行为一致 ---------- */
  function quickAction(act, item) {
    if (act === 'follow') {
      if (typeof window.openD1 === 'function') { window.openD1(); return; }
      openFollowDialog();
    } else if (act === 'outing') {
      openOutingDialog();
    } else if (act === 'appt') {
      if (typeof window.openQuickAppt === 'function') { window.openQuickAppt(); return; }
      goto('appointment.html');
    } else if (item && item.href) {
      goto(item.href);
    } else {
      toast('演示环境：该功能暂未开放');
    }
  }
  window.__quickAction = quickAction;

  /* 从 CRM 数据取关系/公司（行数据可能没带 id，用名称反查兜底） */
  function matchRelByText(text) {
    var C = window.CRM;
    if (!C || !C.data || !C.data.relations) return null;
    var hit = null;
    C.data.relations.forEach(function (r) {
      if (!hit && text && r.companyName && r.companyName.indexOf(text) >= 0) hit = r;
    });
    return hit;
  }

  /* ============ 1. 侧边栏折叠（保留原逻辑） ============ */
  var FOLD_KEY = 'crm_menu_fold_v1';
  var foldState = {};
  try { foldState = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch (e) { foldState = {}; }
  var cur = (location.pathname.split('/').pop() || 'index.html');

  Array.prototype.forEach.call(document.querySelectorAll('.menu-group'), function (g) {
    var parent = g.querySelector('.menu-item');
    var sub = g.querySelector('.menu-sub');
    if (!parent || !sub) return;
    parent.classList.add('has-sub');
    if (!parent.querySelector('.menu-arrow')) {
      var arrow = document.createElement('span');
      arrow.className = 'menu-arrow';
      arrow.textContent = '▾';
      parent.appendChild(arrow);
    }
    var name = (parent.textContent || '').replace(/[▾▸\s]/g, '') || ('g' + idx());
    var inGroup = !!sub.querySelector('.menu-item.active');
    var collapsed = inGroup ? false : (foldState[name] !== undefined ? foldState[name] : true);
    g.classList.toggle('collapsed', collapsed);
    parent.setAttribute('title', collapsed ? '展开子菜单' : '收起子菜单');
    parent.addEventListener('click', function (ev) {
      var willCollapse = !g.classList.contains('collapsed');
      g.classList.toggle('collapsed', willCollapse);
      foldState[name] = willCollapse;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(foldState)); } catch (e) {}
      if (willCollapse || !parent.getAttribute('href') || parent.getAttribute('href') === '#') ev.preventDefault();
    });
  });
  var _gi = 0; function idx() { return _gi++; }

  /* ============ 2. 顶部快捷入口 ============ */
  var QK_KEY = 'crm_quick_v1';
  var LIBRARY = [
    { id: 'follow',  icon: '📝', text: '写跟进',   href: 'workbench.html', act: 'follow' },
    { id: 'appt',    icon: '📅', text: '新增预约', href: 'appointment.html', act: 'appt' },
    { id: 'visit',   icon: '🚗', text: '外出登记', href: '', act: 'outing' },
    { id: 'entry',   icon: '➕', text: '录入客户', href: 'entry.html' },
    { id: 'sea',     icon: '🌊', text: '公海领取', href: 'sea.html' },
    { id: 'contract',icon: '📄', text: '新建合同', href: 'contract-create.html' },
    { id: 'wo',      icon: '🎫', text: '新建工单', href: 'workorder-list.html' },
    { id: 'approval',icon: '✅', text: '待我审批', href: 'approval.html' },
    { id: 'search',  icon: '🔍', text: '高级搜索', href: 'advanced-search.html' },
    { id: 'report',  icon: '📈', text: '报表分析', href: 'report.html' }
  ];
  var DEFAULT_IDS = ['follow', 'appt', 'visit', 'entry', 'sea'];
  var ids = null;
  try { ids = JSON.parse(localStorage.getItem(QK_KEY) || 'null'); } catch (e) {}
  if (!ids || !ids.length) ids = DEFAULT_IDS;
  var bar = document.querySelector('.quick-bar');
  if (bar) {
    bar.innerHTML = '';
    ids.map(function (id) { return LIBRARY.filter(function (x) { return x.id === id; })[0]; })
      .filter(Boolean).forEach(function (item) {
        var a = document.createElement('a');
        a.className = 'qb-item';
        if (item.act) {
          a.href = 'javascript:void 0';
          a.addEventListener('click', function (ev) { ev.preventDefault(); quickAction(item.act, item); });
        } else {
          a.href = item.href || 'javascript:void 0';
        }
        a.innerHTML = '<span class="qb-icon">' + item.icon + '</span>' + item.text;
        bar.appendChild(a);
      });
    var sep = document.createElement('span'); sep.className = 'qb-sep'; bar.appendChild(sep);
    var set = document.createElement('a');
    set.className = 'qb-set'; set.href = 'profile.html'; set.textContent = '⚙';
    set.title = '个性化快捷入口（最多 6 个）';
    bar.appendChild(set);
  }

  /* ============ 3. 弹窗统一开关 ============ */
  // [data-close] 关闭；点击遮罩空白关闭（原逻辑保留 + 委托兜底）
  function bindMask(m) {
    m.addEventListener('click', function (e) {
      if (e.target === m && m.id !== 'dialog-block') m.style.display = 'none';
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.dialog-mask'), bindMask);

  /* ============ 4. 全局点击委托（全站按钮可点） ============ */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,button,.btn,[data-dialog],[data-jump],[data-toast],[data-close],[data-action]') : null;
    if (!el) return;

    // 4.1 弹窗关闭按钮优先
    if (el.hasAttribute('data-close')) {
      var m1 = el.closest('.dialog-mask');
      if (m1) { m1.style.display = 'none'; }
      return;
    }
    // 4.2 显式 data-dialog → 打开
    if (el.hasAttribute('data-dialog')) {
      e.preventDefault();
      openDialog(el.getAttribute('data-dialog'));
      return;
    }
    // 4.3 显式 data-jump → 跳转
    if (el.hasAttribute('data-jump')) {
      e.preventDefault();
      goto(el.getAttribute('data-jump'));
      return;
    }
    // 4.4 显式 data-toast → 提示
    if (el.hasAttribute('data-toast')) {
      e.preventDefault();
      toast(el.getAttribute('data-toast'));
      return;
    }

    // 4.5 显式 data-action（页面自定义：快捷预约/部门规则等已有处理，缺省给 toast）
    if (el.hasAttribute('data-action')) {
      var act = el.getAttribute('data-action');
      if (act === 'quick-appointment') { e.preventDefault(); openDialog('dialog-quick-appt'); return; }
      if (act === 'dept-rule') { e.preventDefault(); return; } // org-department 页自己接管
      return; // 其它 data-action 留给页面脚本
    }

    // 4.6 有 href 的真实链接（非 #）→ 不拦截
    var href = el.getAttribute && el.getAttribute('href');
    if (href && href !== '#' && href !== '' && !el.hasAttribute('data-prevent')) return;

    // 4.7 文本语义匹配（行操作按钮，页面未显式绑定时兜底）
    e.preventDefault();
    var txt = (el.textContent || '').trim();
    var tr = el.closest('tr');
    var firstCell = tr ? (tr.querySelector('td,th') ? tr.querySelector('td,th').textContent.trim() : '') : '';
    var relName = firstCell && firstCell.length < 30 ? firstCell : '';

    // 4.7a 取消按钮：关闭最近弹窗（兜底未标 data-close 的情况）
    if (txt === '取消' || txt === '取 消') {
      var dmCancel = el.closest('.dialog-mask');
      if (dmCancel && dmCancel.id !== 'dialog-block') { dmCancel.style.display = 'none'; return; }
      toast('已取消'); return;
    }

    if (txt.indexOf('写跟进') >= 0 || txt === '跟进') {
      // 页面有 D1 弹窗 → 打开；否则跳工作台
      if (document.getElementById('d1')) { openDialog('d1'); }
      else if (document.getElementById('dialog-follow')) { openDialog('dialog-follow'); }
      else { goto('workbench.html'); }
      return;
    }
    if (txt.indexOf('新增预约') >= 0 || txt === '预约' || txt.indexOf('快捷预约') >= 0) {
      if (document.getElementById('dialog-quick-appt')) { openDialog('dialog-quick-appt'); }
      else if (document.getElementById('dialog-appt')) { openDialog('dialog-appt'); }
      else { toast('演示环境：新增预约（应打开快捷预约弹窗）'); }
      return;
    }
    if (txt.indexOf('改期') >= 0) {
      if (document.getElementById('dialog-reschedule')) openDialog('dialog-reschedule');
      else if (document.getElementById('dialog-appt-edit')) openDialog('dialog-appt-edit');
      else toast('演示环境：改期已提交（留痕：原时间 → 新时间）');
      return;
    }
    if (txt.indexOf('完成预约') >= 0 || txt.indexOf('完成') >= 0) {
      toast('演示环境：完成预约成功 → 自动打开写跟进弹窗形成闭环');
      if (document.getElementById('d1')) setTimeout(function () { openDialog('d1'); }, 600);
      return;
    }
    if (txt.indexOf('详情') >= 0 || txt.indexOf('查看') >= 0) {
      var rel = matchRelByText(relName);
      goto('relation-detail.html' + (rel ? '?id=' + rel.id : ''));
      return;
    }
    if (txt.indexOf('转交') >= 0) {
      if (document.getElementById('dialog-transfer')) openDialog('dialog-transfer');
      else toast('演示环境：转交（生成审批单，需经理审批）');
      return;
    }
    if (txt.indexOf('创建合同') >= 0) { goto('contract-create.html'); return; }
    if (txt.indexOf('创建工单') >= 0) { goto('workorder-list.html'); return; }
    if (txt.indexOf('外出登记') >= 0 || txt.indexOf('外勤') >= 0) {
      if (document.getElementById('dialog-visit')) openDialog('dialog-visit');
      else toast('演示环境：外出登记');
      return;
    }
    if (txt.indexOf('领') >= 0 && txt.indexOf('公海') >= 0) { toast('演示环境：领取成功 → 已加入我的业务关系'); return; }
    if (txt.indexOf('激活') >= 0) { toast('演示环境：激活成功（激活竞态保护：他人已激活将提示归属人）'); return; }
    if (txt.indexOf('保存') >= 0 || txt.indexOf('提交') >= 0 || txt.indexOf('确认') >= 0) {
      toast('演示环境：已保存 ✓（不落库，原型演示）');
      return;
    }
    if (txt.indexOf('删除') >= 0 || txt.indexOf('停用') >= 0) { toast('演示环境：该操作需二次确认（原型演示未执行）'); return; }
    // 4.8 列表/表单类通用动作（把"弱响应"升级为真动作）
    if (txt.indexOf('查询') >= 0 || txt.indexOf('筛选') >= 0 || txt.indexOf('搜索') >= 0) { filterTable('query'); return; }
    if (txt.indexOf('重置') >= 0) { filterTable('reset'); return; }
    if (txt.indexOf('打印') >= 0) { window.print(); toast('已调用打印（演示）'); return; }
    if (txt.indexOf('导出') >= 0 || txt.indexOf('导 Excel') >= 0) { exportTable(); return; }
    if (txt.indexOf('恢复默认') >= 0) {
      try { localStorage.removeItem('crm_quick_v1'); } catch (e) {}
      toast('已恢复默认快捷入口'); setTimeout(function () { location.reload(); }, 800); return;
    }
    if (txt.indexOf('解析规则') >= 0) {
      modal('g-dialog-parse', '⚙ 规则解析', '<div class="text-sub">演示：当前公海规则表达式已解析为「掉公海天数 = N，释放阈值 = M」，真实系统将据此自动计算并触发预警。</div>', '知道了');
      return;
    }
    if (txt.indexOf('开始处理') >= 0 || txt.indexOf('处理工单') >= 0) {
      modal('g-dialog-wo', '▶ 开始处理工单',
        '<div class="form-item"><label>处理说明</label><textarea class="input" id="wo-note" rows="3" style="flex:1" placeholder="填写处理动作与预计完成时间…"></textarea></div>' +
        '<div class="text-sub fs12 mt8">提交后工单状态变更为「处理中」，并通知发起人。</div>',
        '开始处理', function () { toast('✓ 工单已开始处理（演示）'); });
      return;
    }
    if (txt.indexOf('升级为商机') >= 0) {
      modal('g-dialog-up', '⬆ 升级为商机工单',
        '<div class="text-sub">演示：当前工单将升级为「商机工单」并转交对应业务线负责人跟进；真实系统按规则路由。</div>',
        '确认升级', function () { toast('✓ 已升级为商机工单（演示）'); });
      return;
    }
    if (txt.indexOf('关闭工单') >= 0) {
      modal('g-dialog-close', '✕ 关闭工单',
        '<div class="form-item"><label>关闭原因</label><textarea class="input" id="wo-close" rows="3" style="flex:1" placeholder="填写关闭原因（如已解决 / 转其他）…"></textarea></div>' +
        '<div class="text-sub fs12 mt8">关闭后工单归档，可再次打开查看。</div>',
        '确认关闭', function () { toast('✓ 工单已关闭（演示）'); });
      return;
    }
    if (txt.indexOf('新增') >= 0 || txt.indexOf('新建') >= 0 || txt.indexOf('添加') >= 0 ||
        txt.indexOf('编辑') >= 0 || txt.indexOf('补全') >= 0 || txt.indexOf('去补全') >= 0 ||
        txt.indexOf('申请变更') >= 0) { openGenericForm(txt, relName); return; }
    // 兜底
    toast('演示环境：' + (txt || '该操作') + ' 已响应');
  });

  /* ============ 5. 标签选择器（原逻辑） ============ */
  Array.prototype.forEach.call(document.querySelectorAll('.tag-picker[data-single] .tag-opt'), function (opt) {
    opt.addEventListener('click', function () {
      var wrap = opt.closest('.tp-opts');
      Array.prototype.forEach.call(wrap.querySelectorAll('.tag-opt'), function (o) { o.classList.remove('sel'); });
      opt.classList.add('sel');
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tag-picker:not([data-single]) .tag-opt'), function (opt) {
    opt.addEventListener('click', function () { opt.classList.toggle('sel'); });
  });
  /* ============ 6. 顶栏登录人统一渲染（全站数据一致） ============ */
  /* 登录人角色文案：兼容 roleName / roleNames / roleCodes 三种写法 */
  function roleLabel(u) {
    if (!u) return '';
    if (u.roleName) return u.roleName;
    if (u.roleNames && u.roleNames.length) return u.roleNames.join('/');
    var R = (window.CRM && window.CRM.data && window.CRM.data.roles) || [];
    return (u.roleCodes || []).map(function (c) {
      var hit = null;
      R.forEach(function (r) { if (!hit && r.code === c) hit = r; });
      return hit ? hit.name : c;
    }).join('/');
  }

  function renderTopbarUser() {
    var C = window.CRM;
    if (!C || !C.data || !C.data.currentUser) return;
    var u = C.data.currentUser;
    // 顶栏用户名：通常 <span class="user"><span class="avatar">X</span>姓名</span>
    var userEls = document.querySelectorAll('.topbar .user');
    Array.prototype.forEach.call(userEls, function (el) {
      var av = el.querySelector('.avatar');
      if (av) av.textContent = (u.name || '?').charAt(0);
      // 保留姓名 span 或整块替换文本（保留结构以免样式失效）
      var roleTxt = roleLabel(u);
      var label = u.name + (roleTxt ? ' · ' + roleTxt : '');
      var nm = el.querySelector('.user-name');
      if (nm) nm.textContent = label;
      else {
        // 无内部结构：保留头像节点，替换其后文本节点
        var nodes = el.childNodes;
        Array.prototype.forEach.call(nodes, function (n) {
          if (n.nodeType === 3 && n.textContent.trim()) n.textContent = ' ' + label;
        });
      }
    });
    // 顶栏日期（如有）
    var dateEls = document.querySelectorAll('.topbar [data-date], .topbar .date');
    Array.prototype.forEach.call(dateEls, function (el) {
      var d = new Date();
      var pad = function (x) { return x < 10 ? '0' + x : '' + x; };
      el.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    });
  }
  applySavedRole();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderTopbarUser(); applyRoleMenu(); injectRoleSwitch(); });
  } else {
    renderTopbarUser();
    applyRoleMenu();
    injectRoleSwitch();
  }
})();

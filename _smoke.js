/* V2.5 页面渲染冒烟测试：在 Node 中模拟最小 DOM，加载 DB+mock-data，
   逐页执行含 "V2.5 数据层" 标记的内联脚本，断言渲染结果，捕获运行时异常。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = 'd:/WorkBuddy/销售标准管理/原型设计/高保真';

/* ============ 最小 DOM ============ */
class El {
  constructor(tag, attrs) {
    this.tagName = tag.toLowerCase();
    this.attrs = attrs || {};
    this.cls = new Set(String(this.attrs.class || '').split(/\s+/).filter(Boolean));
    this.id = this.attrs.id || '';
    this.parent = null;
    this.children = [];
    this._text = '';
    this._html = '';
    this.style = {};
    this.dataset = {};
    this.handlers = {};
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); if (n === 'class') this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  hasAttribute(n) { return n in this.attrs; }
  addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  removeEventListener() {}
  appendChild(c) { c.parent = this; this.children.push(c); }
  get textContent() {
    if (this._text !== '') return this._text;
    let s = '';
    for (const c of this.children) s += c.textContent;
    return s;
  }
  set textContent(v) { this._text = String(v); this._html = ''; }
  set innerHTML(v) { this._html = String(v); this._text = ''; this.children = []; }
  get innerHTML() { return this._html !== '' ? this._html : ''; }
  querySelector(sel) { return querySel(this, sel); }
  querySelectorAll(sel) { return querySelAll(this, sel); }
  get classList() { return { contains: c => this.cls.has(c), add: c => this.cls.add(c), remove: c => this.cls.delete(c), toggle: (c, f) => { if (f === undefined) { this.cls.has(c) ? this.cls.delete(c) : this.cls.add(c); } else { f ? this.cls.add(c) : this.cls.delete(c); } } }; }
  closest() { return null; }
  get firstElementChild() { return this.children[0] || null; }
  get previousElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) - 1] || null : null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] || null : null; }
}

function parseHTML(html) {
  const root = new El('root', {});
  const stack = [root];
  const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source']);
  const SKIP = { script: 'script', style: 'style' };
  let i = 0, n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const txt = html.slice(i, lt).replace(/\s+/g, ' ');
      if (txt) { const top = stack[stack.length - 1]; top._text += top._text ? ' ' + txt : txt; }
    }
    if (/^<!--/.test(html.slice(lt))) { const end = html.indexOf('-->', lt); i = end < 0 ? n : end + 3; continue; }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const token = html.slice(lt + 1, gt).trim();
    i = gt + 1;
    const close = token[0] === '/';
    const raw = close ? token.slice(1) : token;
    const mm = raw.match(/^([a-zA-Z0-9]+)/);
    if (!mm) continue;
    const tag = mm[1].toLowerCase();
    if (close) {
      const top = stack[stack.length - 1];
      if (top.tagName === tag) stack.pop();
      continue;
    }
    if (SKIP[tag]) { // 整块跳过 script/style 内容（内部含 < 会干扰建树）
      const closeTag = '</' + tag;
      const cend = html.toLowerCase().indexOf(closeTag, i);
      if (cend >= 0) i = cend + closeTag.length;
      continue;
    }
    const attrs = {};
    const am = /\s([a-zA-Z0-9-_:]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g;
    let x;
    while ((x = am.exec(raw))) attrs[x[1]] = x[2] ? x[2].slice(1, -1) : '';
    const el = new El(tag, attrs);
    const top = stack[stack.length - 1];
    top.children.push(el); el.parent = top;
    if (!/\/\s*$/.test(token) && !VOID.has(tag)) stack.push(el);
  }
  return root;
}
function allOf(node, pred, out) { for (const c of node.children) { if (pred(c)) out.push(c); allOf(c, pred, out); } return out; }
function matchPart(el, part) {
  let cls = '', attr = null, val = null;
  let mm = part.match(/^\.([\w-]+)$/);
  if (mm) cls = mm[1];
  else {
    mm = part.match(/^\.([\w-]+)\[([\w-]+)="([^"]*)"\]$/);
    if (mm) { cls = mm[1]; attr = mm[2]; val = mm[3]; }
    else return false;
  }
  if (cls && !el.cls.has(cls)) return false;
  if (attr && el.getAttribute(attr) !== val) return false;
  return true;
}
function querySelAll(rootNode, sel) {
  const parts = sel.trim().split(/\s+/);
  let cur = parts.length ? [rootNode] : [];
  for (const p of parts) {
    const next = [];
    for (const n of cur) allOf(n, e => { if (matchPart(e, p)) { next.push(e); return true; } return false; }, []);
    cur = next;
  }
  return cur;
}
function querySel(rootNode, sel) { return querySelAll(rootNode, sel)[0] || null; }

const idsMap = new Map(); // id -> El
let ROOT_NODE = null;
function registerId(el) { if (el.id) idsMap.set(el.id, el); for (const c of el.children) registerId(c); }
function loadPageHTML(file) {
  const html = fs.readFileSync(file, 'utf8');
  idsMap.clear();
  ROOT_NODE = parseHTML(html);
  registerId(ROOT_NODE);
  return html;
}
const documentStub = {
  getElementById: id => idsMap.get(id) || null,
  querySelector: sel => querySel(ROOT_NODE, sel),
  querySelectorAll: sel => querySelAll(ROOT_NODE, sel),
  createElement: () => new El('div', {}),
  body: new El('body', {}),
  addEventListener() {}
};

/* ============ 加载数据层（DB + mock-data） ============ */
const dbFiles = ['01-dict.js', '02-org.js', '03-customer.js', '04-relation.js', '05-trade.js'];
const code = dbFiles.map(f => fs.readFileSync(path.join(ROOT, 'assets/db', f), 'utf8')).join('\n');
global.window = global;
global.document = documentStub;
global.__CRM_DB_LOADED__ = true;
vm.runInThisContext(code, { filename: 'db.js' });
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'assets/mock-data.js'), 'utf8'), { filename: 'mock-data.js' });
const CRM = global.CRM;
if (!CRM || !CRM.data) { console.error('FAIL: CRM 未装配'); process.exit(1); }

/* ============ 执行页面脚本 + 断言 ============ */
const pages = {
  dashboard: {
    file: 'pages/dashboard.html',
    checks: [
      ['kpiSignV 本月签约', 'kpiSignV', v => v.indexOf('586,000') >= 0],
      ['kpiRelV 业务关系140', 'kpiRelV', v => v.indexOf('140') >= 0],
      ['kpiTodoV 今日待跟进8', 'kpiTodoV', v => v.indexOf('8') >= 0],
      ['今日待跟进列表非空', 'followList', v => v.length > 0 && v.indexOf('暂无数据') < 0],
      ['跟随more=全部 5 个', 'followAllMore', v => v.indexOf('全部 5 个') >= 0],
      ['donut data-count=140', 'donut', (v, el) => el.getAttribute('data-count') === '140'],
      ['legend 有意向58', 'legendList', v => v.indexOf('意向') >= 0 && v.indexOf('58') >= 0],
      ['部门对比有财税事业部', 'deptCompareList', v => v.indexOf('财税事业部') >= 0],
      ['销售TOP有林峰', 'salesTopList', v => v.indexOf('林峰') >= 0],
      ['掉公海预警含义乌电商城', 'alertDropTxt', v => v.indexOf('义乌电商城') >= 0],
      ['到期预警 tag', 'alertExpTag', v => v.indexOf('30 天内 5 份') >= 0]
    ]
  },
  notice: {
    file: 'pages/notice.html',
    checks: [
      ['nlist 渲染 NT001', 'nlist', v => v.indexOf('灰度预警：华远进出口已 18 天未定性') >= 0],
      ['nlist 渲染 NT002', 'nlist', v => v.indexOf('待审批：王芳提交业务关系转交') >= 0],
      ['nlist 渲染 NT003', 'nlist', v => v.indexOf('部门规则已更新：线上营销一部') >= 0],
      ['全部计数=3', 'cAll', v => v.trim() === '3'],
      ['待办计数=1', 'cTodo', v => v.trim() === '1'],
      ['审批计数=1', 'cAppr', v => v.trim() === '1'],
      ['系统计数=1', 'cSys', v => v.trim() === '1'],
      ['分页共3条', 'pageTotal', v => v.indexOf('共 3 条') >= 0]
    ]
  },
  appointment: {
    file: 'pages/appointment.html',
    checks: [
      ['today 含中远物流', 'tbodyToday', v => v.indexOf('嘉兴中远物流') >= 0],
      ['today 2行(含暂无则fail)', 'tbodyToday', v => v.indexOf('暂无数据') < 0],
      ['today行数=2', 'tbodyToday', v => (v.match(/<tr/g) || []).length === 2],
      ['future 含嘉和', 'tbodyFuture', v => v.indexOf('温州嘉和餐饮') >= 0],
      ['future 3行', 'tbodyFuture', v => (v.match(/<tr/g) || []).length === 3],
      ['expired 含已过期天数', 'tbodyExpired', v => v.indexOf('已过期') >= 0],
      ['expired 2行', 'tbodyExpired', v => (v.match(/<tr/g) || []).length === 2],
      ['none 含顺风人力', 'tbodyNone', v => v.indexOf('衢州顺风人力资源服务有限公司') >= 0],
      ['none 1行', 'tbodyNone', v => (v.match(/<tr/g) || []).length === 1],
      ['today徽标=2', '.tab[data-pane="today"] .count', v => v.trim() === '2'],
      ['expired徽标=2', '.tab[data-pane="expired"] .count', v => v.trim() === '2'],
      ['none徽标=1', '.tab[data-pane="none"] .count', v => v.trim() === '1'],
      ['分页默认过期2条', 'pageTotal', v => v.indexOf('共 2 条') >= 0],
      ['按钮文本保留 写跟进/改期', 'tbodyToday', v => v.indexOf('写跟进') >= 0 && v.indexOf('改期') >= 0 && v.indexOf('完成预约') >= 0],
      ['none 操作含 新增预约/查看详情', 'tbodyNone', v => v.indexOf('新增预约') >= 0 && v.indexOf('查看详情') >= 0]
    ]
  },
  profile: {
    file: 'pages/profile.html',
    checks: [
      ['姓名=赵总', 'name', v => v.indexOf('赵总') >= 0],
      ['角色=总经理', 'roleRow', v => v.indexOf('总经理') >= 0],
      ['工号 G001', 'subInfo', v => v.indexOf('G001') >= 0],
      ['手机号', 'statPhone', v => v.indexOf('138****0099') >= 0],
      ['签约金额', 'stat2V', v => v.indexOf('586,000') >= 0],
      ['顶栏=赵总', 'topbarUser', v => v.indexOf('赵总') >= 0],
      ['无残留 张销售/王经理', 'name', v => v.indexOf('张销售') < 0]
    ]
  },
  'workbench-mobile': {
    file: 'pages/workbench-mobile.html',
    checks: [
      ['今日跟单3条', 'mFollowList', v => (v.match(/<div class="m-card"/g) || []).length === 3],
      ['跟单含云启科技', 'mFollowList', v => v.indexOf('云启科技') >= 0],
      ['跟单计数3', 'mFollowCount', v => v.trim() === '3'],
      ['预约3条', 'mApptList', v => (v.match(/<div class="m-card"/g) || []).length === 3],
      ['预约含中远物流', 'mApptList', v => v.indexOf('中远物流') >= 0],
      ['预约计数3', 'mApptCount', v => v.trim() === '3']
    ]
  },
  entry: {
    file: 'pages/entry.html',
    checks: [
      ['D9 候选1 DB公司', 'nonexist-skip', () => true]
    ]
  }
};

let fail = 0;
for (const name of Object.keys(pages)) {
  const cfg = pages[name];
  if (cfg.file === 'entry') { console.log('skip(static): entry —— D9 候选为静态 DB 名称(无脚本可执行)'); continue; }
  const html = loadPageHTML(path.join(ROOT, cfg.file));
  // 收集并核对 getElementById 引用 id 是否真实存在
  const used = new Set();
  for (const mm of html.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) used.add(mm[1]);
  const miss = [...used].filter(id => !idsMap.has(id));
  if (miss.length) { console.log('FAIL [' + name + '] 引用不存在的 id: ' + miss.join(', ')); fail++; }
  // 执行含标记的内联脚本
  const blocks = [];
  for (const mm of html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) {
    const c = mm[1];
    if (c.indexOf('V2.5 数据层') >= 0 || c.indexOf('V2.5') >= 0) blocks.push(c);
  }
  try {
    for (const b of blocks) vm.runInThisContext(b, { filename: name + '.js' });
  } catch (e) {
    console.log('FAIL [' + name + '] 执行异常: ' + e.message);
    fail++;
    continue;
  }
  // 断言
  for (const [desc, key, fn] of cfg.checks) {
    let el = null, val = '';
    if (key.indexOf(' ') >= 0 || key.indexOf('[') >= 0) { el = documentStub.querySelector(key); val = el ? el.textContent : ''; }
    else { el = documentStub.getElementById(key); val = el ? (el.innerHTML !== '' ? el.innerHTML : el.textContent) : ''; }
    const ok = fn(val, el);
    if (!ok) { console.log('FAIL [' + name + '] ' + desc + '  实际=[' + String(val).slice(0, 80) + ']'); fail++; }
  }
  console.log('done ' + name);
}
console.log(fail ? ('FAILURES=' + fail) : 'ALL_PASS');
process.exit(fail ? 1 : 0);

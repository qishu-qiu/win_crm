// =============================================================================
// B3-5 真库实测：签约校验清单硬卡（一次性探针 · Node）
//
// 为什么用 Node 而不是 .ps1：本机 PowerShell 5.1 按 GBK 解析 .ps1，UTF-8 中文注释会乱码
//   并直接语法报错（同工作区的 `M8-05-反面用例-CLI试用.ps1` 是 GBK 才躲得过）。
//   Node 24 自带 fetch ＋ UTF-8 一致，两边都不会骗人。
//
// 验什么（→《AI执行清单》#16/#28：单测全绿 ≠ 真链路对）：
//   ① 缺项时 `POST /contracts` 确实 **422 / 20403**，且响应体带 `missing[]`（前端标红靠它）；
//   ② 补齐后同一请求**建得起来**（否则就是"一建就 422"的假闭环）。
//
// 运行（先起服务）：
//   cd 服务端; npm run build; node dist/main.js
//   node ../过程产出/B3-5-签约校验实测.mjs
//
// 收尾：本脚本**不删任何业务数据**（审计表禁删，→ 001 种子文件头）；
//   成功建出来的合同请手工清理，脚本会打印删除 SQL。
// =============================================================================
const BASE = process.env.BASE ?? 'http://localhost:3000';
const ACCOUNT = process.env.ACCOUNT ?? '13800000001';
const PASSWORD = process.env.PASSWORD ?? 'Dev@123456';
const MYSQL = 'D:\\ITtool\\phpstudy_pro\\Extensions\\MySQL8.0.12\\bin\\mysql.exe';

import { execFileSync } from 'node:child_process';

const say = (...args) => console.log(...args);

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

function sql(statement) {
  return execFileSync(MYSQL, ['-uroot', '-p123456', '--default-character-set=utf8mb4', 'win_crm', '-e', statement], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ---------- 1) 登录 ----------
const login = await api('/account/login', { method: 'POST', body: { account: ACCOUNT, password: PASSWORD } });
if (login.json?.code !== 0) {
  say('✘ 登录失败：', JSON.stringify(login.json));
  process.exit(1);
}
const token = login.json.data.access_token;
say(`登录 OK：account=${ACCOUNT}`);

// ---------- 2) 挑一条我可见的私海关系（**且公司已有在职联系人**，以便第 5 步能验"建得起来"） ----------
const rel = await api('/relations?page=1&page_size=50', { token });
const candidates = (rel.json?.data?.list ?? []).filter((r) => r.product_line != null && r.sea_status === 'private');
let target;
let current;
for (const candidate of candidates) {
  const contacts = await api(`/companies/${candidate.company?.id}/contacts?page=1&page_size=20`, { token });
  const hit = (contacts.json?.data?.list ?? []).find((c) => c.is_current === true);
  if (hit !== undefined) {
    target = candidate;
    current = hit;
    break;
  }
}
if (target === undefined) {
  say('⚠ 我的私海里没有「公司已有在职联系人」的关系，两步都验不了（需先造数据）');
  say('   可退而求其次：只看第 ① 步的 422 拦截是否正确。');
  process.exit(2);
}
say(`目标关系：id=${target.id} 公司=${target.company?.name} 产品线=${target.product_line?.name} 在职联系人=${current.name}`);
const createBody = { relation_id: String(target.id), amount: '10000.00' };

// ---------- 3) 建合同：应 422 / 20403 + missing[] ----------
const blocked = await api('/contracts', { method: 'POST', token, body: createBody });
if (blocked.status === 200) {
  say('★ 意外成功（校验没生效）：contract_no=', blocked.json?.data?.contract_no);
  say(`  收尾 SQL：DELETE FROM contract WHERE contract_no='${blocked.json?.data?.contract_no}';`);
  process.exit(3);
}
const missing = blocked.json?.data?.missing ?? [];
say(`① 缺项拦截：HTTP=${blocked.status} code=${blocked.json?.code} message=${blocked.json?.message}`);
if (blocked.json?.code !== 20403 || missing.length === 0) {
  say('✘ 不是 20403 或没有 missing[]（前端无法标红）');
  process.exit(4);
}
for (const item of missing) say(`     - [${item.goto}] ${item.scope}/${item.field_key} = ${item.label}`);

// ---------- 4) 补齐：company 四项走 SQL（IFNULL 不覆盖已有）＋ 关系项走 HTTP ----------
// ⚠ `credit_code` 带 `uk_credit_code` 唯一索引 ⇒ 固定值可能撞已存在的档案（1062）；
//   故用 `CONCAT(..., id)` 生成**按公司唯一**的占位码，IFNULL 保证不覆盖已有值。
sql(
  `UPDATE company SET credit_code=IFNULL(credit_code, CONCAT('91310000MA1FL9', LPAD(id,7,'0'))),` +
    ` address=IFNULL(address,'上海市浦东新区测试路1号'), industry_l1=IFNULL(industry_l1,'软件服务'),` +
    ` province=IFNULL(province,'上海市') WHERE id=(SELECT company_id FROM business_relation WHERE id=${target.id});`,
);
say('② 公司层四项已补（IFNULL，不覆盖已有值）');

if (target.value_tier == null) {
  // 值域 high/medium/low/pending（→ C1 ＋ dict `value_tier`）；传字典外的值会被 DTO 卡 400/20001
  const put = await api(`/relations/${target.id}`, { method: 'PUT', token, body: { value_tier: 'high' } });
  say(`   开发价值已标：code=${put.json?.code} message=${put.json?.message ?? ''}`);
}

// 联系人项：第 2 步已挑「有在职联系人」的关系，这里只复核一次（E8 原口径 `company_contact.is_current=1`）
say(`   在职联系人已存在：${current.name}`);

// ---------- 5) 再建一次 ----------
const again = await api('/contracts', { method: 'POST', token, body: createBody });
if (again.status === 200) {
  say(`★ 补齐后建单成功：contract_no=${again.json?.data?.contract_no}（闭环成立）`);
  say(`  收尾 SQL：DELETE FROM contract WHERE contract_no='${again.json?.data?.contract_no}';`);
  process.exit(0);
}
const still = again.json?.data?.missing ?? [];
say(`补齐后仍被拦：HTTP=${again.status} code=${again.json?.code} message=${again.json?.message}`);
for (const item of still) say(`     余缺 [${item.goto}] ${item.scope}/${item.field_key} = ${item.label}`);
say('（余缺若只剩 contact，说明该公司确实没有签约联系人 —— 不是校验的 bug）');
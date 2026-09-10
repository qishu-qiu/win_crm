/* 冒烟2：完成预约闭环 / 客户自动带入 / 空内容拦截 / 建议阶段随方式变化 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.resolve(__dirname, '../原型设计/高保真');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function load(rel) {
  const file = path.join(ROOT, rel);
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const dom = await JSDOM.fromFile(file, {
    runScripts: 'dangerously', resources: 'usable',
    url: 'file:///' + file.replace(/\\/g, '/'), virtualConsole: vc, pretendToBeVisual: true
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  await sleep(400);
  return dom;
}
function byText(txt) {
  return Array.from(document.querySelectorAll('a,button,.btn')).find(e => (e.textContent || '').trim().indexOf(txt) >= 0);
}
function click(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

(async () => {
  const R = [];

  // ① 完成预约 → 自动打开写跟进
  {
    const dom = await load('pages/appointment.html'); const w = dom.window; global.document = w.document;
    const el = byText('完成预约');
    click(w, el); await sleep(900);
    const g = w.document.getElementById('g-dialog-follow');
    R.push(['完成预约→弹写跟进', !!(g && g.style.display !== 'none')]);
    dom.window.close();
  }

  // ② 客户自动带入：点第 N 行的写跟进，看选中项是否为该行公司
  {
    const dom = await load('pages/relation-list.html'); const w = dom.window; global.document = w.document;
    const btns = Array.from(w.document.querySelectorAll('a.btn-text')).filter(e => (e.textContent || '').trim() === '写跟进');
    const b = btns[2] || btns[0];
    const rowCompany = (b.closest('tr').querySelector('.cell-main,td') || {}).textContent || '';
    click(w, b); await sleep(200);
    const g = w.document.getElementById('g-dialog-follow');
    const sel = g && g.querySelector('#fd-rel');
    const picked = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
    const hit = picked && rowCompany.trim() && picked.indexOf(rowCompany.trim().slice(0, 3)) >= 0;
    R.push(['客户自动带入(' + rowCompany.trim().slice(0, 6) + '→' + picked.slice(0, 10) + ')', !!hit]);
    dom.window.close();
  }

  // ③ 空摘要提交：应被拦截（弹窗不关闭 + 提示）
  {
    const dom = await load('pages/dashboard.html'); const w = dom.window; global.document = w.document;
    click(w, byText('写跟进')); await sleep(200);
    const g = w.document.getElementById('g-dialog-follow');
    const ok = g.querySelector('[data-mok]');
    click(w, ok); await sleep(200);
    const still = w.document.getElementById('g-dialog-follow');
    const tip = (w.document.getElementById('crm-toast') || {}).textContent || '';
    R.push(['空内容被拦截', !!(still && still.style.display !== 'none')]);
    R.push(['给出必填提示', /摘要|不能为空/.test(tip)]);
    // 填内容后再提交 → 通过
    g.querySelector('#fd-summary').value = '电话沟通，客户确认需求';
    click(w, ok); await sleep(200);
    R.push(['填写后提交成功', !w.document.getElementById('g-dialog-follow')]);
    dom.window.close();
  }

  // ④ 建议阶段随「跟进方式」变化（选「报价」→ 逼单）
  {
    const dom = await load('pages/dashboard.html'); const w = dom.window; global.document = w.document;
    click(w, byText('写跟进')); await sleep(200);
    const g = w.document.getElementById('g-dialog-follow');
    const before = (g.querySelector('#fd-suggest') || {}).textContent || '';
    const chip = Array.from(g.querySelectorAll('.radio-chip')).find(c => /报价/.test(c.textContent));
    click(w, chip); await sleep(150);
    const after = (g.querySelector('#fd-suggest') || {}).textContent || '';
    R.push(['方式=电话建议初步建联', /初步建联/.test(before)]);
    R.push(['方式=报价建议逼单', /逼单/.test(after)]);
    dom.window.close();
  }

  let fail = 0;
  R.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok ? '✅' : '❌'), n); });
  console.log('\nRESULT fail=' + fail);
  process.exit(fail ? 1 : 0);
})();

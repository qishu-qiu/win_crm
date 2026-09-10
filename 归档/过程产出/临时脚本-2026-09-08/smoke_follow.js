/* 冒烟：全站「写跟进」必须就地弹窗，且不得跳转工作台 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../原型设计/高保真');
const PAGES = [
  { f: 'pages/dashboard.html', click: () => findBtn('写跟进') },
  { f: 'pages/appointment.html', click: () => findBtn('写跟进') },
  { f: 'pages/relation-list.html', click: () => findBtn('写跟进') },
  { f: 'pages/relation-detail.html', click: () => findBtn('写跟进') },
  { f: 'pages/workbench.html', click: () => findBtn('📝') }
];

function findBtn(txt) {
  const all = Array.from(document.querySelectorAll('a,button,.btn,[data-dialog]'));
  return all.find(e => (e.textContent || '').trim().indexOf(txt) >= 0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  for (const p of PAGES) {
    const file = path.join(ROOT, p.f);
    const vc = new VirtualConsole();
    vc.on('jsdomError', () => {});
    const dom = await JSDOM.fromFile(file, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'file:///' + file.replace(/\\/g, '/'),
      virtualConsole: vc,
      pretendToBeVisual: true
    });
    const { window } = dom;
    await new Promise(r => window.addEventListener('load', r));
    await sleep(400);

    global.document = window.document;
    const el = p.click.call(window);
    const out = { page: p.f, found: !!el };
    if (el) {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(200);
      const g = window.document.getElementById('g-dialog-follow');
      const d1 = window.document.getElementById('d1');
      const shown = m => m && m.style.display !== 'none';
      out.popup = shown(g) ? 'global-D1' : shown(d1) ? 'page-D1' : 'NONE';
      if (out.popup !== 'NONE') {
        const m = shown(g) ? g : d1;
        out.hasSummary = /跟单摘要|跟进内容|沟通要点/.test(m.textContent);
        out.hasMethod = /跟进方式/.test(m.textContent);
        out.width = (m.querySelector('.dialog') || {}).style ? (m.querySelector('.dialog').style.width || '-') : '-';
      }
      out.stayed = !/workbench/.test(window.location.href) || p.f.indexOf('workbench') >= 0;
    }
    // 工作台额外校验：建议阶段是否真的匹配上（中文→code 映射修复）
    if (p.f.indexOf('workbench') >= 0) {
      const nm = window.document.getElementById('suggestStageName');
      out.suggest = nm ? nm.textContent.trim() : 'N/A';
    }
    const ok = out.found && out.popup !== 'NONE' && out.hasSummary && out.stayed;
    ok ? pass++ : fail++;
    console.log((ok ? '✅' : '❌'), JSON.stringify(out));
    dom.window.close();
  }
  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();

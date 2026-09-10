/* 全站死按钮扫描：逐页点击每个可见交互元素，断言"有响应"
   响应定义 = 弹出弹窗 / 出现 toast / 触发跳转 / DOM 发生变化 / 页面脚本已接管(onclick) */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.resolve(__dirname, '../原型设计/高保真/pages');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function visible(el) {
  let n = el;
  while (n && n.style) {
    if (n.style && n.style.display === 'none') return false;
    n = n.parentElement;
  }
  return true;
}

(async () => {
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
  let dead = 0, clicked = 0;
  const report = [];
  for (const f of files) {
    const file = path.join(ROOT, f);
    let nav = false;
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (/navigation/i.test(e.message)) nav = true; });
    const dom = await JSDOM.fromFile(file, {
      runScripts: 'dangerously', resources: 'usable',
      url: 'file:///' + file.replace(/\\/g, '/'), virtualConsole: vc, pretendToBeVisual: true
    });
    const w = dom.window;
    await new Promise(r => w.addEventListener('load', r));
    await sleep(300);
    global.document = w.document;

    const SEL = 'a,button,.btn,[data-dialog],[data-jump],[data-toast],[data-close],[data-action]';
    const list = () => Array.from(w.document.querySelectorAll(SEL)).filter(e => visible(e) && (e.textContent || '').trim());
    const n = list().length;
    const deadHere = [];
    for (let i = 0; i < n; i++) {
      const el = list()[i];           // 每次重新取：表格重渲染后旧节点会脱离文档
      if (!el) continue;
      const t = (el.textContent || '').trim().slice(0, 12);
      const hasOnclick = el.hasAttribute('onclick');
      const href = el.getAttribute ? el.getAttribute('href') : null;
      const isLink = !!href && href !== '#' && href.indexOf('javascript:') !== 0 && href.trim() !== '';
      const visCount = () => Array.from(w.document.querySelectorAll('*')).filter(visible).length;
      const before = {
        dlg: Array.from(w.document.querySelectorAll('.dialog-mask')).filter(d => d.style.display !== 'none').length,
        toast: (w.document.getElementById('crm-toast') || {}).style ? w.document.getElementById('crm-toast').style.display : 'none',
        toastTxt: (w.document.getElementById('crm-toast') || {}).textContent || '',
        html: w.document.body.innerHTML.length,
        vis: visCount()
      };
      nav = false;
      try { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
      await sleep(30);
      const tt = w.document.getElementById('crm-toast');
      const after = {
        dlg: Array.from(w.document.querySelectorAll('.dialog-mask')).filter(d => d.style.display !== 'none').length,
        toast: tt ? tt.style.display : 'none',
        toastTxt: tt ? tt.textContent : '',
        html: w.document.body.innerHTML.length,
        vis: visCount()
      };
      // 响应 = 跳转(真实链接) / 页面 onclick 接管 / 弹窗打开 / toast 变化 / DOM 可见元素数或内容变化
      const responded = nav || hasOnclick || isLink ||
        after.dlg > before.dlg ||
        (after.toast === 'block' && after.toastTxt !== before.toastTxt) ||
        after.vis !== before.vis ||
        after.html !== before.html;
      clicked++;
      if (!responded) deadHere.push(t);
      // 关掉可能打开的弹窗，避免影响后续点击
      Array.from(w.document.querySelectorAll('.dialog-mask')).forEach(d => { d.style.display = 'none'; });
    }
    if (deadHere.length) { dead += deadHere.length; report.push(`❌ ${f}: ${deadHere.join(' | ')}`); }
    else report.push(`✅ ${f} (${n} 个元素均有响应)`);
    dom.window.close();
  }
  console.log(report.join('\n'));
  console.log(`\n点击总数=${clicked}  无响应=${dead}`);
})();

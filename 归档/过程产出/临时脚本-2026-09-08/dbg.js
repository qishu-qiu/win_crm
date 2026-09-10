const path=require('path');const {JSDOM,VirtualConsole}=require('jsdom');
const ROOT=path.resolve(__dirname,'../原型设计/高保真');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const file=path.join(ROOT,'pages/dashboard.html');const vc=new VirtualConsole();vc.on('jsdomError',e=>console.log('ERR',e.message));
 const dom=await JSDOM.fromFile(file,{runScripts:'dangerously',resources:'usable',url:'file:///'+file.replace(/\\/g,'/'),virtualConsole:vc,pretendToBeVisual:true});
 await new Promise(r=>dom.window.addEventListener('load',r));await sleep(400);
 const w=dom.window;global.document=w.document;
 const b=Array.from(w.document.querySelectorAll('a,button,.btn')).find(e=>(e.textContent||'').trim().indexOf('写跟进')>=0);
 b.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await sleep(200);
 const g=w.document.getElementById('g-dialog-follow');
 console.log('dialog?',!!g,'display',g&&g.style.display);
 const ok=g.querySelector('[data-mok]');console.log('ok btn?',!!ok,ok&&ok.textContent);
 ok.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await sleep(300);
 const t=w.document.getElementById('crm-toast');
 console.log('toast exists?',!!t,'display',t&&t.style.display,'text=',t&&JSON.stringify(t.textContent));
 console.log('dialog still?',!!w.document.getElementById('g-dialog-follow'));
})();

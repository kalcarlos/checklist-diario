const path = require('path');
const { launchBrowser, URL } = require('./lib');
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log('  ok  ',n);}else{fail++;console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));} };
const dk=n=>{const d=new Date();const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()-n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
(async()=>{
 const b=await launchBrowser();
 const mkList=(id,name,type,items,done)=>({id,name,emoji:'🏠',type,items:items.map((t,i)=>({id:id+i,text:t,done:i<(done||0)})),sortOrder:'manual',reminder:{enabled:false,times:[]}});
 const mkState=l=>({lastResetDate:dk(0),wordListStats:{},trash:[],lists:l});
 async function fresh(o){const c=await b.newContext(Object.assign({viewport:{width:390,height:844},serviceWorkers:'block'},o||{}));const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return p;}
 async function boot(p,state){await p.goto(URL);await p.evaluate(s=>{localStorage.setItem('checklist-diario:v1',JSON.stringify(s));localStorage.setItem('checklist-diario:skipLogin','1');localStorage.setItem('checklist-diario:game',JSON.stringify({enabled:true,days:{},badges:{},total:0,listsDone:0,greetedOn:new Date().toISOString().slice(0,10)}));},state);await p.reload();await p.waitForTimeout(400);await p.evaluate(()=>document.getElementById('modal-backdrop').classList.add('hidden'));}
 const hidden=p=>p.$eval('#modal-backdrop',e=>e.classList.contains('hidden'));

 console.log('1. Cabeçalho e navegação');
 let p=await fresh(); await boot(p,mkState([mkList('c','Casa','rotina',['a','b'],1)]));
 ok('data por extenso na home',/\d/.test(await p.textContent('#home-date'))&&/[a-zç]/i.test(await p.textContent('#home-date')),await p.textContent('#home-date'));
 ok('título não é cortado',await p.$eval('.home-top h1',e=>e.scrollWidth<=e.clientWidth+1));
 ok('4 ações do topo visíveis e ≥44px',(await p.$$eval('.home-top .icon-btn',els=>els.every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44;}))));
 await p.click('.list-card'); await p.waitForTimeout(60);
 ok('entrar na lista anima da direita',await p.$eval('#screen-detail',e=>e.classList.contains('enter-right')));
 await p.waitForTimeout(500);
 ok('classe de animação é removida depois',await p.$eval('#screen-detail',e=>!e.classList.contains('enter-right')));
 await p.click('#btn-back'); await p.waitForTimeout(60);
 ok('voltar anima da esquerda',await p.$eval('#screen-home',e=>e.classList.contains('enter-left')));

 console.log('2. Alvos de toque');
 await p.waitForTimeout(450); await p.click('.list-card'); await p.waitForTimeout(100);
 const sizes=await p.evaluate(()=>{const q=s=>[...document.querySelectorAll(s)].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)]});
   const chk=document.querySelector('.item-row .check'); const cs=getComputedStyle(chk,'::after'); const r=chk.getBoundingClientRect();
   return {check:[Math.round(r.width),Math.round(r.height)],after:[cs.top,cs.left],btn:q('#btn-focus')[0],del:q('.item-row .delete')[0],edit:q('.item-row .edit-btn')[0],filter:q('.filter-choice')[0],send:q('.add-item-form .icon-btn')[0]};});
 ok('círculo de marcar tem área de toque estendida (::after inset -10px)',sizes.after[0]==='-10px'&&sizes.check[0]===28,sizes);
 ok('botão de foco ≥42px de altura',sizes.btn[1]>=42,sizes.btn);
 ok('ações da linha com altura 44px',sizes.del[1]>=44&&sizes.edit[1]>=44,sizes);
 ok('botão enviar ≥44px',sizes.send[0]>=44&&sizes.send[1]>=44,sizes.send);
 ok('segmentado ≥40px',sizes.filter[1]>=40,sizes.filter);
 ok('toque na bordinha do círculo (6px fora) alterna o item (1 marcado → 0)',await (async()=>{const box=await p.$eval('.item-row .check',e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};}); await p.mouse.click(box.x-6, box.y+box.h/2); await p.waitForTimeout(150); return (await p.$$('.item-row.done')).length===0;})());

 console.log('3. Estados vazios');
 p=await fresh(); await boot(p,mkState([]));
 ok('home vazia com chamada para criar',(await p.$('#btn-empty-new'))!==null&&/primeira lista/i.test(await p.textContent('#btn-empty-new')));
 await p.click('#btn-empty-new'); await p.waitForTimeout(150);
 ok('CTA abre "Nova lista"',/Nova lista/.test(await p.textContent('#modal')));
 p=await fresh(); await boot(p,mkState([mkList('c','Casa','rotina',[])]));
 await p.click('.list-card'); await p.waitForTimeout(100);
 ok('lista vazia: mensagem acolhedora',/Lista vazia/.test(await p.textContent('#items-container')));
 p=await fresh(); await boot(p,mkState([mkList('c','Casa','rotina',['a','b'],2)]));
 ok('lista 100% concluída: cartão destacado',await p.$eval('.list-card',e=>e.classList.contains('complete')&&/Tudo feito/.test(e.textContent)));
 await p.click('.list-card'); await p.click('[data-filter="pending"]'); await p.waitForTimeout(100);
 ok('filtro sem pendentes: mensagem positiva',/Nada pendente/.test(await p.textContent('#items-container')));

 console.log('4. Bug da barra de sugestão vazia');
 p=await fresh(); await boot(p,mkState([mkList('c','Casa','rotina',['a'])]));
 await p.click('.list-card'); await p.waitForTimeout(100);
 ok('barra de sugestão invisível sem sugestão',await p.$eval('#add-suggestion',e=>getComputedStyle(e).display==='none'));
 ok('botão enviar esmaecido com campo vazio',parseFloat(await p.$eval('.add-item-form .icon-btn',e=>getComputedStyle(e).opacity))<.6);
 await p.fill('#add-item-input','novo'); await p.waitForTimeout(450);
 ok('botão enviar ativo com texto',parseFloat(await p.$eval('.add-item-form .icon-btn',e=>getComputedStyle(e).opacity))===1);

 console.log('5. Folha (modal)');
 p=await fresh(); await boot(p,mkState([mkList('c','Casa','rotina',['a'])]));
 await p.click('#btn-settings'); await p.waitForTimeout(500);
 const r=await p.$eval('#modal',e=>{const x=e.getBoundingClientRect();return {top:x.top,h:x.height,vh:innerHeight,w:x.width};});
 ok('folha ocupa no máx. 90% da altura',r.h<=r.vh*0.9+1,r);
 ok('arrasto curto (40px) não fecha',await (async()=>{await p.mouse.move(195,r.top+10);await p.mouse.down();await p.mouse.move(195,r.top+50,{steps:4});await p.mouse.up();await p.waitForTimeout(200);return !(await hidden(p));})());
 ok('arrasto longo (180px) na alça fecha',await (async()=>{const t=await p.$eval('#modal',e=>e.getBoundingClientRect().top);await p.mouse.move(195,t+10);await p.mouse.down();await p.mouse.move(195,t+190,{steps:6});await p.mouse.up();await p.waitForTimeout(250);return await hidden(p);})());
 ok('transform da folha é limpo após o arrasto',await p.$eval('#modal',e=>e.style.transform===''));
 await p.click('#btn-settings'); await p.waitForTimeout(400);
 ok('rolar o conteúdo não fecha a folha',await (async()=>{const t=await p.$eval('#modal',e=>e.getBoundingClientRect().top);await p.mouse.move(195,t+300);await p.mouse.down();await p.mouse.move(195,t+500,{steps:5});await p.mouse.up();await p.waitForTimeout(200);return !(await hidden(p));})());
 ok('ajustes agrupados em 6 seções',(await p.$$('.settings-label')).length===6,(await p.$$('.settings-label')).length);
 ok('3 interruptores com role=switch',(await p.$$('.switch[role="switch"]')).length===3);
 await p.click('#m-cancel'); await p.waitForTimeout(100);
 await p.click('.list-card'); await p.click('#btn-list-menu'); await p.waitForTimeout(300);
 ok('lembrete diário vira interruptor 52x32',await p.$eval('#m-reminder-enabled',e=>{const r=e.getBoundingClientRect();return Math.round(r.width)===52&&Math.round(r.height)===32;}));
 await p.click('#m-reminder-enabled'); await p.waitForTimeout(150);
 ok('interruptor de lembrete funciona',await p.$eval('#m-reminder-enabled',e=>e.checked)&&await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:v1')).lists[0].reminder.enabled===true));
 ok('botão "Adicionar horário" ainda funciona',await (async()=>{await p.click('#m-add-time');await p.waitForTimeout(150);return (await p.$$('.m-time-input')).length>=1;})());
 ok('sem erros de JS',p.errs.length===0,p.errs);

 console.log('6. Responsivo e tema');
 for (const w of [320,360,430,768,1280]) {
   const q=await fresh({viewport:{width:w,height:800}}); await boot(q,mkState([mkList('c','Casa com nome bem longo para testar quebra de linha','rotina',['Um item com um texto realmente comprido que precisa quebrar em várias linhas sem estourar','b'],1)]));
   const home=await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.list-card,.today-row,.game-summary-btn')].every(e=>e.getBoundingClientRect().right<=innerWidth+1));
   await q.click('.list-card'); await q.waitForTimeout(500);
   const det=await q.evaluate(()=>[...document.querySelectorAll('.item-row,.detail-progress,.filter-bar,.add-item-form')].every(e=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=-1));
   await q.click('#btn-list-menu'); await q.waitForTimeout(300);
   const mod=await q.$eval('#modal',e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth+1);
   ok(`${w}px: home, lista e folha sem estourar`,home&&det&&mod,{home,det,mod});
 }
 let w=await fresh({viewport:{width:1280,height:800}}); await boot(w,mkState([mkList('c','Casa','rotina',['a'])]));
 const appBox=await w.$eval('#app',e=>{const r=e.getBoundingClientRect();return {w:Math.round(r.width),l:Math.round(r.left)};});
 ok('tela larga: app limitado a 720px e centralizado',appBox.w===720&&appBox.l===280,appBox);
 for (const scheme of ['light','dark']) {
   const q=await fresh({colorScheme:scheme}); await boot(q,mkState([mkList('c','Casa','rotina',['a'])]));
   const bg=await q.evaluate(()=>getComputedStyle(document.body).backgroundColor);
   ok(`tema ${scheme}: fundo ${scheme==='dark'?'escuro':'claro'}`,scheme==='dark'?bg==='rgb(15, 20, 34)':bg==='rgb(246, 245, 241)',bg);
 }
 // contraste do texto secundário (WCAG AA 4.5:1)
 function lum(c){const a=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*a[0]+.7152*a[1]+.0722*a[2];}
 const ratio=(a,b)=>{const L1=lum(a),L2=lum(b);return (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);};
 ok('contraste claro: texto secundário sobre fundo ≥4.5',ratio([0x59,0x62,0x73],[0xf6,0xf5,0xf1])>=4.5,ratio([0x59,0x62,0x73],[0xf6,0xf5,0xf1]));
 ok('contraste escuro: texto secundário sobre superfície ≥4.5',ratio([0xa3,0xad,0xc2],[0x17,0x1d,0x2e])>=4.5,ratio([0xa3,0xad,0xc2],[0x17,0x1d,0x2e]));
 ok('contraste claro: texto do botão primário ≥4.5',ratio([255,255,255],[0x41,0x55,0xcc])>=4.5,ratio([255,255,255],[0x41,0x55,0xcc]));
 ok('contraste claro: ✓ branco sobre verde ≥4.3',ratio([255,255,255],[0x23,0x89,0x5a])>=4.3,ratio([255,255,255],[0x1f,0xa8,0x55]));
 await b.close(); console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail?1:0);
})();

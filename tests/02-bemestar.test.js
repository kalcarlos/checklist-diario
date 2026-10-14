const path = require('path');
const { launchBrowser, URL } = require('./lib');
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log('  ok  ',n);}else{fail++;console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));} };
const dk=n=>{const d=new Date();const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()-n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
(async()=>{
 const b=await launchBrowser();
 async function fresh(o){const c=await b.newContext(Object.assign({viewport:{width:390,height:800},serviceWorkers:'block'},o||{}));const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return p;}
 const mkList=(id,name,type,items,extra)=>Object.assign({id,name,emoji:id==='m'?'🛒':'🏠',type,items:items.map((t,i)=>({id:id+i,text:t,done:false})),sortOrder:'manual',reminder:{enabled:false,times:[]}},extra||{});
 const mkState=l=>({lastResetDate:dk(0),wordListStats:{},trash:[],lists:l});
 async function boot(p,game,state){await p.goto(URL);await p.evaluate(([g,s])=>{if(g)localStorage.setItem('checklist-diario:game',JSON.stringify(g));localStorage.setItem('checklist-diario:v1',JSON.stringify(s));localStorage.setItem('checklist-diario:skipLogin','1');},[game,state]);await p.reload();await p.waitForTimeout(400);await p.evaluate(()=>document.getElementById('modal-backdrop').classList.add('hidden'));}
 const G=extra=>Object.assign({enabled:true,days:{},badges:{},total:0,listsDone:0,greetedOn:dk(0)},extra||{});

 console.log('A. Para agora (3 próximas tarefas)');
 let p=await fresh();
 await boot(p,G(),mkState([mkList('m','Mercado','lista',['leite','pão']),mkList('c','Casa','rotina',['louça','roupa','lixo','varrer'])]));
 let rows=await p.$$eval('.today-row .today-text',e=>e.map(x=>x.textContent));
 ok('mostra só 3 tarefas',rows.length===3,rows);
 ok('rotinas primeiro, mesmo com lista de compras antes',JSON.stringify(rows)===JSON.stringify(['louça','roupa','lixo']),rows);
 await p.click('.today-row .check'); await p.waitForTimeout(200);
 rows=await p.$$eval('.today-row .today-text',e=>e.map(x=>x.textContent));
 ok('marcar tira da lista e entra a próxima',JSON.stringify(rows)===JSON.stringify(['roupa','lixo','varrer']),rows);
 ok('marcação persistiu no estado',await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:v1')).lists.find(l=>l.id==='c').items[0].done));
 ok('conta como atividade do dia',await p.evaluate(d=>JSON.parse(localStorage.getItem('checklist-diario:game')).days[d]===1,dk(0)));
 ok('sem erros JS',p.errs.length===0,p.errs);
 // leitor não aparece / viewer
 p=await fresh(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['a'],{role:'viewer'})]));
 ok('lista de leitor não entra em "Para agora"',(await p.$$('.today-row')).length===0);
 // tudo feito
 p=await fresh(); const st=mkState([mkList('c','Casa','lista',['a'])]); st.lists[0].items[0].done=true; await boot(p,G(),st);
 ok('sem pendências: sem bloco de tarefas, mas com botão de respirar',(await p.$$('.today-row')).length===0&&(await p.$('#btn-breathe'))!==null);
 // desligar
 p=await fresh(); await boot(p,G({today:false}),mkState([mkList('c','Casa','rotina',['a','b'])]));
 ok('desligado nos Ajustes: não mostra',(await p.$$('.today-row')).length===0);
 p=await fresh(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['a','b'])]));
 await p.click('#btn-settings'); await p.click('#m-today-toggle'); await p.waitForTimeout(150); await p.click('#m-cancel'); await p.waitForTimeout(100);
 ok('toggle nos Ajustes esconde',(await p.$$('.today-row')).length===0);
 await p.click('#btn-settings'); await p.click('#m-today-toggle'); await p.waitForTimeout(150); await p.click('#m-cancel'); await p.waitForTimeout(100);
 ok('toggle de novo mostra',(await p.$$('.today-row')).length===2);
 // texto escapado
 p=await fresh(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['<b id=pwn>x</b>'])]));
 ok('texto escapado em "Para agora"',(await p.$('#pwn'))===null);

 console.log('B. Respirar');
 p=await fresh(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['a'])]));
 await p.click('#btn-breathe'); await p.waitForTimeout(1500);
 ok('abre com círculo e guia',(await p.$('#breath-circle'))!==null&&/Inspire/.test(await p.textContent('#breath-text')),await p.textContent('#breath-text'));
 ok('círculo expande na inspiração',await p.$eval('#breath-circle',e=>e.classList.contains('in')));
 await p.click('#m-cancel'); await p.waitForTimeout(200);
 ok('fechar volta à home',await p.$eval('#modal-backdrop',e=>e.classList.contains('hidden')));
 await p.waitForTimeout(500); ok('fechar não deixa erro de JS',p.errs.length===0,p.errs);
 // dentro do foco
 p=await fresh(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['tarefa x','y'])]));
 await p.click('.list-card'); await p.click('#btn-focus'); await p.click('#m-focus-breathe'); await p.waitForTimeout(300);
 ok('respirar no foco abre',(await p.$('#breath-circle'))!==null);
 await p.click('#m-cancel'); await p.waitForTimeout(150);
 ok('fechar volta ao foco na mesma tarefa',(await p.textContent('#focus-text'))==='tarefa x');
 // termina ciclo: aceleração de tempo
 p=await fresh(); await p.clock.install(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['a'])]));
 await p.click('#btn-breathe'); await p.clock.runFor(1300+6*10000+500); await p.waitForTimeout(100);
 ok('após 6 ciclos mostra mensagem final',/Pronto/.test(await p.textContent('#breath-text')),await p.textContent('#breath-text'));

 console.log('C. Cronômetro suave no foco');
 p=await fresh(); await p.clock.install(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['a','b'])]));
 await p.click('.list-card'); await p.click('#btn-focus');
 ok('oferece 5/10/25 min',(await p.$$('#focus-timer [data-min]')).length===3);
 await p.click('#focus-timer [data-min="5"]'); await p.clock.fastForward(61000); await p.waitForTimeout(50);
 ok('mostra contagem regressiva ~3:59',/3:5\d|4:0\d/.test(await p.textContent('#focus-timer-digits')),await p.textContent('#focus-timer-digits'));
 ok('barra avança',parseInt(await p.$eval('#focus-timer-bar',e=>e.style.width))>=15);
 await p.click('#m-focus-done'); await p.waitForTimeout(50);
 ok('timer continua ao avançar de tarefa',(await p.$('#focus-timer-digits'))!==null);
 await p.clock.fastForward(5*60*1000); await p.waitForTimeout(50);
 ok('ao acabar avisa com gentileza',/Tempo!/.test(await p.textContent('#game-toast')));
 ok('volta a oferecer opções',(await p.$$('#focus-timer [data-min]')).length===3);
 await p.click('#focus-timer [data-min="10"]'); await p.click('#m-timer-stop'); await p.waitForTimeout(50);
 ok('Parar cancela',(await p.$$('#focus-timer [data-min]')).length===3);
 await p.click('#focus-timer [data-min="25"]'); await p.click('#m-cancel'); await p.clock.fastForward(3000); await p.waitForTimeout(50);
 ok('sair do foco encerra o timer sem erro',p.errs.length===0,p.errs);

 console.log('D. Modo tranquilo');
 p=await fresh(); await boot(p,G({calm:true,days:{[dk(0)]:2,[dk(1)]:1,[dk(2)]:1}}),mkState([mkList('c','Casa','rotina',['a','b','c'])]));
 const s=await p.textContent('#game-summary');
 ok('home sem números',!/\d/.test(s),s);
 await p.click('.list-card'); await p.waitForTimeout(100);
 const dp=await p.textContent('#detail-progress');
 ok('lista sem "Faltam N" nem x/y',!/Faltam|\d\/\d/.test(dp)&&/passo/.test(dp),dp);
 ok('barra de progresso continua',(await p.$('#detail-progress .progress-bar'))!==null);
 await p.click('#btn-focus'); ok('foco sem contagem',!/Faltam|Falta só/.test(await p.textContent('#modal')));
 await p.click('#focus-timer [data-min="5"]'); ok('timer sem dígitos',(await p.$('#focus-timer-digits'))===null&&(await p.$('#focus-timer-bar'))!==null);
 await p.click('#m-cancel');
 p=await fresh(); await boot(p,G({calm:true,greetedOn:'2000-01-01'}),mkState([mkList('c','Casa','rotina',['a','b'])]));
 ok('saudação sem número',!/\d/.test(await p.textContent('#game-toast')),await p.textContent('#game-toast'));
 p=await fresh(); await boot(p,G(),mkState([mkList('c','Casa','rotina',['a'])]));
 await p.click('#btn-settings'); await p.click('#m-calm-toggle'); await p.waitForTimeout(150);
 ok('toggle ativa e persiste',await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')).calm===true));

 console.log('E. Robustez');
 p=await fresh(); await boot(p,G(),mkState([]));
 ok('sem listas: sem erro, botão de respirar disponível',p.errs.length===0&&(await p.$('#btn-breathe'))!==null,p.errs);
 const ctx=await b.newContext({viewport:{width:390,height:800},serviceWorkers:'block',reducedMotion:'reduce'}); p=await ctx.newPage();
 await boot(p,G(),mkState([mkList('c','Casa','rotina',['a'])])); await p.click('#btn-breathe'); await p.waitForTimeout(1500);
 ok('reduzir movimento: sem transição no círculo',await p.$eval('#breath-circle',e=>parseFloat(getComputedStyle(e).transitionDuration)<0.001));
 // HTML antigo em cache + app novo
 const fs=require('fs'); const c3=await b.newContext({serviceWorkers:'block',viewport:{width:390,height:800}}); p=await c3.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
 const old=fs.readFileSync(path.join(__dirname,'fixtures','index-antigo.html'),'utf8'); await p.route('**/',r=>r.fulfill({contentType:'text/html',body:old}));
 await p.goto(URL+'/'); await p.evaluate(s=>{localStorage.setItem('checklist-diario:skipLogin','1');localStorage.setItem('checklist-diario:v1',JSON.stringify(s));},mkState([mkList('c','Casa','rotina',['a'])]));
 await p.reload(); await p.waitForTimeout(400);
 ok('HTML antigo em cache não quebra',p.errs.length===0&&(await p.$$('.list-card')).length===1,p.errs);
 await b.close(); console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail?1:0);
})();

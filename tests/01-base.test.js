const path = require('path');
const { launchBrowser, URL } = require('./lib');

let pass=0, fail=0;
function ok(name, cond, extra){ if(cond){pass++;console.log('  ok  ',name);}else{fail++;console.log('  FAIL',name, extra===undefined?'':JSON.stringify(extra));} }
const dk=n=>{const d=new Date();const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()-n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
(async()=>{
 const b=await launchBrowser();
 async function fresh(opts){
   const ctx=await b.newContext(Object.assign({viewport:{width:390,height:800},serviceWorkers:'block'},opts||{}));
   const p=await ctx.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
   return p;
 }
 async function boot(p, game, state){
   // sem 'game' explícito, marca a saudação do dia como já mostrada (senão ela aparece e atrapalha os testes de toast)
   if(!game) game={greetedOn:dk(0)};
   await p.goto(URL);
   await p.evaluate(([g,s])=>{ if(g) localStorage.setItem('checklist-diario:game',JSON.stringify(g)); if(s) localStorage.setItem('checklist-diario:v1',JSON.stringify(s)); localStorage.setItem('checklist-diario:skipLogin','1'); },[game,state]);
   await p.reload(); await p.waitForTimeout(400);
   await p.evaluate(()=>{const m=document.getElementById('modal-backdrop'); if(m) m.classList.add('hidden');});
 }
 const today=()=>dk(0);
 const mkState=(lists)=>({lastResetDate:today(),wordListStats:{},trash:[],lists});
 const mkList=(id,name,type,items,extra)=>Object.assign({id,name,emoji:'🏠',type,items:items.map((t,i)=>({id:id+i,text:t,done:false})),sortOrder:'manual',reminder:{enabled:false,times:[]}},extra||{});
 const summary=p=>p.textContent('#game-summary');

 console.log('1. Feedback ao marcar / progresso');
 let p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['a','b','c'])]));
 ok('resumo inicial convida a começar',(await summary(p)).includes('Marque um item'));
 await p.click('.list-card'); await p.waitForTimeout(150);
 ok('progresso "Faltam 3"',(await p.textContent('#detail-progress')).includes('Faltam 3'));
 await p.click('.item-row .check'); await p.waitForTimeout(150);
 ok('pulinho aplicado no item marcado',await p.$eval('.item-row.done .check',e=>true).catch(()=>false));
 ok('progresso "Faltam 2" e 1/3',(await p.textContent('#detail-progress')).includes('Faltam 2')&&(await p.textContent('#detail-progress')).includes('1/3'));
 ok('toast primeiro do dia / conquista',/Conquista|Primeiro/.test(await p.textContent('#game-toast')));
 let g=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')));
 ok('contagem do dia = 1 e total = 1',g.days[today()]===1&&g.total===1,g);
 await p.click('.item-row .check'); await p.waitForTimeout(100); // desmarca
 g=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')));
 ok('desmarcar reduz contagem (sem dia ativo)',!g.days[today()]&&g.total===0,g);
 await p.click('.item-row .check'); await p.click('.item-row:nth-child(2) .check'); await p.click('.item-row:nth-child(3) .check'); await p.waitForTimeout(150);
 ok('lista completa -> "Tudo feito"',(await p.textContent('#detail-progress')).includes('Tudo feito'));
 ok('toast de conclusão/conquista',/Conquista|completa|feito|Missão|Mandou|Arrasou|capricho|cabeça|parab|Feito/i.test(await p.textContent('#game-toast')),await p.textContent('#game-toast'));
 g=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')));
 ok('listsDone=1 e badges first+list1',g.listsDone===1&&g.badges.first&&g.badges.list1,g.badges);
 ok('botão modo foco some quando nada pendente',(await p.$('#btn-focus'))===null);
 ok('sem erros de JS',p.errs.length===0,p.errs);

 console.log('2. Sequência com perdão / dias ativos');
 async function streakCase(days){
   const q=await fresh(); const gm={enabled:true,badges:{},total:0,listsDone:0,days:{}};
   days.forEach(n=>gm.days[dk(n)]=1);
   await boot(q,gm,mkState([mkList('l1','Casa','rotina',['a'])]));
   const t=await summary(q); await q.close(); return t;
 }
 let t=await streakCase([0]); ok('só hoje: 1 dia ativo, sem sequência',t.includes('1 dia ativo')&&!t.includes('sequência'),t);
 t=await streakCase([0,1,2,3,4]); ok('5 dias seguidos: sequência 5',t.includes('5 dias ativos')&&t.includes('sequência de 5'),t);
 t=await streakCase([1,2,4,5]); ok('um furo perdoado: sequência 4 (hoje não conta contra)',t.includes('sequência de 4'),t);
 t=await streakCase([1,3]); ok('dois furos em <7 dias quebram: sequência 2? (1 ativo, 2 perdoado, 3 ativo)',t.includes('2 dias ativos')&&t.includes('sequência de 2'),t);
 t=await streakCase([1,3,5]); ok('furos em 2 e 4 -> quebra em 4: sequência 2',t.includes('3 dias ativos')&&t.includes('sequência de 2'),t);
 t=await streakCase([]); ok('sem histórico: convite',t.includes('Marque um item'),t);
 t=await streakCase([10,11,12]); ok('histórico antigo: não quebra a UI (0 ativos na semana)',t.includes('Marque um item'),t);

 console.log('3. Histórico, calendário e conquistas');
 p=await fresh(); const gm={enabled:true,badges:{first:'x'},total:60,listsDone:1,days:{}}; [0,1,2,3,4].forEach(n=>gm.days[dk(n)]=(n===0?7:1));
 await boot(p,gm,mkState([mkList('l1','Casa','rotina',['a'])]));
 await p.click('#btn-game-history'); await p.waitForTimeout(150);
 ok('calendário tem 84 células',(await p.$$('.heat-cell')).length===84,(await p.$$('.heat-cell')).length);
 ok('célula de hoje tem nível 3 (7 itens)',(await p.$$('.heat-cell.l3')).length===1);
 ok('5 dias ativos coloridos',(await p.$$('.heat-cell.l1,.heat-cell.l2,.heat-cell.l3')).length===5);
 ok('7 conquistas listadas',(await p.$$('.badge')).length===7);
 ok('conquistas bloqueadas esmaecidas',(await p.$$('.badge.locked')).length>=4);
 await p.click('#m-cancel'); await p.waitForTimeout(100);
 await p.click('.list-card'); await p.click('.item-row .check'); await p.waitForTimeout(200);
 g=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')));
 ok('desbloqueou week5 (5 dias) e total50 (61 itens) — conquistas permanentes',g.badges.week5&&g.badges.total50,g.badges);
 p.errs.length&&console.log(p.errs);

 console.log('4. Desativar progresso e feedback');
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['a','b'])]));
 await p.click('#btn-settings'); await p.waitForTimeout(150);
 ok('opção nos Ajustes',(await p.textContent('#modal')).includes('Progresso e feedback'));
 await p.click('#m-game-toggle'); await p.waitForTimeout(150); ok('interruptor refletiu o estado (aria-checked=false)',(await p.getAttribute('#m-game-toggle','aria-checked'))==='false'); await p.click('#m-cancel'); await p.waitForTimeout(150);
 ok('resumo some na home',(await p.$eval('#game-summary',e=>e.classList.contains('hidden'))));
 await p.click('.list-card'); await p.waitForTimeout(100);
 ok('sem barra de progresso',!(await p.$('#detail-progress .progress-bar')));
 ok('modo foco continua disponível',(await p.$('#btn-focus'))!==null);
 const before=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')||'{}'));
 await p.click('.item-row .check'); await p.waitForTimeout(150);
 ok('sem toast ao marcar',(await p.$('#game-toast'))===null||!(await p.$eval('#game-toast',e=>e.classList.contains('show'))));
 g=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game')));
 ok('nada é contabilizado desativado',!g.days[today()]&&!g.total,g);
 ok('item continua marcando normalmente',await p.$eval('.item-row',e=>e.classList.contains('done')&&e.querySelector('.check svg')!==null));

 console.log('5. Modo foco');
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['alfa','beta','gama'])]));
 await p.click('.list-card'); await p.click('#btn-focus'); await p.waitForTimeout(150);
 ok('mostra primeira pendente',(await p.textContent('#focus-text'))==='alfa');
 await p.click('#m-focus-skip'); ok('pular mostra a próxima',(await p.textContent('#focus-text'))==='beta');
 await p.click('#m-focus-skip'); await p.click('#m-focus-skip'); ok('pular tudo volta ao início',(await p.textContent('#focus-text'))==='alfa');
 await p.click('#m-focus-done'); ok('feito avança',(await p.textContent('#focus-text'))==='beta');
 ok('lista ao fundo atualizou',(await p.$$('.item-row.done')).length===1);
 await p.click('#focus-text'); ok('toque aumenta a letra',await p.$eval('#focus-text',e=>e.classList.contains('large')));
 g=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:game'))); ok('preferência de letra salva',g.focusLarge===true);
 await p.click('#m-focus-done'); await p.click('#m-focus-done'); await p.waitForTimeout(250);
 ok('fecha ao terminar tudo',await p.$eval('#modal-backdrop',e=>e.classList.contains('hidden')));
 ok('lista toda marcada',(await p.$$('.item-row.done')).length===3);
 ok('sem erros de JS',p.errs.length===0,p.errs);

 console.log('6. Dividir em passos');
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['limpar casa','outro'])]));
 await p.click('.list-card'); await p.click('#btn-focus'); await p.click('#m-focus-split'); await p.waitForTimeout(100);
 p.once('dialog',d=>{ ok('exige 2+ passos (alerta)',/pelo menos 2/.test(d.message())); d.accept(); });
 await p.fill('#m-split-text','só um'); await p.click('#m-split-save'); await p.waitForTimeout(100);
 await p.fill('#m-split-text','  passo 1 \n\n passo 2\npasso 3  '); await p.click('#m-split-save'); await p.waitForTimeout(200);
 ok('foco volta no 1º passo',(await p.textContent('#focus-text'))==='passo 1');
 await p.click('#m-cancel');
 const items=await p.$$eval('.item-row .text',e=>e.map(x=>x.value));
 ok('passos entram na posição do original, sem linhas vazias',JSON.stringify(items)===JSON.stringify(['passo 1','passo 2','passo 3','outro']),items);
 const trash=await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:v1')).trash.map(t=>t.item&&t.item.text));
 ok('original na lixeira (recuperável)',trash.includes('limpar casa'),trash);
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['x'])]));
 await p.click('.list-card'); await p.click('#btn-focus'); await p.click('#m-focus-split');
 await p.fill('#m-split-text',Array.from({length:20},(_,i)=>'p'+i).join('\n')); await p.click('#m-split-save'); await p.waitForTimeout(150);
 await p.click('#m-cancel'); ok('limite de 15 passos',(await p.$$('.item-row')).length===15);
 await p.click('#btn-focus'); await p.click('#m-focus-split'); await p.click('#m-split-cancel'); await p.waitForTimeout(100);
 ok('"Voltar" retorna ao foco',(await p.$('#focus-text'))!==null);

 console.log('7. Convite gentil diário');
 p=await fresh();
 await boot(p,{enabled:true,days:{},badges:{},total:0,listsDone:0,greetedOn:'2000-01-01'},mkState([mkList('l1','Casa','rotina',['a','b']),mkList('l2','Mercado','lista',['x','y','z'])]));
 ok('aparece com tarefas de rotina (só conta rotina)',(await p.textContent('#game-toast')).includes('Tem 2 tarefas'),await p.textContent('#game-toast').catch(()=>null));
 await p.reload(); await p.waitForTimeout(400);
 ok('não repete no mesmo dia',(await p.$('#game-toast'))===null);
 p=await fresh();
 await boot(p,{enabled:true,days:{},badges:{},total:0,listsDone:0,greetedOn:'2000-01-01'},mkState([mkList('l2','Mercado','lista',['x'])]));
 ok('sem rotina pendente: não aparece',(await p.$('#game-toast'))===null);
 p=await fresh();
 await boot(p,{enabled:false,days:{},badges:{},total:0,listsDone:0},mkState([mkList('l1','Casa','rotina',['a'])]));
 ok('desativado: não aparece',(await p.$('#game-toast'))===null);

 console.log('8. Regressões / robustez');
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['a'],{role:'viewer'})]));
 await p.click('.list-card'); await p.waitForTimeout(100);
 ok('leitor não vê modo foco',(await p.$('#btn-focus'))===null);
 ok('leitor vê progresso',(await p.textContent('#detail-progress')).includes('Falta só 1'));
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['a'])]));
 await p.evaluate(()=>localStorage.setItem('checklist-diario:game','{lixo'));
 await p.reload(); await p.waitForTimeout(300);
 ok('JSON de progresso corrompido não quebra o app',p.errs.length===0&&(await p.$('.list-card'))!==null,p.errs);
 p=await fresh();
 const old=mkState([mkList('l1','Casa','rotina',['a','b'])]); old.lastResetDate='2000-01-01'; old.lists[0].items[0].done=true;
 await boot(p,null,old);
 ok('reset diário das rotinas continua funcionando',await p.evaluate(()=>JSON.parse(localStorage.getItem('checklist-diario:v1')).lists[0].items.every(i=>!i.done)));
 p=await fresh();
 await boot(p,null,mkState([mkList('l1','Casa','lista',[])]));
 await p.click('.list-card'); await p.waitForTimeout(100);
 ok('lista vazia: sem progresso nem foco',(await p.$eval('#detail-progress',e=>e.classList.contains('hidden'))));
 p=await fresh();
 await boot(p,null,{lastResetDate:today(),wordListStats:{},trash:[],lists:[]});
 ok('sem listas: resumo oculto',await p.$eval('#game-summary',e=>e.classList.contains('hidden')));
 // backup: progresso não entra no export
 p=await fresh(); await boot(p,null,mkState([mkList('l1','Casa','rotina',['a'])]));
 ok('progresso fora do estado das listas (não sincroniza)',await p.evaluate(()=>!('days' in JSON.parse(localStorage.getItem('checklist-diario:v1')))));
 // reduced motion
 const ctx=await b.newContext({viewport:{width:390,height:800},serviceWorkers:'block',reducedMotion:'reduce'}); p=await ctx.newPage();
 await boot(p,null,mkState([mkList('l1','Casa','rotina',['a','b'])]));
 await p.click('.list-card'); await p.click('.item-row .check'); await p.waitForTimeout(100);
 ok('reduzir movimento desliga a animação',await p.$eval('.item-row.done .check',e=>parseFloat(getComputedStyle(e).animationDuration)<0.001));
 // texto com HTML não é interpretado no foco
 p=await fresh(); await boot(p,null,mkState([mkList('l1','Casa','rotina',['<img src=x onerror=window.__x=1>'])]));
 await p.click('.list-card'); await p.click('#btn-focus'); await p.waitForTimeout(150);
 ok('texto do item é escapado no foco',(await p.evaluate(()=>window.__x))===undefined&&(await p.textContent('#focus-text')).startsWith('<img'));
 await b.close();
 console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail?1:0);
})();

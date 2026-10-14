// Lote 2: passos dentro do item, adiar, rotina por dias da semana e prioridades do dia.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const dk = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const todayDow = new Date().getDay();
const otherDows = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== todayDow);

(async () => {
  const b = await launchBrowser();
  const mkItem = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
  const mkList = (id, name, type, items, extra) => Object.assign({ id, name, emoji: '🏠', type, items: items.map((t, i) => (typeof t === 'string' ? mkItem(id + i, t) : t)), sortOrder: 'manual', reminder: { enabled: false, times: [] } }, extra || {});
  const mkState = (l) => ({ lastResetDate: dk(0), wordListStats: {}, trash: [], lists: l });
  const G = (x) => Object.assign({ enabled: true, days: {}, badges: {}, total: 0, listsDone: 0, greetedOn: dk(0), onboarded: true }, x || {});
  async function fresh(o) { const c = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, o || {})); const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); return p; }
  async function boot(p, state, game) {
    await p.goto(URL);
    await p.evaluate(([s, g]) => { localStorage.setItem('checklist-diario:v1', JSON.stringify(s)); localStorage.setItem('checklist-diario:skipLogin', '1'); localStorage.setItem('checklist-diario:game', JSON.stringify(g)); }, [state, game || G()]);
    await p.reload(); await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
  }
  const stored = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), k);
  const hidden = (p) => p.$eval('#modal-backdrop', (e) => e.classList.contains('hidden'));
  const rowsText = (p) => p.$$eval('.item-row .text', (e) => e.map((x) => x.value));
  const openList = async (p) => { await p.click('.list-card'); await p.waitForTimeout(480); };
  const expand = async (p, n) => { await p.click(`.item-row:nth-child(${n}) .item-body`); await p.waitForTimeout(80); };

  console.log('1. Passos dentro do item');
  let p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['Arrumar o quarto', 'Outra'])]));
  await openList(p);
  ok('item sem passos não mostra chip nem painel', (await p.$$('.item-meta')).length === 0 && (await p.$('.item-panel')) === null);
  await expand(p, 1);
  ok('tocar no texto abre o painel com campo de passo', (await p.$('.item-panel .step-input')) !== null && /Divida em passos/.test(await p.textContent('.item-panel')));
  ok('aria-expanded reflete o estado', (await p.getAttribute('.item-row:nth-child(1) .item-body', 'aria-expanded')) === 'true');
  await p.fill('.step-input', 'Guardar a roupa'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok('Enter adiciona o passo e mantém o foco no campo', (await p.$$('.step-row')).length === 1 && await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('step-input')));
  await p.fill('.step-input', 'Arrumar a cama'); await p.click('.step-add-btn'); await p.waitForTimeout(100);
  await p.fill('.step-input', 'Passar pano'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok('3 passos; chip mostra 0/3', (await p.$$('.step-row')).length === 3 && /0\/3 passos/.test(await p.textContent('.item-row:nth-child(1) .item-meta')));
  await p.click('.step-row:nth-child(1) .step-check'); await p.waitForTimeout(100);
  ok('marcar um passo: chip 1/3 e item não conclui', /1\/3/.test(await p.textContent('.item-row:nth-child(1) .item-meta')) && (await p.$$('.item-row.done')).length === 0);
  let g = await stored(p, 'checklist-diario:game');
  ok('passo conta como atividade do dia', g.days[dk(0)] === 1, g.days);
  await p.click('.step-row:nth-child(2) .step-check'); await p.click('.step-row:nth-child(3) .step-check'); await p.waitForTimeout(150);
  ok('fechar o último passo conclui a tarefa', (await p.$$('.item-row.done')).length === 1);
  ok('toast de conquista/progresso aparece ao concluir', (await p.$('#game-toast')) !== null);
  await p.click('.step-row:nth-child(2) .step-check'); await p.waitForTimeout(120);
  ok('reabrir um passo reabre a tarefa', (await p.$$('.item-row.done')).length === 0);
  await p.click('.step-row:nth-child(2) .step-check'); await p.waitForTimeout(100);
  await p.click('.step-row:nth-child(3) .step-del'); await p.waitForTimeout(100);
  ok('remover passo funciona', (await p.$$('.step-row')).length === 2);
  const st = await stored(p, 'checklist-diario:v1');
  ok('passos ficam em item.steps (sincroniza como campo do item)', st.lists[0].items[0].steps.length === 2 && st.lists[0].items[0].steps.every((s) => s.id && typeof s.done === 'boolean'));
  await p.fill('.step-input', 'x'.repeat(150)); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok('texto do passo é limitado a 100 caracteres', (await stored(p, 'checklist-diario:v1')).lists[0].items[0].steps.pop().text.length <= 100);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('checklist-diario:v1')); const it = s.lists[0].items[0]; it.steps = Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i, text: 's' + i, done: false })); localStorage.setItem('checklist-diario:v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden')); await openList(p); await expand(p, 1);
  await p.fill('.step-input', 'mais um'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok('máximo de 20 passos', (await p.$$('.step-row')).length === 20);
  await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
  // colar vários
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['Tarefa'])])); await openList(p); await expand(p, 1);
  await p.evaluate(() => { const i = document.querySelector('.step-input'); const dt = new DataTransfer(); dt.setData('text', 'um\ndois\ntrês'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await p.waitForTimeout(150);
  ok('colar texto com várias linhas cria vários passos', (await p.$$('.step-row')).length === 3);
  // modo calmo
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'T', { steps: [{ id: 's1', text: 'p1', done: true }, { id: 's2', text: 'p2', done: false }] })])]), G({ calm: true }));
  await openList(p);
  ok('modo tranquilo: chip sem números', /com passos/.test(await p.textContent('.item-meta')) && !/\d/.test(await p.textContent('.item-meta')));
  // leitor
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'T', { steps: [{ id: 's1', text: 'p1', done: false }] }), mkItem('b', 'Sem passos')], { role: 'viewer' })]));
  await openList(p); await expand(p, 1);
  ok('leitor vê os passos mas sem editar', (await p.$$('.step-row')).length === 1 && (await p.$('.step-input')) === null && (await p.$('.step-del')) === null);
  await p.click('.step-row .step-check'); await p.waitForTimeout(100);
  ok('leitor não consegue marcar passo', !(await stored(p, 'checklist-diario:v1')).lists[0].items[0].steps[0].done);
  await expand(p, 2);
  ok('leitor: item sem passos não abre painel', (await p.$('.item-row:nth-child(2) .item-panel')) === null);
  // edição de texto não abre painel
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['Editar aqui'])])); await openList(p);
  await p.click('.item-row .edit-btn'); await p.waitForTimeout(80);
  ok('editar texto (lápis) não abre o painel', (await p.$('.item-panel')) === null && await p.$eval('.item-row .text', (e) => !e.readOnly));
  // renderização de HTML
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'T', { steps: [{ id: 's1', text: '<img id=pwn src=x>', done: false }] })])])); await openList(p); await expand(p, 1);
  ok('texto do passo é escapado', (await p.$('#pwn')) === null && (await p.textContent('.step-text')).startsWith('<img'));
  // compartilhar como texto inclui passos
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Tarefa', { steps: [{ id: 's1', text: 'p1', done: true }, { id: 's2', text: 'p2', done: false }] })])]));
  await p.addInitScript(() => { navigator.share = undefined; });
  await p.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }; });
  await openList(p); await p.click('#btn-list-menu'); await p.click('#m-share'); await p.waitForTimeout(200);
  const clip = await p.evaluate(() => window.__clip);
  ok('"Copiar como texto" inclui os passos', /Tarefa/.test(clip || '') && /✔ p1/.test(clip || '') && /◦ p2/.test(clip || ''), clip);
  // dividir pelo foco
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['Limpar casa', 'Outra'])]));
  await openList(p); await p.click('#btn-focus'); await p.click('#m-focus-split'); await p.fill('#m-split-text', 'passo 1\npasso 2\npasso 3'); await p.click('#m-split-save'); await p.waitForTimeout(200);
  ok('dividir (padrão) cria passos dentro da tarefa, sem mexer nos itens', JSON.stringify(await rowsText(p)) === JSON.stringify(['Limpar casa', 'Outra']) && (await stored(p, 'checklist-diario:v1')).lists[0].items[0].steps.length === 3);
  ok('foco volta mostrando a mesma tarefa com os 3 passos', (await p.textContent('#focus-text')) === 'Limpar casa' && (await p.$$('.focus-step')).length === 3);
  await p.click('.focus-step:nth-child(1)'); await p.waitForTimeout(100);
  ok('marcar passo dentro do foco', (await p.$$('.focus-step.done')).length === 1 && (await p.textContent('#focus-text')) === 'Limpar casa');
  await p.click('.focus-step:nth-child(2)'); await p.click('.focus-step:nth-child(3)'); await p.waitForTimeout(200);
  ok('concluir o último passo no foco conclui a tarefa e avança', (await p.textContent('#focus-text')) === 'Outra');
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('2. Adiar');
  p = await fresh(); await p.clock.install(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b', 'c'])]));
  await openList(p); await expand(p, 2);
  await p.click('[data-act="snooze"]'); await p.waitForTimeout(60);
  ok('"Adiar" mostra amanhã / 3 dias / semana que vem', (await p.$$('.snooze-options [data-days]')).length === 3 && await p.$eval('.snooze-options', (e) => !e.classList.contains('hidden')));
  await p.click('.snooze-options [data-days="1"]'); await p.waitForTimeout(120);
  let s2 = await stored(p, 'checklist-diario:v1');
  ok('grava snoozeUntil = amanhã', s2.lists[0].items[1].snoozeUntil === dk(-1), s2.lists[0].items[1].snoozeUntil);
  ok('item mostra chip "volta amanhã" e estilo adiado', /volta amanhã/.test(await p.textContent('.item-row:nth-child(2) .item-meta')) && await p.$eval('.item-row:nth-child(2)', (e) => e.classList.contains('snoozed')));
  ok('progresso ignora o adiado (Faltam 2, 0/2)', /Faltam 2/.test(await p.textContent('#detail-progress')) && /0\/2/.test(await p.textContent('#detail-progress')));
  ok('aviso com Desfazer', /Adiado/.test(await p.textContent('#undo-toast')));
  await p.click('#undo-toast .undo-btn'); await p.waitForTimeout(100);
  ok('desfazer remove o adiamento', !('snoozeUntil' in (await stored(p, 'checklist-diario:v1')).lists[0].items[1]) && /Faltam 3/.test(await p.textContent('#detail-progress')));
  await expand(p, 2); await p.click('[data-act="snooze"]'); await p.click('.snooze-options [data-days="7"]'); await p.waitForTimeout(100);
  ok('"Semana que vem" = +7 dias', (await stored(p, 'checklist-diario:v1')).lists[0].items[1].snoozeUntil === dk(-7));
  // fora do Para agora / foco
  await p.click('#btn-back'); await p.waitForTimeout(450);
  ok('home: cartão mostra "1 adiado"', /1 adiado/.test(await p.textContent('.list-card .meta')) && /0 de 2/.test(await p.textContent('.list-card .meta')), await p.textContent('.list-card .meta'));
  ok('adiado não aparece em "Para agora"', JSON.stringify(await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent))) === JSON.stringify(['a', 'c']));
  await p.click('.list-card'); await p.waitForTimeout(450); await p.click('#btn-focus'); await p.click('#m-focus-done'); await p.waitForTimeout(100);
  ok('foco pula o adiado (vai de a para c)', (await p.textContent('#focus-text')) === 'c');
  await p.click('#m-focus-done'); await p.waitForTimeout(300);
  ok('com tudo feito exceto o adiado, a lista conta como concluída', /Tudo feito/.test(await p.textContent('#detail-progress')));
  // trazer de volta
  await expand(p, 2); await p.click('[data-act="unsnooze"]'); await p.waitForTimeout(100);
  ok('"Trazer de volta hoje" reativa o item', !('snoozeUntil' in (await stored(p, 'checklist-diario:v1')).lists[0].items[1]));
  // adiamento vencido volta sozinho
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', mkItem('b', 'vencido', { snoozeUntil: dk(1) }), mkItem('c', 'hoje', { snoozeUntil: dk(0) }), mkItem('d', 'futuro', { snoozeUntil: dk(-2) })])]));
  ok('data passada ou de hoje: volta ao "Para agora"; futura continua adiada', JSON.stringify(await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent))) === JSON.stringify(['a', 'vencido', 'hoje']));
  // adiar pelo foco
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['primeira', 'segunda'])]));
  await openList(p); await p.click('#btn-focus'); await p.click('#m-focus-snooze'); await p.waitForTimeout(100);
  ok('foco: Adiar abre as opções', /Adiar para quando/.test(await p.textContent('#modal')));
  await p.click('[data-days="3"]'); await p.waitForTimeout(200);
  ok('foco segue para a próxima tarefa', (await p.textContent('#focus-text')) === 'segunda');
  ok('adiou por 3 dias', (await stored(p, 'checklist-diario:v1')).lists[0].items[0].snoozeUntil === dk(-3));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['a'])]), G()); await openList(p); await p.click('.item-row .check'); await expand(p, 1);
  ok('item concluído não oferece Adiar nem prioridade', (await p.$('[data-act="snooze"]')) === null && (await p.$('[data-act="pick"]')) === null);
  // lembrete: lista toda adiada não tem pendência
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'x', { snoozeUntil: dk(-2) })], { reminder: { enabled: true, times: ['08:00'] } })]));
  ok('todos adiados: a lista aparece como "Tudo adiado"', /Tudo adiado/.test(await p.textContent('.list-card .meta')));

  console.log('3. Rotina por dias da semana');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'], { days: otherDows.slice(0, 2) }), mkList('m', 'Mercado', 'lista', ['leite']), mkList('n', 'Noite', 'rotina', ['x'])]));
  ok('rotina de outro dia: cartão esmaecido e com "hoje não"', await p.$eval('.list-card:nth-child(1)', (e) => e.classList.contains('off-today') && /hoje não/.test(e.textContent)));
  ok('"Para agora" ignora a rotina de outro dia', JSON.stringify(await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent))) === JSON.stringify(['x', 'leite']), await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent)));
  ok('rotina sem dias e lista simples não são afetadas', await p.$eval('.list-card:nth-child(3)', (e) => !e.classList.contains('off-today')) && await p.$eval('.list-card:nth-child(2)', (e) => !e.classList.contains('off-today')));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'], { days: [todayDow] })]));
  ok('rotina no dia certo aparece normal', await p.$eval('.list-card', (e) => !e.classList.contains('off-today')) && (await p.$$('.today-row')).length === 2);
  ok('meta mostra os dias em vez de "diária"', !/diária/.test(await p.textContent('.list-card .meta')), await p.textContent('.list-card .meta'));
  // seletor
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'])]));
  await openList(p); await p.click('#btn-list-menu'); await p.waitForTimeout(300);
  ok('menu da rotina tem "Dias da semana" (Todos os dias)', /Todos os dias/.test(await p.textContent('#m-days')));
  await p.click('#m-days'); await p.waitForTimeout(100);
  ok('seletor com 7 dias e 3 atalhos', (await p.$$('[data-day]')).length === 7 && (await p.$$('[data-preset]')).length === 3);
  await p.click('[data-preset="weekdays"]'); await p.waitForTimeout(50);
  ok('atalho "Dias úteis" marca seg–sex', (await p.$$('[data-day].selected')).length === 5);
  await p.click('#m-days-save'); await p.waitForTimeout(250);
  ok('salva e volta ao menu mostrando "Dias úteis"', /Dias úteis/.test(await p.textContent('#m-days')) && JSON.stringify((await stored(p, 'checklist-diario:v1')).lists[0].days) === '[1,2,3,4,5]');
  await p.click('#m-cancel'); await p.waitForTimeout(150);
  ok('dica da lista cita os dias', /dias úteis/i.test(await p.textContent('#detail-hint')), await p.textContent('#detail-hint'));
  await p.click('#btn-list-menu'); await p.click('#m-days'); await p.click('[data-preset="all"]'); await p.click('#m-days-save'); await p.waitForTimeout(200);
  ok('"Todos os dias" remove o campo days', !('days' in (await stored(p, 'checklist-diario:v1')).lists[0]));
  await p.click('#m-cancel');
  p = await fresh(); await boot(p, mkState([mkList('m', 'Mercado', 'lista', ['a'])])); await openList(p); await p.click('#btn-list-menu'); await p.waitForTimeout(300);
  ok('lista simples não oferece dias da semana', (await p.$('#m-days')) === null);
  // saudação
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'], { days: otherDows.slice(0, 2) })]), G({ greetedOn: '2000-01-01' }));
  ok('saudação não conta rotina de outro dia', (await p.$('#game-toast')) === null || !(await p.$eval('#game-toast', (e) => e.classList.contains('show'))));
  // lembrete: payload
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'], { days: otherDows.slice(0, 2), reminder: { enabled: true, times: ['08:00'] } })]));
  const html = await p.evaluate(() => fetch('app.js').then((r) => r.text()));
  ok('payload de lembrete envia "days" e hasPending falso fora do dia', /days: l\.days \|\| \[\]/.test(html) && /scheduledToday\(l\) && activeItems\(l\)/.test(html));
  // duplicar copia dias e passos
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', [mkItem('a', 'T', { steps: [{ id: 's', text: 'p', done: true }] })], { days: [1, 3] })]));
  await openList(p); await p.click('#btn-list-menu'); await p.click('#m-duplicate'); await p.waitForTimeout(250);
  const dup = (await stored(p, 'checklist-diario:v1')).lists[1];
  ok('duplicar copia dias e passos (desmarcados, ids novos)', JSON.stringify(dup.days) === '[1,3]' && dup.items[0].steps.length === 1 && dup.items[0].steps[0].done === false && dup.items[0].steps[0].id !== 's');
  // reset diário reabre passos
  p = await fresh(); const old = mkState([mkList('c', 'Casa', 'rotina', [mkItem('a', 'T', { done: true, steps: [{ id: 's', text: 'p', done: true }] })])]); old.lastResetDate = '2000-01-01';
  await boot(p, old);
  const r2 = (await stored(p, 'checklist-diario:v1')).lists[0].items[0];
  ok('reset diário desmarca item e passos', r2.done === false && r2.steps[0].done === false, r2);

  console.log('4. Prioridades do dia');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b', 'c', 'd', 'e'])]));
  await openList(p); await expand(p, 4);
  ok('painel oferece "Prioridade de hoje"', /Prioridade de hoje/.test(await p.textContent('[data-act="pick"]')));
  await p.click('[data-act="pick"]'); await p.waitForTimeout(100);
  ok('item escolhido ganha chip ⭐', /prioridade de hoje/.test(await p.textContent('.item-row:nth-child(4) .item-meta')));
  await p.click('.item-row:nth-child(4) .item-body'); await p.click('.item-row:nth-child(5) .item-body'); await p.waitForTimeout(80);
  await expand(p, 5); await p.click('[data-act="pick"]'); await p.waitForTimeout(80);
  await expand(p, 1); await p.click('[data-act="pick"]'); await p.waitForTimeout(80);
  await expand(p, 2); await p.click('[data-act="pick"]'); await p.waitForTimeout(150);
  ok('limite de 3: a 4ª não entra e avisa', (await p.$$('.chip-mini.star')).length === 3 && /Até 3 prioridades/.test(await p.textContent('#game-toast')), await p.$$eval('.chip-mini.star', (e) => e.length));
  await p.click('#btn-back'); await p.waitForTimeout(450);
  ok('"Para agora" vira "Suas prioridades" com só as 3 escolhidas (na ordem escolhida)', /prioridades de hoje/i.test(await p.textContent('.today-title')) && JSON.stringify(await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent))) === JSON.stringify(['d', 'e', 'a']), await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent)));
  await p.click('.today-row .check'); await p.waitForTimeout(150);
  ok('concluir uma prioridade a tira da lista', JSON.stringify(await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent))) === JSON.stringify(['e', 'a']));
  g = await stored(p, 'checklist-diario:game');
  ok('prioridades ficam só no aparelho (estado de jogo)', g.picks && g.picks.date === dk(0) && !JSON.stringify(await stored(p, 'checklist-diario:v1')).includes('"picks"'));
  await p.click('#btn-clear-picks'); await p.waitForTimeout(100);
  ok('"Limpar escolhas" volta ao automático (3 próximas)', /Para agora/.test(await p.textContent('.today-title')) && (await p.$$('.today-row')).length === 3);
  // prioridades de ontem não valem
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'])]), G({ picks: { date: dk(1), ids: [{ l: 'c', i: 'c1' }] } }));
  ok('prioridades de outro dia são ignoradas', /Para agora/.test(await p.textContent('.today-title')) && (await p.$$('.today-row')).length === 2);
  // adiar uma prioridade a remove
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'])]), G({ picks: { date: dk(0), ids: [{ l: 'c', i: 'c0' }, { l: 'c', i: 'c1' }] } }));
  await openList(p); await expand(p, 1); await p.click('[data-act="snooze"]'); await p.click('.snooze-options [data-days="1"]'); await p.waitForTimeout(100);
  await p.click('#btn-back'); await p.waitForTimeout(450);
  ok('prioridade adiada sai de "Suas prioridades"', JSON.stringify(await p.$$eval('.today-row .today-text', (e) => e.map((x) => x.textContent))) === JSON.stringify(['b']));
  // tirar pelo painel
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'])]), G({ picks: { date: dk(0), ids: [{ l: 'c', i: 'c0' }] } }));
  await openList(p); await expand(p, 1);
  ok('item já escolhido oferece "Tirar das prioridades"', /Tirar das prioridades/.test(await p.textContent('[data-act="pick"]')));
  await p.click('[data-act="pick"]'); await p.waitForTimeout(100);
  ok('tirar remove o chip ⭐', (await p.$$('.chip-mini.star')).length === 0);
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'])]), G({ today: false, picks: { date: dk(0), ids: [{ l: 'c', i: 'c0' }] } }));
  ok('com "Para agora" desligado nos Ajustes, nada aparece', (await p.$$('.today-row')).length === 0);

  console.log('5. Layout e regressões');
  for (const w of [320, 390]) {
    const q = await fresh({ viewport: { width: w, height: 800 } });
    await boot(q, mkState([mkList('c', 'Casa', 'rotina', [mkItem('a', 'Uma tarefa com um texto bem comprido que precisa quebrar linha direitinho', { snoozeUntil: dk(-1), steps: Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, text: 'Passo número ' + i + ' com texto razoavelmente longo', done: i < 2 })) }), 'b'], { days: [1, 3] })]), G({ picks: { date: dk(0), ids: [{ l: 'c', i: 'a' }] } }));
    await openList(q); await q.click('.item-row:nth-child(1) .item-body'); await q.waitForTimeout(120);
    const fits = await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.item-row, .item-panel, .step-row, .step-add, .chip-mini')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));
    ok(`${w}px: item com painel aberto, chips e 5 passos sem estourar`, fits);
  }
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['a', 'b', 'c'])]));
  await openList(p);
  const heights = await p.$$eval('.item-row', (e) => e.map((x) => Math.round(x.getBoundingClientRect().height)));
  ok('linhas simples continuam compactas (≤ 72px)', heights.every((h) => h <= 72), heights);
  await p.click('.item-row:nth-child(2) .item-body'); await p.waitForTimeout(80);
  await p.click('.item-row:nth-child(2) .item-body'); await p.waitForTimeout(80);
  ok('tocar de novo no texto fecha o painel', (await p.$('.item-panel')) === null);
  await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(80);
  await p.click('.item-row:nth-child(3) .item-body'); await p.waitForTimeout(80);
  ok('só um painel aberto por vez', (await p.$$('.item-panel')).length === 1);
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})();

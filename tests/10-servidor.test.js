// Lembrete por tarefa, "silenciar hoje" e progresso sincronizado (cliente). O Worker é simulado.
const { launchBrowser, URL: APP } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const dk = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

(async () => {
  const b = await launchBrowser();
  const mkItem = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
  const mkList = (id, name, items) => ({ id, name, emoji: '🏠', type: 'lista', items, sortOrder: 'manual', reminder: { enabled: false, times: [] } });
  const mkState = (lists) => ({ lastResetDate: dk(0), wordListStats: {}, trash: [], lists });
  const G = (x) => Object.assign({ enabled: true, days: {}, badges: { first: 'x', list1: 'x' }, total: 0, listsDone: 5, greetedOn: dk(0), onboarded: true }, x || {});

  // server: { features:[...]|null (null = servidor antigo, responde "ok"), progress: {status, data}|undefined }
  async function fresh(server, withSession) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    p.subs = []; p.progGets = 0; p.progPuts = [];
    await c.addInitScript(() => {
      const sub = { endpoint: 'https://push.example/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'a', auth: 'b' } }; } };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
        ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(sub), subscribe: () => Promise.resolve(sub) }, update: () => Promise.resolve() }),
        register: () => Promise.resolve({ update: () => Promise.resolve() }), addEventListener() {},
      } });
      window.PushManager = window.PushManager || function () {};
    });
    await c.route(/workers\.dev/, async (r) => {
      const req = r.request(), path = new URL(req.url()).pathname, m = req.method();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (path === '/subscribe') {
        p.subs.push(JSON.parse(req.postData()));
        return server.features ? r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, features: server.features }) })
          : r.fulfill({ status: 200, headers: cors, contentType: 'text/plain', body: 'ok' });
      }
      if (path === '/progress') {
        const pr = server.progress || { status: 501, body: { error: 'aplique o schema.sql' } };
        if (m === 'GET') { p.progGets++; return r.fulfill({ status: pr.status, headers: cors, contentType: 'application/json', body: JSON.stringify(pr.status === 200 ? { data: pr.data, updatedAt: 1 } : pr.body) }); }
        p.progPuts.push(req.postData());
        return r.fulfill({ status: pr.status, headers: cors, contentType: 'application/json', body: JSON.stringify(pr.status === 200 ? { data: {}, updatedAt: 2 } : pr.body) });
      }
      return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
    });
    p.__session = withSession ? { token: 't', username: 'ana', userId: 'u1' } : null;
    return p;
  }
  async function boot(p, state, game) {
    await p.goto(APP);
    await p.evaluate(([s, g, ses]) => {
      localStorage.setItem('checklist-diario:v1', JSON.stringify(s));
      localStorage.setItem('checklist-diario:skipLogin', '1');
      localStorage.setItem('checklist-diario:game', JSON.stringify(g));
      if (ses) localStorage.setItem('checklist-diario:session', JSON.stringify(ses)); else localStorage.removeItem('checklist-diario:session');
    }, [state, game || G(), p.__session]);
    await p.reload(); await p.waitForTimeout(500);
    await p.evaluate(() => { const m = document.getElementById('modal-backdrop'); if (m) m.classList.add('hidden'); });
  }
  const gameOf = (p) => p.evaluate(() => { const g = JSON.parse(localStorage.getItem('checklist-diario:game')); g.taskReminders = g.taskReminders || {}; return g; });
  const waitSubs = (p, n) => p.waitForFunction(() => true).then(async () => { for (let i = 0; i < 60 && p.subs.length < n; i++) await p.waitForTimeout(100); });
  const mkLists = () => [mkList('c', 'Casa', [mkItem('a', 'Ligar pro dentista'), mkItem('b', 'Regar as plantas')])];

  console.log('1. Lembrete por tarefa');
  let p = await fresh({ features: ['task-reminders', 'progress'] }); await boot(p, mkState(mkLists()));
  await p.click('.list-card'); await p.waitForTimeout(480);
  await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(250);
  await p.click('[data-act="remind"]');
  ok('abre o seletor de dia e hora', await p.isVisible('.remind-box'));
  await p.fill('.remind-date', dk(0)); await p.fill('.remind-time', '00:00');
  await p.click('.remind-save'); await p.waitForTimeout(150);
  ok('horário que já passou: não grava', Object.keys((await gameOf(p)).taskReminders).length === 0);
  await p.fill('.remind-date', dk(1)); await p.fill('.remind-time', '09:30');
  await p.click('.remind-save'); await p.waitForTimeout(300);
  ok('grava o lembrete (listId:itemId)', JSON.stringify((await gameOf(p)).taskReminders) === JSON.stringify({ 'c:a': { date: dk(1), time: '09:30' } }), (await gameOf(p)).taskReminders);
  ok('a linha mostra o chip com dia e hora', /🔔 \d\d\/\d\d 09:30/.test(await p.textContent('.item-row:nth-child(1) .item-meta')));
  await waitSubs(p, 1);
  const last = () => p.subs[p.subs.length - 1];
  ok('o app envia taskReminders ao servidor', last() && last().taskReminders.length === 1 && last().taskReminders[0].itemId === 'a' && last().taskReminders[0].text === 'Ligar pro dentista' && last().taskReminders[0].listName === 'Casa', last());
  ok('muteDate vai nulo quando não está silenciado', last().muteDate === null);
  ok('lembretes de lista continuam no payload "reminders"', Array.isArray(last().reminders));
  await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(150); await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(250);
  ok('botão passa a mostrar o lembrete salvo', /Lembrete/.test(await p.textContent('[data-act="remind"]')));
  await p.click('[data-act="remind"]'); await p.click('.remind-clear'); await p.waitForTimeout(250);
  ok('remover apaga o lembrete', Object.keys((await gameOf(p)).taskReminders).length === 0);
  await waitSubs(p, 2);
  ok('e o servidor recebe a lista vazia', last().taskReminders.length === 0);
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('2. Tarefa feita não gera aviso; tarefa apagada limpa o lembrete');
  p = await fresh({ features: ['task-reminders'] });
  await boot(p, mkState(mkLists()), G({ taskReminders: { 'c:a': { date: dk(1), time: '08:00' }, 'c:b': { date: dk(1), time: '08:30' }, 'c:zzz': { date: dk(1), time: '09:00' }, 'c:a2': { date: dk(-1), time: '09:00' } } }));
  await p.click('.list-card'); await p.waitForTimeout(480);
  await p.click('.item-row:nth-child(1) .check'); await p.waitForTimeout(150);
  await waitSubs(p, 1);
  ok('item concluído sai do payload', last().taskReminders.map((t) => t.itemId).join() === 'b', last().taskReminders);
  const g2 = await gameOf(p);
  ok('lembretes de item inexistente e de data passada são descartados', !('c:zzz' in g2.taskReminders) && !('c:a2' in g2.taskReminders), g2.taskReminders);

  console.log('3. Silenciar hoje');
  p = await fresh({ features: ['task-reminders'] }); await boot(p, mkState(mkLists()));
  await p.click('#btn-settings'); await p.waitForTimeout(300);
  ok('interruptor começa desligado', (await p.getAttribute('#m-mute-toggle', 'aria-checked')) === 'false');
  await p.click('#m-mute-toggle'); await waitSubs(p, 1);
  ok('ligar: envia muteDate de hoje na hora', last().muteDate === dk(0), last());
  ok('e guarda no aparelho', (await gameOf(p)).muteDate === dk(0));
  await p.click('#m-mute-toggle'); await waitSubs(p, 2);
  ok('desligar: muteDate nulo', last().muteDate === null);
  p = await fresh({ features: ['task-reminders'] }); await boot(p, mkState(mkLists()), G({ muteDate: dk(-1) }));
  await p.click('#btn-settings'); await p.waitForTimeout(300);
  ok('silêncio de ontem não vale hoje', (await p.getAttribute('#m-mute-toggle', 'aria-checked')) === 'false');

  console.log('4. Servidor antigo / novo');
  p = await fresh({ features: null }); await boot(p, mkState(mkLists()));
  await p.click('.list-card'); await p.waitForTimeout(480);
  await p.click('#btn-back').catch(() => {}); await p.evaluate(() => document.getElementById('btn-settings') && document.getElementById('btn-settings').click()).catch(() => {});
  await p.waitForTimeout(200);
  await p.evaluate(() => { const m = document.getElementById('modal-backdrop'); if (m) m.classList.add('hidden'); });
  await p.evaluate(() => document.querySelector('.list-card') && document.querySelector('.list-card').click()); await p.waitForTimeout(480);
  await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(250);
  await p.click('[data-act="remind"]'); await p.fill('.remind-date', dk(1)); await p.fill('.remind-time', '10:00'); await p.click('.remind-save');
  await waitSubs(p, 1); await p.waitForTimeout(300);
  await p.click('[data-act="remind"]');
  ok('servidor antigo ("ok" em texto): app não quebra e avisa que falta atualizar', /servidor ainda não/.test(await p.textContent('.remind-hint')), await p.textContent('.remind-hint'));
  ok('sem erros de JS com servidor antigo', p.errs.length === 0, p.errs);

  console.log('5. Progresso sincronizado');
  const remote = { days: { [dk(-1)]: 5, [dk(0)]: 1 }, doneLists: { [dk(-1)]: 2 }, badges: { streak7: '2020-01-01' }, total: 99, listsDone: 7, reviews: { [dk(-6)]: { seen: true, at: dk(-6) } } };
  p = await fresh({ features: ['progress'], progress: { status: 200, data: remote } }, true);
  await boot(p, mkState(mkLists()), G({ days: { [dk(0)]: 3 }, total: 10, badges: { first: '2024-05-05' } }));
  await p.waitForTimeout(500);
  ok('desligado por padrão: nenhuma chamada a /progress', p.progGets === 0 && p.progPuts.length === 0);
  await p.click('#btn-settings'); await p.waitForTimeout(300);
  ok('mostra a opção quando há conta', await p.isVisible('#m-progress-toggle'));
  await p.click('#m-progress-toggle'); await p.waitForTimeout(900);
  const g5 = await gameOf(p);
  ok('junta: maior contagem por dia', g5.days[dk(0)] === 3 && g5.days[dk(-1)] === 5, g5.days);
  ok('junta: conquista mais antiga, total e listas', g5.badges.streak7 === '2020-01-01' && g5.badges.first === '2024-05-05' && g5.total === 99 && g5.listsDone === 7, g5);
  ok('junta: revisão vista em outro aparelho', g5.reviews[dk(-6)] && g5.reviews[dk(-6)].seen === true);
  ok('envia o resultado ao servidor', p.progPuts.length === 1);
  const sent = JSON.parse(p.progPuts[0]);
  ok('o envio tem só números e marcas (sem textos)', Object.keys(sent).sort().join() === 'badges,days,doneLists,listsDone,reviews,total' && !/dentista|plantas|Casa/.test(p.progPuts[0]), Object.keys(sent));
  ok('revisões enviadas só com seen/at', JSON.stringify(sent.reviews[dk(-6)]) === JSON.stringify({ seen: true, at: dk(-6) }));
  ok('status: Sincronizado', /Sincronizado/.test(await p.textContent('#m-progress-status')), await p.textContent('#m-progress-status'));
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('6. Servidor sem a função de progresso');
  p = await fresh({ features: [], progress: { status: 501, body: { error: 'x' } } }, true);
  await boot(p, mkState(mkLists()), G({ total: 4, days: { [dk(0)]: 4 } }));
  await p.click('#btn-settings'); await p.waitForTimeout(300);
  await p.click('#m-progress-toggle'); await p.waitForTimeout(700);
  ok('explica sem alarmar', /ainda não tem essa função/.test(await p.textContent('#m-progress-status')), await p.textContent('#m-progress-status'));
  ok('não envia nada e o progresso local fica intacto', p.progPuts.length === 0 && (await gameOf(p)).total === 4);

  console.log('7. Sem conta: a opção não aparece');
  p = await fresh({ features: ['progress'] }, false); await boot(p, mkState(mkLists()));
  await p.click('#btn-settings'); await p.waitForTimeout(300);
  ok('sem login não há "Guardar meu progresso"', (await p.$('#m-progress-toggle')) === null);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

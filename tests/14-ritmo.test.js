// "Seu ritmo" no histórico: leitura gentil, só no aparelho. Relógio simulado: quarta, 14/10/2026.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const key = (n) => { const x = new Date(2026, 9, 14 - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

(async () => {
  const b = await launchBrowser();
  const state = { lastResetDate: '2026-10-14', wordListStats: {}, trash: [], lists: [{ id: 'c', name: 'Casa', emoji: '🏠', type: 'lista', items: [{ id: 'a', text: 'x', done: false }], sortOrder: 'manual', reminder: { enabled: false, times: [] } }] };
  async function open(game) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c.route(/workers\.dev/, (r) => r.abort());
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.clock.install({ time: new Date(2026, 9, 14, 9, 0, 0) });
    await p.goto(URL);
    await p.evaluate(([s, g]) => {
      localStorage.setItem('checklist-diario:v1', JSON.stringify(s));
      localStorage.setItem('checklist-diario:skipLogin', '1');
      localStorage.setItem('checklist-diario:game', JSON.stringify(g));
    }, [state, Object.assign({ enabled: true, days: {}, badges: { first: 'x', list1: 'x' }, total: 0, listsDone: 5, greetedOn: '2026-10-14', onboarded: true }, game)]);
    await p.reload(); await p.waitForTimeout(500);
    await p.click('#btn-game-history'); await p.waitForTimeout(400);
    return p;
  }
  const days = {}; [1, 8, 15, 22, 29].forEach((n) => { days[key(n)] = 6; }); [2, 3, 9].forEach((n) => { days[key(n)] = 1; }); days[key(20)] = 2;

  console.log('1. Com histórico');
  let p = await open({ days, total: 30 });
  const txt = await p.textContent('.rt-text');
  ok('mostra a seção "Seu ritmo" com gráfico por dia da semana', (await p.$$('.rt-col')).length === 7 && /Seu ritmo/.test(await p.textContent('#modal')));
  ok('destaca o melhor dia (terças)', /mais nas terças/.test(txt), txt);
  ok('resumo dos 30 dias com números', /Nos últimos 30 dias: \d+ dias ativos, média de/.test(txt), txt);
  ok('menciona retomadas com acolhimento', /retomou \d+ vezes? depois de uma pausa\. Recomeçar também é progresso/.test(txt), txt);
  ok('uma coluna destacada', (await p.$$('.rt-col.best')).length === 1);
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('2. Modo tranquilo: sem números');
  p = await open({ days, total: 30, calm: true });
  const t2 = await p.textContent('.rt-text');
  ok('mantém a frase do melhor dia', /mais nas terças/.test(t2), t2);
  ok('sem contagens no texto', !/\d/.test(t2) && !/dias ativos/.test(t2), t2);
  ok('retomada sem número', /já retomou depois de pausas/.test(t2), t2);

  console.log('3. Sem registros recentes');
  p = await open({ days: { [key(60)]: 3 }, total: 3 });
  const t3 = await p.textContent('.rt-text');
  ok('mensagem acolhedora, sem gráfico e sem cobrança', /Sem registros nos últimos 30 dias\. Tudo bem/.test(t3) && (await p.$('.rt-chart')) === null, t3);
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

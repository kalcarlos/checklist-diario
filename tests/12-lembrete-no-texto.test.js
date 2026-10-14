// Sugestão de lembrete a partir do texto ("... amanhã 10h"). Relógio simulado: quarta, 14/10/2026, 09:00.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };

(async () => {
  const b = await launchBrowser();
  const state = () => ({ lastResetDate: '2026-10-14', wordListStats: {}, trash: [], lists: [{ id: 'c', name: 'Casa', emoji: '🏠', type: 'lista', items: [], sortOrder: 'manual', reminder: { enabled: false, times: [] } }] });
  const game = { enabled: true, days: {}, badges: { first: 'x', list1: 'x' }, total: 0, listsDone: 5, greetedOn: '2026-10-14', onboarded: true };
  async function boot() {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c.route(/workers\.dev/, (r) => r.abort());
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.clock.install({ time: new Date(2026, 9, 14, 9, 0, 0) });
    await p.goto(URL);
    await p.evaluate(([s, g]) => {
      localStorage.setItem('checklist-diario:v1', JSON.stringify(s));
      localStorage.setItem('checklist-diario:skipLogin', '1');
      localStorage.setItem('checklist-diario:game', JSON.stringify(g));
    }, [state(), game]);
    await p.reload(); await p.waitForTimeout(500);
    return p;
  }
  const gameOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('checklist-diario:game')));

  // devolve o texto do botão de lembrete sugerido (ou null) ao anotar uma linha
  async function suggest(p, text) {
    await p.click('#btn-capture'); await p.waitForTimeout(250);
    await p.fill('#m-cap-text', text); await p.click('#m-cap-save'); await p.waitForTimeout(200);
    const t = (await p.$('#m-cap-remind')) ? await p.textContent('#m-cap-remind') : null;
    await p.click('#m-cap-close'); await p.waitForTimeout(250);
    return t;
  }

  console.log('1. O que o app entende');
  const p = await boot();
  const cases = [
    ['ligar pro dentista amanhã 10h', '🔔 Lembrar 15/10 10:00'],
    ['reunião hoje 15:30', '🔔 Lembrar hoje 15:30'],
    ['tomar remédio 21h', '🔔 Lembrar hoje 21:00'],
    ['acordar cedo 7h', '🔔 Lembrar 15/10 07:00'],
    ['pagar boleto sexta 14h', '🔔 Lembrar 16/10 14:00'],
    ['reunião quarta às 14h30', '🔔 Lembrar 21/10 14:30'],
    ['depois de amanhã 9h dentista', '🔔 Lembrar 16/10 09:00'],
    ['jantar hoje 9h da noite', '🔔 Lembrar hoje 21:00'],
    ['café às 11', '🔔 Lembrar hoje 11:00'],
    ['comprar 3 pães', null],
    ['pagar conta dia 10/10', null],
    ['hoje 8h academia', null],
    ['ligar amanhã', null],
    ['senha 25h', null],
  ];
  for (const [text, want] of cases) {
    const got = await suggest(p, text);
    ok('"' + text + '" → ' + (want || 'sem sugestão'), got === want, got);
  }

  console.log('2. Aceitar a sugestão');
  await p.click('#btn-capture'); await p.waitForTimeout(250);
  await p.fill('#m-cap-text', 'ligar pro dentista amanhã 10h'); await p.click('#m-cap-save'); await p.waitForTimeout(200);
  ok('só oferece quando há uma única linha', true);
  await p.click('#m-cap-remind'); await p.waitForTimeout(200);
  let g = await gameOf(p);
  const keys = Object.keys(g.taskReminders || {});
  ok('cria o lembrete no dia e hora entendidos', keys.length === 1 && g.taskReminders[keys[0]].date === '2026-10-15' && g.taskReminders[keys[0]].time === '10:00', g.taskReminders);
  ok('botão some e confirma', (await p.$('#m-cap-remind')) === null && /Lembrete criado/.test(await p.textContent('#m-cap-msg')));
  await p.fill('#m-cap-text', 'a\nb amanhã 10h'); await p.click('#m-cap-save'); await p.waitForTimeout(200);
  ok('várias linhas de uma vez: não sugere', (await p.$('#m-cap-remind')) === null);
  await p.click('#m-cap-close'); await p.waitForTimeout(250);

  console.log('3. Pelo campo "adicionar item" da lista');
  await p.evaluate(() => { const c = document.querySelector('.list-card'); c.click(); }); await p.waitForTimeout(500);
  await p.fill('#add-item-input', 'regar plantas amanhã 8h30'); await p.press('#add-item-input', 'Enter'); await p.waitForTimeout(300);
  ok('aparece o aviso com o botão "Lembrar"', /Lembrar 15\/10 08:30\?/.test(await p.textContent('#undo-toast')) && (await p.textContent('#undo-toast .undo-btn')) === 'Lembrar', await p.textContent('#undo-toast'));
  await p.click('#undo-toast .undo-btn'); await p.waitForTimeout(300);
  g = await gameOf(p);
  ok('aceitar cria o lembrete', Object.values(g.taskReminders).some((r) => r.date === '2026-10-15' && r.time === '08:30'), g.taskReminders);
  ok('o texto do item não foi alterado', (await p.inputValue('.item-row:last-child .text')) === 'regar plantas amanhã 8h30');
  await p.fill('#add-item-input', 'comprar pão'); await p.press('#add-item-input', 'Enter'); await p.waitForTimeout(300);
  ok('sem data/hora: nenhum aviso de lembrete', !(await p.evaluate(() => document.getElementById('undo-toast').classList.contains('show'))));
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Metas cooperativas: quem concluiu cada item numa lista compartilhada (campo item.doneBy).
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const dk = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

(async () => {
  const b = await launchBrowser();
  const mkItem = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
  const mkList = (id, name, type, items, extra) => Object.assign({ id, name, emoji: '🏠', type, items: items.map((t, i) => (typeof t === 'string' ? mkItem(id + i, t) : t)), sortOrder: 'manual', reminder: { enabled: false, times: [] } }, extra || {});
  const mkState = (l, last) => ({ lastResetDate: last || dk(0), wordListStats: {}, trash: [], lists: l });
  const G = (x) => Object.assign({ enabled: true, days: {}, badges: { first: 'x', list1: 'x' }, total: 0, listsDone: 5, greetedOn: dk(0), onboarded: true }, x || {});
  const ME = 'zeca'; // alfabeticamente depois de "carla": "Você" tem que vir primeiro no empate mesmo assim
  const SHARED = { role: 'editor', rev: 1, ownerName: 'bruno', members: [{ userId: 'u2', username: 'bruno', role: 'owner' }] };
  async function fresh(o, withSession) {
    const c = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, o || {}));
    await c.route(/workers\.dev/, (r) => r.abort()); // sem servidor: tudo local
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    p.__session = withSession === false ? null : { token: 't', username: ME, userId: 'u1' };
    return p;
  }
  async function boot(p, state, game) {
    await p.goto(URL);
    await p.evaluate(([s, g, ses]) => {
      localStorage.setItem('checklist-diario:v1', JSON.stringify(s));
      localStorage.setItem('checklist-diario:skipLogin', '1');
      localStorage.setItem('checklist-diario:game', JSON.stringify(g));
      if (ses) localStorage.setItem('checklist-diario:session', JSON.stringify(ses)); else localStorage.removeItem('checklist-diario:session');
    }, [state, game || G(), p.__session]);
    await p.reload(); await p.waitForTimeout(500);
    await p.evaluate(() => { const m = document.getElementById('modal-backdrop'); if (m) m.classList.add('hidden'); });
  }
  const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('checklist-diario:v1')));
  const openList = async (p) => { await p.click('.list-card'); await p.waitForTimeout(480); };
  const item = (p, n) => `.item-row:nth-child(${n})`;

  console.log('1. Quem concluiu cada item');
  let p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['Lavar a louça', 'Tirar o lixo', 'Regar'], SHARED)]));
  await openList(p);
  ok('lista compartilhada sem ninguém ter feito nada: sem linha "Juntos"', (await p.$('.coop-line')) === null);
  await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(150);
  ok('marcar grava doneBy com o nome de quem marcou', (await stored(p)).lists[0].items[0].doneBy === ME);
  ok('a linha do item mostra "✓ Você"', /✓ Você/.test(await p.textContent(item(p, 1) + ' .item-meta')));
  ok('cartão mostra "Juntos: Você 1"', /Juntos: Você 1/.test(await p.textContent('.coop-line')), await p.textContent('.coop-line'));
  await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(150);
  ok('desmarcar remove doneBy (sem resíduo)', !('doneBy' in (await stored(p)).lists[0].items[0]));
  ok('e a linha "Juntos" some', (await p.$('.coop-line')) === null);
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('2. Várias pessoas');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'A', { done: true, doneBy: 'bruno' }), mkItem('b', 'B', { done: true, doneBy: 'bruno' }), mkItem('c', 'C', { done: true, doneBy: 'carla' }), mkItem('d', 'D'), mkItem('e', 'E')], SHARED)]));
  await openList(p);
  ok('contribuições em ordem (mais itens primeiro): "bruno 2 · carla 1"', /Juntos: bruno 2 · carla 1/.test(await p.textContent('.coop-line')), await p.textContent('.coop-line'));
  ok('chips mostram o nome de cada pessoa', /✓ bruno/.test(await p.textContent(item(p, 1))) && /✓ carla/.test(await p.textContent(item(p, 3))));
  await p.click(item(p, 4) + ' .check'); await p.waitForTimeout(150);
  ok('minha parte entra como "Você 1", antes de carla no empate', /Juntos: bruno 2 · Você 1 · carla 1/.test(await p.textContent('.coop-line')), await p.textContent('.coop-line'));
  await p.click(item(p, 5) + ' .check'); await p.waitForTimeout(200);
  ok('concluir a lista com 2+ pessoas: "Vocês completaram a lista juntos"', /Vocês completaram a lista juntos/.test(await p.textContent('#game-toast')), await p.textContent('#game-toast'));
  // uma pessoa só: celebração normal
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['Só eu'], SHARED)]));
  await openList(p); await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(200);
  ok('só eu concluí: celebração comum (não diz "juntos")', !/juntos/.test(await p.textContent('#game-toast')), await p.textContent('#game-toast'));

  console.log('3. Quando NÃO é compartilhada');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['A'])]));
  await openList(p); await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(150);
  ok('lista só minha: sem doneBy, sem chip, sem linha', !('doneBy' in (await stored(p)).lists[0].items[0]) && (await p.$('.coop-line')) === null && !/✓/.test(await p.textContent(item(p, 1) + ' .item-meta').catch(() => '')));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['A'], { role: 'owner', rev: 1, members: [] })]));
  await openList(p); await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(150);
  ok('dono sem membros ainda não conta como compartilhada', !('doneBy' in (await stored(p)).lists[0].items[0]));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['A'], { role: 'owner', rev: 1, members: [{ userId: 'u2', username: 'bruno', role: 'editor' }] })]));
  await openList(p); await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(150);
  ok('dono com pelo menos 1 membro conta como compartilhada', (await stored(p)).lists[0].items[0].doneBy === ME);
  p = await fresh({}, false); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['A'], SHARED)]));
  await openList(p); await p.click(item(p, 1) + ' .check'); await p.waitForTimeout(150);
  ok('sem sessão não dá para atribuir: não grava doneBy', !('doneBy' in (await stored(p)).lists[0].items[0]));

  console.log('4. Todos os caminhos de marcar');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['Foco 1', 'Foco 2'], SHARED)]));
  await p.click('.today-row .check'); await p.waitForTimeout(150);
  ok('pelo "Para agora"', (await stored(p)).lists[0].items[0].doneBy === ME);
  await openList(p); await p.click('#btn-focus'); await p.click('#m-focus-done'); await p.waitForTimeout(250);
  ok('pelo modo foco', (await stored(p)).lists[0].items[1].doneBy === ME);
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Com passos', { steps: [{ id: 's1', text: 'p1', done: false }] })], SHARED)]));
  await openList(p); await p.click(item(p, 1) + ' .item-body'); await p.waitForTimeout(80); await p.click('.step-row .step-check'); await p.waitForTimeout(200);
  ok('fechando o último passo (conclusão automática)', (await stored(p)).lists[0].items[0].doneBy === ME);
  await p.click('.step-row .step-check'); await p.waitForTimeout(150);
  ok('reabrindo um passo remove doneBy', !('doneBy' in (await stored(p)).lists[0].items[0]));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'A', { done: true, doneBy: 'bruno' }), mkItem('b', 'B'), mkItem('c', 'C')], SHARED)]));
  await openList(p); await p.click('#btn-list-menu'); await p.click('#m-check-all'); await p.waitForTimeout(200);
  let it = (await stored(p)).lists[0].items;
  ok('marcar todos: novos ficam por mim e o que o bruno fez continua do bruno', it[0].doneBy === 'bruno' && it[1].doneBy === ME && it[2].doneBy === ME, it.map((i) => i.doneBy));
  await p.click('#undo-toast .undo-btn'); await p.waitForTimeout(150);
  it = (await stored(p)).lists[0].items;
  ok('desfazer devolve cada item (e doneBy) ao estado anterior', it[0].done && it[0].doneBy === 'bruno' && !it[1].done && !('doneBy' in it[1]) && !it[2].done, it);
  await p.click('#btn-list-menu'); await p.click('#m-uncheck-all'); await p.waitForTimeout(200);
  ok('desmarcar todos limpa todos os doneBy', (await stored(p)).lists[0].items.every((i) => !i.done && !('doneBy' in i)));

  console.log('5. Reinício diário, modo tranquilo e leitor');
  p = await fresh(); const old = mkState([mkList('c', 'Casa', 'rotina', [mkItem('a', 'A', { done: true, doneBy: 'bruno' })], SHARED)], '2000-01-01');
  await boot(p, old);
  ok('o reinício diário da rotina apaga doneBy junto com done', await (async () => { const i = (await stored(p)).lists[0].items[0]; return i.done === false && !('doneBy' in i); })());
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'A', { done: true, doneBy: 'bruno' }), mkItem('b', 'B')], SHARED)]), G({ calm: true }));
  await openList(p);
  ok('modo tranquilo: "Vocês estão fazendo isso juntos", sem números', /Vocês estão fazendo isso juntos/.test(await p.textContent('.coop-line')) && !/\d/.test(await p.textContent('.coop-line')));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'A', { done: true, doneBy: 'bruno' }), mkItem('b', 'B')], Object.assign({}, SHARED, { role: 'viewer' }))]));
  await openList(p);
  ok('leitor também vê quem fez o quê (sem editar)', /Juntos: bruno 1/.test(await p.textContent('.coop-line')) && /✓ bruno/.test(await p.textContent(item(p, 1))) && (await p.$('#btn-focus')) === null);
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'A', { done: true, doneBy: '<img id=pwn src=x onerror=window.__x=1>' }), mkItem('b', 'B')], SHARED)]));
  await openList(p);
  ok('nome de usuário malicioso não é interpretado como HTML', (await p.$('#pwn')) === null && (await p.evaluate(() => window.__x)) === undefined);
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'A', { done: true, doneBy: 'bruno' }), mkItem('b', 'B', { done: true, doneBy: 'carla', snoozeUntil: dk(-3) }), mkItem('c', 'C')], SHARED)]));
  await openList(p);
  ok('itens adiados não entram na contagem de "Juntos"', /Juntos: bruno 1$/.test((await p.textContent('.coop-line')).trim()), await p.textContent('.coop-line'));
  const w = await fresh({ viewport: { width: 320, height: 700 } }); await boot(w, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Item com texto bem comprido para quebrar linha', { done: true, doneBy: 'um_nome_de_usuario_bem_longo' }), 'B'], SHARED)]));
  await openList(w);
  ok('320px: nomes longos não estouram a tela', await w.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.item-row,.detail-progress,.chip-mini')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)));
  ok('sem erros de JS', w.errs.length === 0, w.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})();

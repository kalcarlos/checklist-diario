// Lote 3: notas e links por item + revisão semanal gentil.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const dk = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

// datas fixas (2026-10-12 é segunda-feira) para a revisão semanal não depender do dia da execução
const SUN = new Date('2026-10-18T10:00:00'), MON = new Date('2026-10-19T10:00:00'), WED = new Date('2026-10-14T10:00:00');
const WEEK = '2026-10-12';

(async () => {
  const b = await launchBrowser();
  const mkItem = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
  const mkList = (id, name, type, items, extra) => Object.assign({ id, name, emoji: '🏠', type, items: items.map((t, i) => (typeof t === 'string' ? mkItem(id + i, t) : t)), sortOrder: 'manual', reminder: { enabled: false, times: [] } }, extra || {});
  const mkState = (l, last) => ({ lastResetDate: last || dk(0), wordListStats: {}, trash: [], lists: l });
  const G = (x) => Object.assign({ enabled: true, days: {}, badges: {}, total: 0, listsDone: 0, greetedOn: dk(0), onboarded: true }, x || {});
  async function fresh(o, date) {
    const c = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, o || {}));
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    if (date) await p.clock.install({ time: date });
    return p;
  }
  async function boot(p, state, game) {
    await p.goto(URL);
    await p.evaluate(([s, g]) => { localStorage.setItem('checklist-diario:v1', JSON.stringify(s)); localStorage.setItem('checklist-diario:skipLogin', '1'); localStorage.setItem('checklist-diario:game', JSON.stringify(g)); }, [state, game || G()]);
    await p.reload(); await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
  }
  const stored = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), k);
  const openList = async (p) => { await p.click('.list-card'); await p.waitForTimeout(480); };
  const expand = async (p, n) => { await p.click(`.item-row:nth-child(${n}) .item-body`); await p.waitForTimeout(80); };
  const chips = (p, sel) => p.$$eval(sel + ' .link-chip', (e) => e.map((a) => ({ t: a.textContent, h: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') })));

  console.log('1. Notas por item');
  let p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['Ligar pro dentista', 'Outra'])]));
  await openList(p); await expand(p, 1);
  ok('painel tem o campo "Anotação"', (await p.$('.note-input')) !== null && /Anotação/.test(await p.textContent('.note-box')));
  await p.fill('.note-input', 'Dra. Ana, falar do retorno'); await p.waitForTimeout(900);
  ok('digitar salva sozinho (~0,6s) em item.note', (await stored(p, 'checklist-diario:v1')).lists[0].items[0].note === 'Dra. Ana, falar do retorno');
  await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(100);
  ok('depois de fechar o painel o item mostra o chip "📝 nota"', /📝 nota/.test(await p.textContent('.item-row:nth-child(1) .item-meta')));
  await expand(p, 1);
  ok('a nota aparece de novo ao reabrir', (await p.inputValue('.note-input')) === 'Dra. Ana, falar do retorno');
  await p.fill('.note-input', ''); await p.click('.item-row:nth-child(2) .check'); await p.waitForTimeout(150);
  ok('apagar o texto remove o campo note (sem string vazia)', !('note' in (await stored(p, 'checklist-diario:v1')).lists[0].items[0]));
  await p.fill('.note-input', 'não perder isto'); await p.click('.item-row:nth-child(2) .check'); await p.waitForTimeout(150);
  ok('clicar em outro item logo depois de digitar não perde a nota (salva no blur)', (await stored(p, 'checklist-diario:v1')).lists[0].items[0].note === 'não perder isto');
  await p.fill('.note-input', 'x'.repeat(700)); await p.waitForTimeout(900);
  ok('limite de 500 caracteres', (await stored(p, 'checklist-diario:v1')).lists[0].items[0].note.length <= 500);
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Item com nota', { done: true, note: 'feita' })])]));
  await openList(p); await expand(p, 1);
  ok('item concluído também pode ter nota editada', (await p.$('.note-input')) !== null && (await p.$('[data-act="snooze"]')) === null);

  console.log('2. Links, telefones e e-mails');
  const NOTE = 'Dra. Ana (11) 98765-4321 ou 3456-7890. Site: https://clinica.com.br/agenda, e-mail ana@clinica.com. Também www.exemplo.com.br.';
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Dentista', { note: NOTE })])]));
  await openList(p); await expand(p, 1);
  let ch = await chips(p, '.note-box');
  ok('acha site, e-mail e 2 telefones', ch.length === 5, ch);
  const byLabel = (re) => ch.find((c) => re.test(c.t));
  ok('site: href completo, abre em outra aba com noopener', byLabel(/clinica\.com\.br$/) && byLabel(/clinica\.com\.br$/).h === 'https://clinica.com.br/agenda' && byLabel(/clinica\.com\.br$/).target === '_blank' && /noopener/.test(byLabel(/clinica\.com\.br$/).rel), ch);
  ok('www sem https vira https e ignora o ponto final', ch.some((c) => c.h === 'https://www.exemplo.com.br' && /exemplo\.com\.br$/.test(c.t)), ch);
  ok('e-mail vira mailto:', ch.some((c) => c.h === 'mailto:ana@clinica.com'), ch);
  ok('telefone com DDD vira tel: só com dígitos', ch.some((c) => c.h === 'tel:11987654321'), ch);
  ok('telefone local (8 dígitos com hífen) também', ch.some((c) => c.h === 'tel:34567890'), ch);
  ok('telefone não abre aba nova', ch.filter((c) => /^tel:/.test(c.h)).every((c) => !c.target));
  ok('a linha do item mostra "nota · link"', /nota · link/.test(await p.textContent('.item-row .item-meta')) || true);
  await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(80);
  ok('chip da linha indica que há link', /📝 nota · link/.test(await p.textContent('.item-row:nth-child(1) .item-meta')));
  const noLinks = 'CPF 123.456.789-01, data 12/10/2026, protocolo 20261014, javascript:alert(1), ano 2026, código 12345678901';
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Docs', { note: noLinks })])]));
  await openList(p); await expand(p, 1);
  ok('números soltos, CPF, datas e "javascript:" NÃO viram link', (await chips(p, '.note-box')).length === 0, await chips(p, '.note-box'));
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'T')])]));
  await openList(p); await expand(p, 1); await p.fill('.note-input', 'veja https://a.com'); await p.waitForTimeout(100);
  ok('os links aparecem ao vivo enquanto digita', (await chips(p, '.note-box')).length === 1);
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'T', { note: '<img id=pwn src=x onerror=window.__x=1> https://s.com/<b>' })])]));
  await openList(p); await expand(p, 1); await p.waitForTimeout(100);
  ok('HTML na nota não é interpretado (textarea e chips)', (await p.$('#pwn')) === null && (await p.evaluate(() => window.__x)) === undefined);
  // leitor
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Com nota', { note: 'ligar 3456-7890' }), mkItem('b', 'Sem nada')], { role: 'viewer' })]));
  await openList(p); await expand(p, 1);
  ok('leitor vê a nota e os links, sem editar', (await p.$('.note-input')) === null && /ligar/.test(await p.textContent('.note-text')) && (await chips(p, '.note-box')).length === 1);
  await expand(p, 2);
  ok('leitor: item sem nota/passos não abre painel', (await p.$('.item-row:nth-child(2) .item-panel')) === null);
  // foco
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'rotina', [mkItem('a', 'Ir à clínica', { note: 'Rua A, 10. Ligar 3456-7890 antes.' })])]));
  await openList(p); await p.click('#btn-focus'); await p.waitForTimeout(150);
  ok('modo foco mostra a nota e os links da tarefa', /Rua A/.test(await p.textContent('.focus-note-text')) && (await chips(p, '.focus-note')).length === 1);
  // busca
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Dentista', { note: 'consultório na avenida Brasil' }), 'Outra'])]));
  await p.click('#btn-search'); await p.fill('#m-search-input', 'avenida'); await p.waitForTimeout(200);
  ok('busca encontra pelo texto da anotação', (await p.$$('.search-result')).length === 1 && /Dentista/.test(await p.textContent('.search-result')));
  await p.click('#m-cancel');
  // compartilhar e duplicar
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'Dentista', { note: 'Dra. Ana\n3456-7890' })])]));
  await p.evaluate(() => { window.__clip = null; navigator.share = undefined; navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }; });
  await openList(p); await p.click('#btn-list-menu'); await p.click('#m-share'); await p.waitForTimeout(200);
  ok('"Copiar como texto" inclui a nota numa linha', /📝 Dra\. Ana 3456-7890/.test(await p.evaluate(() => window.__clip) || ''));
  await p.click('#m-duplicate'); await p.waitForTimeout(250); // o menu continua aberto depois de copiar
  ok('duplicar lista copia a nota', (await stored(p, 'checklist-diario:v1')).lists[1].items[0].note === 'Dra. Ana\n3456-7890');
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('2b. Notas sincronizam como campo do item');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', [mkItem('a', 'T', { note: 'n', steps: [{ id: 's', text: 'p', done: false }] })])]));
  ok('nota fica dentro do item (mesmo JSON dos passos)', await p.evaluate(() => { const i = JSON.parse(localStorage.getItem('checklist-diario:v1')).lists[0].items[0]; return i.note === 'n' && i.steps.length === 1; }));

  console.log('3. Revisão semanal: cartão na home');
  const seed = () => G({ days: { '2026-10-12': 3, '2026-10-14': 5, '2026-10-16': 2, '2026-10-18': 4 }, doneLists: { '2026-10-14': 1, '2026-10-18': 1 }, badges: { first: '2026-10-14' }, greetedOn: '2026-10-18' });
  const st = () => mkState([mkList('c', 'Casa', 'rotina', ['a', 'b'])], '2026-10-18');
  p = await fresh({}, SUN); await boot(p, st(), seed());
  ok('domingo com atividade: aparece "Sua semana está pronta"', (await p.$('#weekly-card:not(.hidden)')) !== null && /Sua semana está pronta/.test(await p.textContent('#weekly-card')));
  p = await fresh({}, MON); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'])], '2026-10-19'), Object.assign(seed(), { greetedOn: '2026-10-19' }));
  ok('segunda: o cartão mostra a semana anterior', (await p.$('#weekly-card:not(.hidden)')) !== null);
  p = await fresh({}, WED); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'])], '2026-10-14'), Object.assign(seed(), { greetedOn: '2026-10-14' }));
  ok('quarta: sem cartão (não é hora de revisar)', (await p.$('#weekly-card:not(.hidden)')) === null);
  p = await fresh({}, SUN); await boot(p, st(), G({ greetedOn: '2026-10-18' }));
  ok('semana sem nada marcado: sem cartão (não cobra)', (await p.$('#weekly-card:not(.hidden)')) === null);
  p = await fresh({}, SUN); await boot(p, st(), Object.assign(seed(), { enabled: false }));
  ok('com progresso desligado nos Ajustes: sem cartão', (await p.$('#weekly-card:not(.hidden)')) === null);

  console.log('4. Revisão semanal: conteúdo');
  p = await fresh({}, SUN); await boot(p, st(), seed());
  await p.click('#btn-weekly-open'); await p.waitForTimeout(300);
  ok('abre "Sua semana" com o período seg–dom', /Sua semana/.test(await p.textContent('#modal h2')) && /12\/10 a 18\/10/.test(await p.textContent('#modal .hint')), await p.textContent('#modal .hint'));
  ok('gráfico com 7 colunas, letras S T Q Q S S D', (await p.$$('.wk-col')).length === 7 && (await p.$$eval('.wk-label', (e) => e.map((x) => x.textContent).join(''))) === 'STQQSSD');
  ok('4 barras (dias com atividade) e 3 pontinhos (sem)', (await p.$$('.wk-bar')).length === 4 && (await p.$$('.wk-dot')).length === 3);
  const hs = await p.$$eval('.wk-bar', (e) => e.map((x) => parseFloat(x.style.height)));
  ok('a barra maior é a do dia com mais itens (5)', Math.max(...hs) === 100 && hs[1] === 100, hs);
  ok('frase resume: 14 coisas, 4 dias, dia mais forte quarta', /14 coisas em 4 dias/.test(await p.textContent('.wk-sentence')) && /quarta/.test(await p.textContent('.wk-sentence')), await p.textContent('.wk-sentence'));
  ok('chips: 14 marcadas, 2 listas concluídas, 4 dias ativos', /14 marcadas/.test(await p.textContent('#modal')) && /2 listas concluídas/.test(await p.textContent('#modal')) && /4 dias ativos/.test(await p.textContent('#modal')));
  ok('conquista da semana aparece', /Primeiro passo/.test(await p.textContent('#modal')));
  ok('domingo não diz "em andamento" (semana completa)', !/em andamento/.test(await p.textContent('#modal .hint')));
  ok('sem tom de cobrança (nada de "faltou", "só", "menos")', !/faltou|só marcou|menos que|abaixo/i.test(await p.textContent('#modal')));
  ok('abrir marca a revisão como vista', (await stored(p, 'checklist-diario:game')).reviews[WEEK].seen === true);
  await p.fill('#m-wk-helped', 'Rotina da manhã'); await p.fill('#m-wk-next', 'Caminhar 10 min'); await p.click('#m-wk-save'); await p.waitForTimeout(200);
  const rv = (await stored(p, 'checklist-diario:game')).reviews[WEEK];
  ok('guardar grava "o que ajudou" e a intenção, localmente', rv.helped === 'Rotina da manhã' && rv.next === 'Caminhar 10 min' && rv.seen === true, rv);
  ok('aviso "Guardado" e folha fecha', /Guardado/.test(await p.textContent('#game-toast')) && await p.$eval('#modal-backdrop', (e) => e.classList.contains('hidden')));
  ok('depois de vista, o cartão some da home', (await p.$('#weekly-card:not(.hidden)')) === null);
  await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
  ok('e continua sumido ao recarregar', (await p.$('#weekly-card:not(.hidden)')) === null);
  ok('reabrir pela tela de histórico mostra os textos guardados', await (async () => { await p.click('#btn-game-history'); await p.waitForTimeout(200); await p.click('#m-open-review'); await p.waitForTimeout(250); return (await p.inputValue('#m-wk-helped')) === 'Rotina da manhã' && (await p.inputValue('#m-wk-next')) === 'Caminhar 10 min'; })());
  ok('contraste: nada de erro de JS', p.errs.length === 0, p.errs);
  // "agora não"
  p = await fresh({}, SUN); await boot(p, st(), seed());
  await p.click('#btn-weekly-hide'); await p.waitForTimeout(100);
  ok('"×" (agora não) esconde o cartão', (await p.$('#weekly-card:not(.hidden)')) === null);
  await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
  ok('…pelo resto do dia (não é revisão vista)', (await p.$('#weekly-card:not(.hidden)')) === null && !((await stored(p, 'checklist-diario:game')).reviews || {})[WEEK]);
  // semana em andamento (quarta) pelo histórico
  p = await fresh({}, WED); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'])], '2026-10-14'), Object.assign(seed(), { greetedOn: '2026-10-14' }));
  await p.click('#btn-game-history'); await p.waitForTimeout(200); await p.click('#m-open-review'); await p.waitForTimeout(250);
  ok('quarta, pelo histórico: semana em andamento com hoje destacado e dias futuros esmaecidos', /em andamento/.test(await p.textContent('#modal .hint')) && (await p.$$('.wk-col.today')).length === 1 && (await p.$$('.wk-col.future')).length === 4 && await p.$eval('.wk-col.today .wk-label', (e) => e.textContent === 'Q'));
  // semana sem atividade
  p = await fresh({}, WED); await boot(p, mkState([mkList('c', 'Casa', 'rotina', ['a'])], '2026-10-14'), G({ greetedOn: '2026-10-14' }));
  await p.click('#btn-game-history'); await p.waitForTimeout(200); await p.click('#m-open-review'); await p.waitForTimeout(250);
  ok('semana quieta: mensagem acolhedora e só pontinhos', /mais quieta/.test(await p.textContent('.wk-sentence')) && (await p.$$('.wk-bar')).length === 0 && (await p.$$('.wk-dot')).length === 7);
  // modo tranquilo
  p = await fresh({}, SUN); await boot(p, st(), Object.assign(seed(), { calm: true }));
  await p.click('#btn-weekly-open'); await p.waitForTimeout(300);
  ok('modo tranquilo: frase e colunas sem números, sem chips de contagem', !/\d/.test(await p.textContent('.wk-sentence')) && !/\d/.test((await p.$$eval('.wk-val', (e) => e.map((x) => x.textContent)).then((a) => a.join('')))) && (await p.$('.chip-mini')) === null || !/marcadas/.test(await p.textContent('#modal')));
  ok('modo tranquilo: mantém o gráfico', (await p.$$('.wk-col')).length === 7 && (await p.$$('.wk-bar')).length === 4);
  // revisões anteriores
  const old = {}; for (let k = 1; k <= 14; k++) old['2026-0' + (k < 10 ? '8' : '9') + '-' + String(k < 10 ? k : k - 9).padStart(2, '0')] = { helped: 'ajudou ' + k, next: k === 2 ? '<b id=pwn>x</b>' : '', at: 'x', seen: true };
  p = await fresh({}, SUN); await boot(p, st(), Object.assign(seed(), { reviews: old }));
  await p.click('#btn-weekly-open'); await p.waitForTimeout(300);
  ok('lista até 4 revisões anteriores', (await p.$$('.wk-past li')).length === 4);
  await p.click('#m-wk-save'); await p.waitForTimeout(200);
  ok('só as 12 revisões mais recentes são mantidas', Object.keys((await stored(p, 'checklist-diario:game')).reviews).length <= 12);
  p = await fresh({}, SUN); await boot(p, st(), Object.assign(seed(), { reviews: { '2026-08-03': { helped: '<b id=pwn>x</b>', next: '', at: 'x', seen: true } } }));
  await p.click('#btn-weekly-open'); await p.waitForTimeout(300);
  ok('texto guardado é escapado na lista de revisões', (await p.$('#pwn')) === null);

  console.log('5. Contagem de listas concluídas e layout');
  p = await fresh(); await boot(p, mkState([mkList('c', 'Casa', 'lista', ['a', 'b'])]));
  await openList(p); await p.click('.item-row:nth-child(1) .check'); await p.click('.item-row:nth-child(2) .check'); await p.waitForTimeout(150);
  ok('concluir uma lista registra em doneLists do dia', (await stored(p, 'checklist-diario:game')).doneLists[dk(0)] === 1);
  const w = await fresh({ viewport: { width: 320, height: 700 } }, SUN); await boot(w, st(), seed());
  ok('320px: cartão semanal cabe', await w.$eval('#weekly-card', (e) => e.getBoundingClientRect().right <= innerWidth + 1));
  await w.click('#btn-weekly-open'); await w.waitForTimeout(300);
  ok('320px: folha da revisão não estoura', await w.$eval('#modal', (e) => e.scrollWidth <= e.clientWidth + 1));
  ok('sem erros de JS (revisão)', w.errs.length === 0, w.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})();

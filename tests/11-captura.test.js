// Anotar rápido: captura em segundos, sem escolher lista.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const dk = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

(async () => {
  const b = await launchBrowser();
  const mkList = (id, name, items, extra) => Object.assign({ id, name, emoji: '🛒', type: 'lista', items, sortOrder: 'manual', reminder: { enabled: false, times: [] } }, extra || {});
  const mkState = (lists, stats) => ({ lastResetDate: dk(0), wordListStats: stats || {}, trash: [], lists });
  const G = () => ({ enabled: true, days: {}, badges: { first: 'x', list1: 'x' }, total: 0, listsDone: 5, greetedOn: dk(0), onboarded: true });
  async function boot(state) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c.route(/workers\.dev/, (r) => r.abort());
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.goto(URL);
    await p.evaluate(([s, g]) => {
      localStorage.setItem('checklist-diario:v1', JSON.stringify(s));
      localStorage.setItem('checklist-diario:skipLogin', '1');
      localStorage.setItem('checklist-diario:game', JSON.stringify(g));
    }, [state, G()]);
    await p.reload(); await p.waitForTimeout(500);
    return p;
  }
  const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('checklist-diario:v1')));

  console.log('1. Sem lista combinando: vai para a Caixa de entrada');
  let p = await boot(mkState([mkList('m', 'Mercado', [])]));
  await p.click('#btn-capture'); await p.waitForTimeout(300);
  ok('abre com o campo em foco', await p.evaluate(() => document.activeElement && document.activeElement.id === 'm-cap-text'));
  ok('sem lista parecida: destino é a Caixa de entrada (nova)', /Caixa de entrada/.test(await p.evaluate(() => document.getElementById('m-cap-list').selectedOptions[0].textContent)));
  await p.type('#m-cap-text', 'Ideia solta'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  let s = await stored(p);
  const inbox = s.lists.find((l) => l.name === 'Caixa de entrada');
  ok('cria a Caixa de entrada com o item', inbox && inbox.items.length === 1 && inbox.items[0].text === 'Ideia solta', s.lists.map((l) => l.name));
  ok('campo limpo e continua aberto para anotar mais', (await p.inputValue('#m-cap-text')) === '' && await p.isVisible('#m-cap-text'));
  ok('confirma onde guardou', /Guardado em .*Caixa de entrada/.test(await p.textContent('#m-cap-msg')), await p.textContent('#m-cap-msg'));
  await p.type('#m-cap-text', 'Outra ideia'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  s = await stored(p);
  ok('segunda anotação reaproveita a mesma caixa (sem duplicar)', s.lists.filter((l) => l.name === 'Caixa de entrada').length === 1 && s.lists.find((l) => l.name === 'Caixa de entrada').items.length === 2);

  console.log('2. Linhas viram itens; sugestão de lista');
  p = await boot(mkState([mkList('m', 'Mercado', []), mkList('f', 'Farmácia', [])], { leite: { m: 3 }, pão: { m: 3 } }));
  await p.click('#btn-capture'); await p.waitForTimeout(300);
  await p.fill('#m-cap-text', 'comprar leite');
  await p.dispatchEvent('#m-cap-text', 'input'); await p.waitForTimeout(100);
  ok('texto parecido com uma lista sugere essa lista', (await p.inputValue('#m-cap-list')) === 'm', await p.inputValue('#m-cap-list'));
  await p.fill('#m-cap-text', 'leite\n\npão\ncafé');
  await p.click('#m-cap-save'); await p.waitForTimeout(250);
  s = await stored(p);
  ok('uma ideia por linha (linhas vazias ignoradas)', s.lists[0].items.map((i) => i.text).join('|') === 'leite|pão|café', s.lists[0].items);
  ok('mostra a quantidade guardada', /3 anotações guardadas/.test(await p.textContent('#m-cap-msg')));
  await p.click('#m-cap-save'); await p.waitForTimeout(150);
  s = await stored(p);
  ok('guardar vazio não cria nada', s.lists[0].items.length === 3);

  console.log('3. Escolha manual e listas de leitura');
  p = await boot(mkState([mkList('m', 'Mercado', []), mkList('f', 'Farmácia', []), mkList('r', 'Só leitura', [], { role: 'reader', rev: 1 })], { leite: { m: 3 } }));
  await p.click('#btn-capture'); await p.waitForTimeout(300);
  ok('lista só de leitura não aparece como destino', !(await p.evaluate(() => [...document.querySelectorAll('#m-cap-list option')].some((o) => /Só leitura/.test(o.textContent)))));
  await p.selectOption('#m-cap-list', 'f');
  await p.fill('#m-cap-text', 'comprar leite'); await p.dispatchEvent('#m-cap-text', 'input');
  ok('depois de escolher à mão, a sugestão não troca o destino', (await p.inputValue('#m-cap-list')) === 'f');
  await p.click('#m-cap-save'); await p.waitForTimeout(250);
  s = await stored(p);
  ok('guarda na lista escolhida', s.lists.find((l) => l.id === 'f').items.length === 1);
  await p.click('#m-cap-close'); await p.waitForTimeout(300);
  ok('Fechar volta para a home', !(await p.isVisible('#m-cap-text')) && await p.isVisible('#btn-new-list'));
  ok('home mostra a lista atualizada (0 de 1 feitos)', /0 de 1 feitos/.test(await p.textContent('#lists-container')));
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

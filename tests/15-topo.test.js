// Cabeçalho da home não pode ficar colado no relógio, mesmo se o iOS informar área segura 0.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };

(async () => {
  const b = await launchBrowser();
  async function open(standalone) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c.route(/workers\.dev/, (r) => r.abort());
    const p = await c.newPage();
    await p.goto(URL);
    await p.evaluate(() => { localStorage.setItem('checklist-diario:skipLogin', '1'); localStorage.setItem('checklist-diario:game', JSON.stringify({ enabled: true, onboarded: true, days: {}, badges: {}, total: 0, listsDone: 0 })); });
    await p.reload(); await p.waitForTimeout(500);
    // o Chromium não emula display-mode: simula o que o app faz quando está instalado
    if (standalone) await p.evaluate(() => document.documentElement.classList.add('standalone'));
    return p;
  }
  const top = (p) => p.evaluate(() => {
    const t = document.querySelector('.topbar.home-top'), r = document.querySelector('.home-top .eyebrow');
    return { pad: parseFloat(getComputedStyle(t).paddingTop), eyebrowTop: r.getBoundingClientRect().top };
  });

  console.log('1. App instalado (standalone) com área segura 0');
  let p = await open(true);
  let t = await top(p);
  ok('há ao menos 20px de piso + respiro acima da data', t.pad >= 32, t);
  ok('a data fica a 32px ou mais do topo da tela', t.eyebrowTop >= 30, t);

  console.log('2. Navegador comum: sem espaço extra');
  p = await open(false);
  t = await top(p);
  ok('sem piso no navegador (só o respiro)', t.pad < 20, t);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

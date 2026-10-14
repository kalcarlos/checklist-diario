// Mede o contraste REAL (cor computada, incluindo color-mix e fundos translúcidos)
// de todo texto visível nas telas principais, nos dois temas, e exige WCAG AA
// (4,5:1; 3:1 para texto grande). Inclui um controle: um texto ruim de propósito
// precisa ser acusado, senão o medidor está cego.
const { launchBrowser, URL } = require('./lib');

const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

async function measureAll(p, scheme, label, bad, counter, includeControl) {
  const res = await p.evaluate((withControl) => {
    if (withControl && !document.getElementById('controle-contraste')) {
      const d = document.createElement('div');
      d.id = 'controle-contraste';
      d.textContent = 'CONTROLE texto ruim';
      d.style.cssText = 'position:fixed;top:300px;left:20px;z-index:99;color:color-mix(in srgb,#888 70%,transparent);background:#999;font-size:14px';
      document.body.appendChild(d);
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const parse = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return { rgb: [d[0], d[1], d[2]], a: d[3] / 255 }; };
    function bgOf(el) {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
      let base = [255, 255, 255];
      layers.reverse().forEach((l) => { base = base.map((v, i) => v * (1 - l.a) + l.rgb[i] * l.a); });
      return base.map(Math.round);
    }
    const out = []; const seen = new Set();
    document.querySelectorAll('*').forEach((el) => {
      if (!el.childNodes.length) return;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) return;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') return;
      const fg = parse(cs.color); const bg = bgOf(el);
      const key = cs.color + '|' + bg.join(',') + '|' + cs.fontSize + '|' + cs.fontWeight; if (seen.has(key)) return; seen.add(key);
      out.push({ text: el.textContent.trim().slice(0, 28), fg: fg.rgb.map((v, i) => Math.round(v * fg.a + bg[i] * (1 - fg.a))), bg, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10), op: parseFloat(cs.opacity) });
    });
    return out;
  }, includeControl);
  // o controle só serve para a 1ª medição; depois sai da frente (senão intercepta cliques conforme o layout)
  if (includeControl) await p.evaluate(() => { const e = document.getElementById('controle-contraste'); if (e) e.remove(); });
  let controlCaught = false;
  res.forEach((r) => {
    counter.n++;
    const ratio = cr(r.fg, r.bg);
    const large = r.size >= 24 || (r.size >= 18.66 && r.weight >= 700);
    if (ratio < (large ? 3 : 4.5) && r.op >= 1) {
      if (r.text.startsWith('CONTROLE')) { controlCaught = true; return; }
      bad.push(`[${scheme}/${label}] ${ratio}:1 "${r.text}" ${r.size}px fg=${r.fg} bg=${r.bg}`);
    }
  });
  return controlCaught;
}

(async () => {
  const b = await launchBrowser();
  const bad = []; const counter = { n: 0 }; let control = true;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const p = await c.newPage();
    await p.goto(URL);
    await p.evaluate(() => {
      localStorage.setItem('checklist-diario:skipLogin', '1');
      const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      const mk = (id, name, emoji, type, items, done, extra) => Object.assign({ id, name, emoji, type, items: items.map((t, i) => (typeof t === 'string' ? { id: id + i, text: t, done: i < done } : t)), sortOrder: 'manual', reminder: { enabled: false, times: [] } }, extra || {});
      const other = [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== new Date().getDay()).slice(0, 2);
      localStorage.setItem('checklist-diario:v1', JSON.stringify({ lastResetDate: d(0), wordListStats: {}, trash: [], lists: [
        mk('c', 'Casa', '🏠', 'rotina', [
          { id: 'a', text: 'Arrumar o quarto', done: false, steps: [{ id: 's1', text: 'Guardar a roupa', done: true }, { id: 's2', text: 'Arrumar a cama', done: false }] },
          { id: 'b', text: 'Pagar a conta de luz', done: false, snoozeUntil: d(-1) },
          { id: 'c', text: 'Regar as plantas', done: false }, { id: 'd', text: 'Passear', done: true }], 0),
        mk('m', 'Mercado', '🛒', 'lista', ['Leite'], 1),
        mk('g', 'Academia', '🏋️', 'rotina', ['Treino'], 0, { days: other })] }));
      localStorage.setItem('checklist-diario:game', JSON.stringify({ enabled: true, onboarded: true, badges: { first: 'x' }, total: 3, listsDone: 1, greetedOn: d(0), days: { [d(0)]: 1 }, picks: { date: d(0), ids: [{ l: 'c', i: 'c' }] } }));
    });
    await p.reload(); await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
    const hideModal = () => p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
    control = (await measureAll(p, scheme, 'home', bad, counter, true)) && control;
    await p.click('.list-card'); await p.waitForTimeout(500); await measureAll(p, scheme, 'lista', bad, counter);
    await p.click('.item-row:nth-child(1) .item-body'); await p.waitForTimeout(150); await measureAll(p, scheme, 'item com painel e passos', bad, counter);
    await p.click('.item-row:nth-child(3) .item-body'); await p.waitForTimeout(150);
    await p.click('[data-act="snooze"]'); await p.waitForTimeout(100); await measureAll(p, scheme, 'painel com adiar', bad, counter);
    await p.click('.item-row:nth-child(3) .item-body'); await p.waitForTimeout(100);
    await p.click('#btn-focus'); await p.waitForTimeout(450); await measureAll(p, scheme, 'foco com passos', bad, counter); await hideModal();
    await p.click('#btn-list-menu'); await p.waitForTimeout(500); await measureAll(p, scheme, 'menu da lista', bad, counter); await hideModal();
    await p.click('#btn-back'); await p.waitForTimeout(450);
    await p.click('#btn-settings'); await p.waitForTimeout(500); await measureAll(p, scheme, 'ajustes', bad, counter); await hideModal();
    await p.click('#btn-game-history'); await p.waitForTimeout(500); await measureAll(p, scheme, 'histórico', bad, counter); await hideModal();
    await p.click('#btn-new-list'); await p.waitForTimeout(500); await measureAll(p, scheme, 'nova lista', bad, counter); await hideModal();
    await p.click('#btn-breathe'); await p.waitForTimeout(500); await measureAll(p, scheme, 'respirar (som desligado)', bad, counter);
    await p.click('#m-sound-toggle'); await p.waitForTimeout(400); await measureAll(p, scheme, 'respirar (som ligado)', bad, counter);
    await p.click('#m-cancel'); await p.waitForTimeout(300);
    await c.close();
  }
  await b.close();
  bad.forEach((l) => console.log('  FAIL', l));
  if (!control) console.log('  FAIL o controle (texto ruim de propósito) NÃO foi acusado: o medidor está cego');
  const falhas = bad.length + (control ? 0 : 1);
  console.log(`\n${counter.n - 0} combinações medidas, ${falhas} falhas`.replace(/(\d+) combinações medidas, (\d+) falhas/, '$1 ok, $2 falhas'));
  process.exit(falhas ? 1 : 0);
})();

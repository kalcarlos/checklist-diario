// Som relaxante da pausa de respirar. Mede o áudio de verdade: a saída do
// AudioContext é desviada para um AnalyserNode (só no teste) e lemos o volume.
const { launchBrowser, URL } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const dk = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tapScript = () => {
  window.__acs = []; window.__plays = 0; window.__pauses = 0;
  try { Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true }); } catch (e) {}
  const RealAC = window.AudioContext;
  if (RealAC) {
    window.AudioContext = class extends RealAC {
      constructor(...a) { super(...a); window.__acs.push(this); this.__tap = this.createAnalyser(); this.__tap.fftSize = 2048; }
    };
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (t, ...r) {
      const res = orig.call(this, t, ...r);
      try { if (t instanceof AudioDestinationNode && this.context.__tap) orig.call(this, this.context.__tap); } catch (e) {}
      return res;
    };
  }
  const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays++; return play.apply(this, arguments); };
  const pause = HTMLMediaElement.prototype.pause; HTMLMediaElement.prototype.pause = function () { window.__pauses++; return pause.apply(this, arguments); };
  window.__level = () => {
    const c = window.__acs[0]; if (!c) return null;
    const a = new Float32Array(c.__tap.fftSize); c.__tap.getFloatTimeDomainData(a);
    let s = 0, pk = 0; for (const v of a) { s += v * v; pk = Math.max(pk, Math.abs(v)); }
    return { rms: Math.sqrt(s / a.length), peak: pk, state: c.state, t: c.currentTime };
  };
};

(async () => {
  const b = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
  const mkState = () => ({ lastResetDate: dk(0), wordListStats: {}, trash: [], lists: [{ id: 'c', name: 'Casa', emoji: '🏠', type: 'rotina', sortOrder: 'manual', reminder: { enabled: false, times: [] }, items: [{ id: 'a', text: 'a', done: false }, { id: 'b', text: 'b', done: false }] }] });
  const G = (x) => Object.assign({ enabled: true, days: {}, badges: {}, total: 0, listsDone: 0, greetedOn: dk(0), onboarded: true }, x || {});
  async function fresh(o, init) {
    const c = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, o || {}));
    await c.addInitScript(init || tapScript);
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    return p;
  }
  async function boot(p, game) {
    await p.goto(URL);
    await p.evaluate(([s, g]) => { localStorage.setItem('checklist-diario:v1', JSON.stringify(s)); localStorage.setItem('checklist-diario:skipLogin', '1'); localStorage.setItem('checklist-diario:game', JSON.stringify(g)); }, [mkState(), game || G()]);
    await p.reload(); await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('modal-backdrop').classList.add('hidden'));
  }
  const level = (p) => p.evaluate(() => window.__level());
  const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('checklist-diario:game')));
  const hidden = (p) => p.$eval('#modal-backdrop', (e) => e.classList.contains('hidden'));

  console.log('1. Padrões e permissões');
  let p = await fresh(); await boot(p);
  await p.click('#btn-breathe'); await p.waitForTimeout(300);
  ok('a caixa de som aparece no "Respirar um pouco"', (await p.$('#m-sound-toggle')) !== null && (await p.textContent('.sound-box')).includes('Som relaxante'));
  ok('desligado por padrão (switch aria-checked=false)', (await p.getAttribute('#m-sound-toggle', 'aria-checked')) === 'false' && (await p.getAttribute('#m-sound-toggle', 'role')) === 'switch');
  ok('opções (sons e volume) escondidas enquanto desligado', await p.$eval('#m-sound-more', (e) => e.classList.contains('hidden')));
  ok('nenhum AudioContext é criado sem o aceite da pessoa', (await p.evaluate(() => window.__acs.length)) === 0);
  await p.waitForTimeout(1500);
  ok('nem depois de a respiração começar', (await p.evaluate(() => window.__acs.length)) === 0 && (await p.evaluate(() => window.__plays)) === 0);

  console.log('2. Tocar, trocar de som e volume');
  await p.click('#m-sound-toggle'); await p.waitForTimeout(2400);
  let L = await level(p);
  ok('ligar cria 1 AudioContext rodando e o relógio avança', (await p.evaluate(() => window.__acs.length)) === 1 && L && L.state === 'running' && L.t > 1, L);
  ok('chuva: sai som audível e sem estourar', L.rms > 0.002 && L.peak < 0.6, L);
  ok('opções aparecem; "Chuva suave" selecionada', !(await p.$eval('#m-sound-more', (e) => e.classList.contains('hidden'))) && await p.$eval('[data-kind="chuva"]', (e) => e.classList.contains('selected')));
  ok('Audio Session do iOS pedida como "playback"', (await p.evaluate(() => navigator.audioSession.type)) === 'playback');
  ok('áudio mudo de apoio (iOS) foi iniciado', (await p.evaluate(() => window.__plays)) >= 1);
  const rmsRain = L.rms;
  await p.click('[data-kind="ondas"]'); await p.waitForTimeout(2200); L = await level(p);
  ok('ondas: audível e sem estourar', L.rms > 0.002 && L.peak < 0.8, L);
  ok('escolha de som é gravada', (await stored(p)).sound.kind === 'ondas' && await p.$eval('[data-kind="ondas"]', (e) => e.classList.contains('selected')));
  await p.click('[data-kind="tom"]'); await p.waitForTimeout(2200); L = await level(p);
  ok('tom calmo: audível e sem estourar', L.rms > 0.002 && L.peak < 0.8, L);
  ok('trocar de som não cria outro AudioContext', (await p.evaluate(() => window.__acs.length)) === 1);
  await p.evaluate(() => { const v = document.getElementById('m-sound-vol'); v.value = 0; v.dispatchEvent(new Event('input', { bubbles: true })); v.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(1800); L = await level(p);
  ok('volume 0 silencia', L.rms < 0.0006, L);
  await p.evaluate(() => { const v = document.getElementById('m-sound-vol'); v.value = 100; v.dispatchEvent(new Event('input', { bubbles: true })); v.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(2000); const loud = await level(p);
  await p.evaluate(() => { const v = document.getElementById('m-sound-vol'); v.value = 30; v.dispatchEvent(new Event('input', { bubbles: true })); v.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(2000); const soft = await level(p);
  ok('volume alto é mais forte que baixo (e nada estoura)', loud.rms > soft.rms * 2 && loud.peak < 1, { loud: loud.rms, soft: soft.rms, peak: loud.peak });
  ok('volume fica gravado', (await stored(p)).sound.vol === 30);
  await p.click('#m-sound-toggle'); await p.waitForTimeout(1800); L = await level(p);
  ok('desligar o switch silencia (com fade)', L.rms < 0.0004, L);
  ok('desligado de novo: opções somem e preferência gravada', await p.$eval('#m-sound-more', (e) => e.classList.contains('hidden')) && (await stored(p)).sound.on === false);
  ok('áudio mudo de apoio pausado', (await p.evaluate(() => window.__pauses)) >= 1);

  console.log('3. Parar sozinho');
  await p.click('#m-sound-toggle'); await p.waitForTimeout(1800);
  ok('liga de novo sem criar outro contexto', (await p.evaluate(() => window.__acs.length)) === 1 && (await level(p)).rms > 0.001);
  await p.click('#m-cancel'); await p.waitForTimeout(1600); L = await level(p);
  ok('"Fechar" para o som', L.rms < 0.0004 && await hidden(p), L);
  await p.click('#btn-breathe'); await p.waitForTimeout(300);
  ok('preferência ligada: ao reabrir já começa tocando (dentro do toque)', await p.getAttribute('#m-sound-toggle', 'aria-checked') === 'true');
  await p.waitForTimeout(2400);
  ok('…e o som realmente toca', (await level(p)).rms > 0.001);
  await p.mouse.click(195, 40); await p.waitForTimeout(1600); L = await level(p);
  ok('fechar tocando fora da folha também para (vigia)', await hidden(p) && L.rms < 0.0004, L);
  await p.click('#btn-breathe'); await p.waitForTimeout(2400);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(1200); L = await level(p);
  ok('app indo para segundo plano para o som', L.rms < 0.0006, L);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('4. Persistência e modo foco');
  p = await fresh(); await boot(p, G({ sound: { on: true, kind: 'ondas', vol: 60 } }));
  await p.click('#btn-breathe'); await p.waitForTimeout(2500);
  ok('preferência salva (ondas, ligada) toca ao abrir após recarregar', await p.$eval('[data-kind="ondas"]', (e) => e.classList.contains('selected')) && (await level(p)).rms > 0.001);
  await p.click('#m-cancel'); await p.waitForTimeout(300);
  await p.click('.list-card'); await p.waitForTimeout(480); await p.click('#btn-focus'); await p.click('#m-focus-breathe'); await p.waitForTimeout(2300);
  ok('"Respirar" dentro do foco também tem som', (await level(p)).rms > 0.001);
  await p.click('#m-cancel'); await p.waitForTimeout(1500);
  ok('fechar volta ao foco e o som cala', (await p.$('#focus-text')) !== null && (await level(p)).rms < 0.0004);

  console.log('5. Sincronia com a respiração e fim');
  p = await fresh(); await boot(p, G({ sound: { on: true, kind: 'tom', vol: 70 } }));
  await p.click('#btn-breathe');
  await p.waitForTimeout(5400); const inhaleEnd = await level(p);
  await p.waitForTimeout(5900); const exhaleEnd = await level(p);
  ok('o som cresce ao inspirar e cai ao soltar o ar (≥1,8×)', inhaleEnd.rms / exhaleEnd.rms >= 1.8, { inhale: inhaleEnd.rms, exhale: exhaleEnd.rms });
  p = await fresh(); await boot(p, G({ sound: { on: true, kind: 'chuva', vol: 70 } }));
  await p.clock.install(); await p.click('#btn-breathe'); await p.waitForTimeout(300);
  await p.clock.runFor(62500); await p.waitForTimeout(3800); L = await level(p);
  ok('no fim das 6 respirações o som some com fade e a mensagem final aparece', /Pronto/.test(await p.textContent('#breath-text')) && L.rms < 0.0004, L);

  console.log('6. Sem suporte e layout');
  p = await fresh({}, () => { delete window.AudioContext; delete window.webkitAudioContext; }); await boot(p);
  await p.click('#btn-breathe'); await p.waitForTimeout(1600);
  ok('sem Web Audio: caixa de som não aparece e a respiração funciona', (await p.$('#m-sound-toggle')) === null && /Inspire/.test(await p.textContent('#breath-text')) && p.errs.length === 0, p.errs);
  const w = await fresh({ viewport: { width: 320, height: 640 } }); await boot(w, G({ sound: { on: true, kind: 'chuva', vol: 50 } }));
  await w.click('#btn-breathe'); await w.waitForTimeout(500);
  ok('320px: folha com opções abertas não estoura', await w.$eval('#modal', (e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth + 1));
  ok('o botão Fechar continua alcançável (a folha rola)', await w.$eval('#m-cancel', (e) => { e.scrollIntoView(); const r = e.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; }));
  ok('sem erros de JS', w.errs.length === 0, w.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})();

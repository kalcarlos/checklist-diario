// Backup automático (sem conta): código, envio a cada alteração e 1x/dia, restauração e aviso na home.
// O Worker é simulado em memória (mesmos endpoints /data/save e /data/load do servidor real).
const { launchBrowser, URL: APP } = require('./lib');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };

(async () => {
  const b = await launchBrowser();
  const server = new Map(); // code -> {data, updatedAt}
  let saves = [];
  const items = (arr) => arr.map((t, i) => ({ id: 'i' + i, text: t, done: false }));
  const mkList = (id, name, arr) => ({ id, name, emoji: '🛒', type: 'lista', items: items(arr), sortOrder: 'manual', reminder: { enabled: false, times: [] } });
  const mkState = (lists) => ({ lastResetDate: '2026-10-14', wordListStats: {}, trash: [], lists });
  const G = (x) => Object.assign({ enabled: true, days: {}, badges: { first: 'x', list1: 'x' }, total: 0, listsDone: 5, greetedOn: '2026-10-14', onboarded: true }, x || {});

  async function open(state, game, extraStorage, withSession) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await c.route(/workers\.dev/, async (r) => {
      const req = r.request(), path = new URL(req.url()).pathname;
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (path === '/data/save') {
        const body = JSON.parse(req.postData()); const rec = { data: body.data, updatedAt: Date.now() };
        server.set(body.code, rec); saves.push(body.code);
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, updatedAt: rec.updatedAt }) });
      }
      if (path === '/data/load') {
        const rec = server.get(JSON.parse(req.postData()).code);
        return rec ? r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(rec) }) : r.fulfill({ status: 404, headers: cors, body: 'nao encontrado' });
      }
      return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
    });
    const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    p.dialogs = []; p.on('dialog', (d) => { p.dialogs.push(d.message()); d.accept(); });
    await p.clock.install({ time: new Date(2026, 9, 14, 10, 0, 0) });
    await p.goto(APP);
    await p.evaluate(([s, g, extra, ses]) => {
      if (s) localStorage.setItem('checklist-diario:v1', JSON.stringify(s));
      localStorage.setItem('checklist-diario:skipLogin', '1');
      localStorage.setItem('checklist-diario:game', JSON.stringify(g));
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
      if (ses) localStorage.setItem('checklist-diario:session', JSON.stringify(ses));
    }, [state, game || G(), extraStorage, withSession ? { token: 't', username: 'ana', userId: 'u1' } : null]);
    await p.reload(); await p.waitForTimeout(600);
    return p;
  }
  const ls = (p, k) => p.evaluate((key) => localStorage.getItem(key), k);
  const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('checklist-diario:v1')));

  console.log('1. Aviso na home');
  let p = await open(mkState([mkList('m', 'Mercado', ['leite'])]));
  ok('com itens e sem backup/conta: aviso "só existem neste aparelho"', /só existem neste aparelho/.test(await p.textContent('#backup-nudge')));
  await p.click('#btn-backup-hide'); await p.waitForTimeout(200);
  ok('"Agora não" esconde por 3 dias', await p.evaluate(() => document.getElementById('backup-nudge').classList.contains('hidden')) && JSON.parse(await ls(p, 'checklist-diario:game')).backupNudgeHide === '2026-10-17');
  p = await open(mkState([]));
  ok('instalação vazia: oferece restaurar com código', /Já usava o app\?/.test(await p.textContent('#backup-nudge')) && !(await p.$('#btn-backup-on')));
  p = await open(mkState([mkList('m', 'Mercado', ['leite'])]), G(), { 'checklist-diario:syncCode': 'abcdef123456' });
  ok('com backup ativo: sem aviso', await p.evaluate(() => document.getElementById('backup-nudge').classList.contains('hidden')));
  p = await open(mkState([mkList('m', 'Mercado', ['leite'])]), G(), {}, true);
  ok('com conta: sem aviso', await p.evaluate(() => document.getElementById('backup-nudge').classList.contains('hidden')));

  console.log('2. Ativar o backup');
  saves = []; server.clear();
  p = await open(mkState([mkList('m', 'Mercado', ['leite', 'pão'])]));
  await p.click('#btn-backup-on'); await p.waitForTimeout(700);
  const code = await ls(p, 'checklist-diario:syncCode');
  ok('gera um código de 24 caracteres alfanuméricos', /^[A-Za-z0-9]{24}$/.test(code), code);
  ok('mostra o código agrupado para guardar', (await p.textContent('#m-code')) === code.match(/.{4}/g).join('-'));
  ok('envia a cópia na hora (com as listas)', saves.length === 1 && server.get(code).data.lists[0].name === 'Mercado' && server.get(code).data.lists[0].items.length === 2, saves);
  ok('avisa para guardar o código', /Guarde este código/.test(await p.textContent('#modal')));
  await p.click('#m-code-close'); await p.waitForTimeout(250);
  ok('o aviso da home some', await p.evaluate(() => document.getElementById('backup-nudge').classList.contains('hidden')));
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  console.log('3. Envio a cada alteração');
  saves = [];
  await p.click('.list-card'); await p.waitForTimeout(500);
  await p.click('.item-row:nth-child(1) .check'); await p.waitForTimeout(2600);
  ok('marcar um item envia nova cópia em ~2s', saves.length >= 1 && server.get(code).data.lists[0].items[0].done === true, saves.length);

  console.log('4. Uma vez por dia, mesmo sem alterações');
  saves = [];
  const state4 = mkState([mkList('m', 'Mercado', ['leite'])]);
  const yesterday = String(new Date(2026, 9, 13, 20, 0).getTime());
  p = await open(state4, G(), { 'checklist-diario:syncCode': 'diario1234567890', 'checklist-diario:lastBackupAt': yesterday });
  await p.waitForTimeout(800);
  ok('último envio foi ontem: ao abrir, envia', saves.includes('diario1234567890'), saves);
  saves = [];
  p = await open(state4, G(), { 'checklist-diario:syncCode': 'diario1234567890', 'checklist-diario:lastBackupAt': String(new Date(2026, 9, 14, 8, 0).getTime()) });
  await p.waitForTimeout(800);
  ok('já enviou hoje: não reenvia ao abrir', saves.length === 0, saves);

  console.log('5. Ajustes');
  p = await open(state4, G(), { 'checklist-diario:syncCode': 'diario1234567890', 'checklist-diario:lastBackupAt': String(new Date(2026, 9, 14, 8, 5).getTime()) });
  await p.click('#btn-settings'); await p.waitForTimeout(350);
  ok('mostra "ativo" e o último envio', /Backup automático ativo/.test(await p.textContent('#m-backup-status')) && /hoje às 08:05/.test(await p.textContent('#m-backup-status')), await p.textContent('#m-backup-status'));
  await p.click('#m-backup-code'); await p.waitForTimeout(250);
  ok('"Ver meu código" mostra o código atual', (await p.textContent('#m-code')) === 'diar-io12-3456-7890');
  await p.click('#m-code-close'); await p.waitForTimeout(250);
  p = await open(mkState([mkList('m', 'Mercado', ['leite'])]), G(), {}, true);
  await p.click('#btn-settings'); await p.waitForTimeout(350);
  ok('com conta: diz que as listas estão na conta', /estão na conta/.test(await p.textContent('#m-backup-box')) && !(await p.$('#m-backup-on')));

  console.log('6. Restaurar (aparelho novo, depois de remover o app)');
  server.set('restaura123456abcdef', { data: mkState([mkList('a', 'Casa', ['regar', 'lavar']), mkList('b', 'Pets', ['ração'])]), updatedAt: new Date(2026, 9, 13, 18, 30).getTime() });
  p = await open(mkState([]));
  await p.click('#btn-backup-restore'); await p.waitForTimeout(250);
  await p.fill('#m-restore-code', 'abc'); await p.click('#m-restore-go'); await p.waitForTimeout(200);
  ok('código com formato errado: orienta a conferir', /não parece certo/.test(await p.textContent('#m-restore-msg')));
  await p.fill('#m-restore-code', 'zzzzzzzzzzzz'); await p.click('#m-restore-go'); await p.waitForTimeout(400);
  ok('código sem backup: "não encontrei"', /Não encontrei nenhum backup/.test(await p.textContent('#m-restore-msg')));
  await p.fill('#m-restore-code', 'restaura-1234-56ab-cdef'); await p.click('#m-restore-go'); await p.waitForTimeout(700);
  ok('pede confirmação mostrando listas, itens e data', p.dialogs.some((d) => /2 lista\(s\) e 3 item\(ns\)/.test(d) && /ontem às 18:30/.test(d)), p.dialogs);
  const s6 = await stored(p);
  ok('restaura as listas', s6.lists.map((l) => l.name).join() === 'Casa,Pets' && s6.lists[0].items.length === 2, s6.lists.map((l) => l.name));
  ok('o aparelho passa a usar o mesmo código (backup continua)', (await ls(p, 'checklist-diario:syncCode')) === 'restaura123456abcdef');
  ok('home mostra as listas e o aviso não aparece', /2 de|0 de 2/.test(await p.textContent('#lists-container')) && await p.evaluate(() => document.getElementById('backup-nudge').classList.contains('hidden')));
  saves = [];
  await p.click('.list-card'); await p.waitForTimeout(500); await p.click('.item-row:nth-child(1) .check'); await p.waitForTimeout(2600);
  ok('depois de restaurar, novas alterações vão para o mesmo backup', saves.includes('restaura123456abcdef'), saves);

  console.log('7. Cancelar a confirmação não muda nada');
  p = await open(mkState([mkList('x', 'Minha lista', ['a'])]));
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.dismiss());
  await p.click('#btn-backup-restore'); await p.waitForTimeout(250);
  await p.fill('#m-restore-code', 'restaura123456abcdef'); await p.click('#m-restore-go'); await p.waitForTimeout(600);
  ok('lista do aparelho preservada e sem código gravado', (await stored(p)).lists[0].name === 'Minha lista' && (await ls(p, 'checklist-diario:syncCode')) === null);
  ok('sem erros de JS', p.errs.length === 0, p.errs);

  await b.close();
  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Teste de integração do Worker de verdade (workerd + D1 + KV locais, nada vai para a nuvem).
//   cd push-server && npm ci && npm run e2e
//
// Sobe o Worker com `wrangler dev --local`, um "serviço de push" falso que registra as chamadas,
// e confere: contas e /progress, disparo de lembretes (lista e tarefa), silenciar hoje, dias da
// semana, não repetir depois de reenviar o registro, exclusão de conta e um banco sem a tabela nova.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = Number(process.env.E2E_WORKER_PORT || 8791);
const FAKE_PORT = Number(process.env.E2E_FAKE_PORT || 8793);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-e2e-'));
const devVars = path.join(root, '.dev.vars');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ---------- chaves VAPID de teste (as de produção nunca saem do Cloudflare) ----------
const vapid = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const vjwk = vapid.privateKey.export({ format: 'jwk' });
const VAPID_PUB = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(vjwk.x, 'base64url'), Buffer.from(vjwk.y, 'base64url')]));
const VAPID_D = vjwk.d;

function subscriptionKeys() {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = kp.publicKey.export({ format: 'jwk' });
  return { p256dh: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')])), auth: b64u(crypto.randomBytes(16)) };
}

// ---------- serviço de push falso ----------
const hits = new Map(); // nome -> quantidade de POSTs recebidos
const fake = http.createServer((req, res) => {
  const name = req.url.split('/').pop();
  req.on('data', () => {});
  req.on('end', () => {
    hits.set(name, (hits.get(name) || 0) + 1);
    res.statusCode = name.startsWith('gone') ? 410 : 201;
    res.end();
  });
});

// ---------- Worker ----------
let worker = null;
function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function startWorker(persist) {
  worker = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--test-scheduled', '--var', `VAPID_PUBLIC_KEY:${VAPID_PUB}`], {
    cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return; } catch (e) { /* ainda subindo */ }
    await sleep(1000);
  }
  throw new Error('o Worker não subiu em 60s');
}
async function stopWorker() {
  if (!worker) return;
  try { process.kill(-worker.pid, 'SIGTERM'); } catch (e) { /* já saiu */ }
  worker = null;
  await sleep(1500);
  try { execFileSync('pkill', ['-x', 'workerd']); } catch (e) { /* nenhum */ }
  await sleep(500);
}

async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let data = null; const text = await r.text(); try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: r.status, data };
}
const register = async (name) => (await api('POST', '/auth/register', null, { username: name, password: 'senha-de-teste-1' })).data;
const trigger = () => fetch(BASE + '/__scheduled?cron=*+*+*+*+*');

// hora local (UTC no teste) e dia da semana
function utcNow() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const hm = d.toISOString().slice(11, 16);
  return { date, hm, weekday: d.getUTCDay() };
}

// Cria uma inscrição, dispara o cron e devolve quantas notificações chegaram. O horário é o minuto
// atual; se o minuto virar no meio, repete (lembrete de lista exige o minuto exato).
async function scenario(name, build, { expectHits, retrigger = 0 }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const endpoint = `http://127.0.0.1:${FAKE_PORT}/push/${name}-${attempt}`;
    const now = utcNow();
    const body = { subscription: { endpoint, keys: subscriptionKeys() }, timezone: 'UTC', ...build(now, endpoint) };
    const sub = await fetch(BASE + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!sub.ok) return { error: 'subscribe ' + sub.status };
    await trigger();
    await sleep(700);
    if (utcNow().hm !== now.hm) continue; // o minuto virou: tenta de novo
    for (let i = 0; i < retrigger; i++) { await trigger(); await sleep(400); }
    const got = hits.get(`${name}-${attempt}`) || 0;
    return { got, endpoint, body };
  }
  return { error: 'não consegui fechar um minuto estável' };
}

const listRem = (hm, extra) => ({ listId: 'c', listName: 'Casa', emoji: '🏠', time: hm, enabled: true, hasPending: true, ...(extra || {}) });
const taskRem = (date, hm, extra) => ({ listId: 'c', itemId: 'i1', listName: 'Casa', emoji: '🏠', text: 'Ligar pro dentista', date, time: hm, ...(extra || {}) });

async function main() {
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
  fs.writeFileSync(devVars, `VAPID_PRIVATE_KEY=${VAPID_D}\n`);
  const dbDir = path.join(tmp, 'novo');
  fs.mkdirSync(dbDir);
  wrangler(['d1', 'execute', 'checklist-diario-db', '--local', '--persist-to', dbDir, '--file', path.join(root, 'schema.sql')]);
  await startWorker(dbDir);

  console.log('1. Contas e /progress');
  const A = await register('ana_e2e'), B = await register('bia_e2e');
  ok('cadastro funciona (token e usuário)', A && A.token && B && B.token && A.user.id !== B.user.id, A);
  ok('sem login: 401', (await api('GET', '/progress')).status === 401 && (await api('PUT', '/progress', null, { data: {} })).status === 401);
  let r = await api('GET', '/progress', A.token);
  ok('GET sem nada guardado: data null', r.status === 200 && r.data.data === null, r);
  r = await api('PUT', '/progress', A.token, { data: { days: { '2026-10-12': 3 }, doneLists: { '2026-10-12': 1 }, badges: { first: '2026-10-12' }, total: 3, listsDone: 1, reviews: { '2026-10-05': { seen: true, at: '2026-10-06', helped: 'segredo pessoal' } }, helped: 'outro segredo' } });
  ok('PUT grava', r.status === 200 && r.data.data.days['2026-10-12'] === 3, r);
  ok('textos pessoais NÃO são guardados', !JSON.stringify(r.data).includes('segredo'), r.data);
  r = await api('PUT', '/progress', A.token, { data: { days: { '2026-10-12': 2, '2026-10-13': 4 }, badges: { first: '2026-10-10' }, total: 1, listsDone: 5 } });
  ok('segundo aparelho: junta (max por dia, conquista mais antiga, total max)', r.data.data.days['2026-10-12'] === 3 && r.data.data.days['2026-10-13'] === 4 && r.data.data.badges.first === '2026-10-10' && r.data.data.total === 3 && r.data.data.listsDone === 5, r.data);
  const g = await api('GET', '/progress', A.token);
  ok('GET devolve o resultado junto', JSON.stringify(g.data.data) === JSON.stringify(r.data.data));
  ok('outra pessoa não vê o progresso da Ana', (await api('GET', '/progress', B.token)).data.data === null);
  ok('corpo inválido: 400', (await api('PUT', '/progress', A.token, 'isto não é json')).status === 400 && (await api('PUT', '/progress', A.token, { data: [1] })).status === 400);
  ok('corpo grande demais: 413', (await api('PUT', '/progress', A.token, 'x'.repeat(70 * 1024))).status === 413);

  console.log('2. /subscribe anuncia os recursos novos');
  const sub = await api('POST', '/subscribe', null, { subscription: { endpoint: `http://127.0.0.1:${FAKE_PORT}/push/anuncio`, keys: subscriptionKeys() }, timezone: 'UTC', reminders: [] });
  ok('resposta traz features: task-reminders e progress', sub.status === 200 && sub.data.ok === true && sub.data.features.includes('task-reminders') && sub.data.features.includes('progress'), sub);
  ok('dados inválidos continuam dando 400', (await api('POST', '/subscribe', null, { nada: 1 })).status === 400);

  console.log('3. Disparo de lembretes (Worker real + push falso)');
  let s = await scenario('lista', (n) => ({ reminders: [listRem(n.hm)] }), { expectHits: 1, retrigger: 1 });
  ok('lembrete de lista dispara 1 vez no minuto (e não repete no 2º cron)', s.got === 1, s);
  s = await scenario('tarefa', (n) => ({ reminders: [], taskReminders: [taskRem(n.date, n.hm)] }), { expectHits: 1, retrigger: 1 });
  ok('lembrete por tarefa dispara 1 vez (e não repete)', s.got === 1, s);
  s = await scenario('ambos', (n) => ({ reminders: [listRem(n.hm)], taskReminders: [taskRem(n.date, n.hm)] }), { expectHits: 2 });
  ok('lista e tarefa no mesmo minuto: 2 notificações', s.got === 2, s);
  s = await scenario('mudo', (n) => ({ reminders: [listRem(n.hm)], taskReminders: [taskRem(n.date, n.hm)], muteDate: n.date }), { expectHits: 0 });
  ok('"silenciar hoje": nada chega', s.got === 0, s);
  s = await scenario('mudoontem', (n) => ({ reminders: [listRem(n.hm)], muteDate: '2000-01-01' }), { expectHits: 1 });
  ok('silêncio de outro dia não vale', s.got === 1, s);
  s = await scenario('dias', (n) => ({ reminders: [listRem(n.hm, { days: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== n.weekday) })] }), { expectHits: 0 });
  ok('rotina fora do dia da semana: não chega', s.got === 0, s);
  s = await scenario('diasok', (n) => ({ reminders: [listRem(n.hm, { days: [n.weekday] })] }), { expectHits: 1 });
  ok('rotina no dia certo: chega', s.got === 1, s);
  s = await scenario('semlista', (n) => ({ reminders: [listRem(n.hm, { hasPending: false })] }), { expectHits: 0 });
  ok('lista sem pendência: não chega (comportamento anterior)', s.got === 0, s);
  s = await scenario('ontem', (n) => ({ reminders: [], taskReminders: [taskRem('2000-01-01', n.hm)] }), { expectHits: 0 });
  ok('lembrete por tarefa de outro dia: não chega', s.got === 0, s);
  s = await scenario('antigo', (n) => ({ reminders: [listRem(n.hm)] }), { expectHits: 1 });
  ok('cliente antigo (sem taskReminders/muteDate) funciona como antes', s.got === 1, s);

  // reenviar o mesmo registro depois do disparo não pode reativar o lembrete
  const again = await fetch(BASE + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.body) });
  await trigger(); await sleep(600);
  ok('reenviar o registro no mesmo minuto não dispara de novo', again.ok && (hits.get(s.endpoint.split('/').pop()) || 0) === 1, hits.get(s.endpoint.split('/').pop()));
  const t = await scenario('reenvio', (n) => ({ reminders: [], taskReminders: [taskRem(n.date, n.hm)] }), { expectHits: 1 });
  await fetch(BASE + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t.body) });
  await trigger(); await sleep(600);
  ok('lembrete de tarefa já enviado não volta quando o app reenvia', t.got === 1 && (hits.get(t.endpoint.split('/').pop()) || 0) === 1);

  s = await scenario('gone', (n) => ({ reminders: [listRem(n.hm)] }), { expectHits: 1 });
  ok('inscrição expirada (410 do serviço de push) é tentada uma vez e removida', s.got === 1, s);
  await trigger(); await sleep(500);
  ok('e não é tentada de novo no cron seguinte', (hits.get(s.endpoint.split('/').pop()) || 0) === 1);

  console.log('3b. Backup por código (/data/save e /data/load)');
  const code = 'AbCdEfGhIjKlMnOpQrStUvWx'; // 24 caracteres, como o app gera
  const sv = await api('POST', '/data/save', null, { code, data: { lists: [{ id: 'a', name: 'Casa', items: [{ id: 'i', text: 'regar', done: false }] }], lastResetDate: '2026-10-14' } });
  ok('salva com código de 24 caracteres', sv.status === 200 && sv.data && sv.data.ok && sv.data.updatedAt > 0, sv);
  const ld = await api('POST', '/data/load', null, { code });
  ok('carrega a mesma cópia', ld.status === 200 && ld.data.data.lists[0].name === 'Casa' && ld.data.data.lists[0].items[0].text === 'regar', ld);
  const sv2 = await api('POST', '/data/save', null, { code, data: { lists: [], lastResetDate: '2026-10-14' } });
  const ld2 = await api('POST', '/data/load', null, { code });
  ok('novo envio substitui a cópia (e atualiza o horário)', ld2.data.data.lists.length === 0 && ld2.data.updatedAt >= ld.data.updatedAt && sv2.status === 200, ld2);
  const nf = await api('POST', '/data/load', null, { code: 'ZzZzZzZzZzZzZzZzZzZzZzZz' });
  ok('código desconhecido: 404', nf.status === 404, nf);
  const bad = await api('POST', '/data/save', null, { code: 'curto', data: {} });
  ok('código inválido: 400', bad.status === 400, bad);

  console.log('4. Exclusão de conta limpa o progresso');
  const C = await register('caio_e2e');
  await api('PUT', '/progress', C.token, { data: { total: 9, days: { '2026-10-12': 1 } } });
  const count = () => JSON.parse(wrangler(['d1', 'execute', 'checklist-diario-db', '--local', '--persist-to', dbDir, '--json', '--command', 'SELECT COUNT(*) AS n FROM progress']))[0].results[0].n;
  const before = count();
  ok('progresso da conta está no banco', before >= 2, before);
  const del = await api('DELETE', '/auth/me', C.token);
  ok('excluir a conta funciona', del.status === 200, del);
  ok('a linha de progresso dela sumiu (e só a dela)', count() === before - 1, count());

  console.log('5. Banco sem a tabela nova (migração ainda não aplicada)');
  await stopWorker();
  const oldDir = path.join(tmp, 'antigo');
  fs.mkdirSync(oldDir);
  wrangler(['d1', 'execute', 'checklist-diario-db', '--local', '--persist-to', oldDir, '--file', path.join(root, 'schema.sql')]);
  wrangler(['d1', 'execute', 'checklist-diario-db', '--local', '--persist-to', oldDir, '--command', 'DROP TABLE progress']);
  await startWorker(oldDir);
  const D = await register('davi_e2e');
  ok('cadastro segue funcionando', D && D.token, D);
  const g2 = await api('GET', '/progress', D.token), p2 = await api('PUT', '/progress', D.token, { data: { total: 1 } });
  ok('/progress responde 501 explicando a migração (sem 500 nem queda)', g2.status === 501 && p2.status === 501 && /schema\.sql/.test(g2.data.error), [g2, p2]);
  const s2 = await scenario('semtabela', (n) => ({ reminders: [listRem(n.hm)] }), { expectHits: 1 });
  ok('lembretes continuam funcionando', s2.got === 1, s2);
  const del2 = await api('DELETE', '/auth/me', D.token);
  ok('excluir conta continua funcionando sem a tabela', del2.status === 200, del2);
}

try {
  await main();
} catch (e) {
  fail++;
  console.log('  FAIL erro inesperado:', e && e.message);
} finally {
  await stopWorker();
  fake.close();
  try { fs.unlinkSync(devVars); } catch (e) { /* já removido */ }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);

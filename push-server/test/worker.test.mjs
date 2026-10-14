// Testes do servidor sem dependencias: node --test push-server/test/
// Cobrem o merge de progresso, o agendamento de lembretes (listas e tarefas) e as rotas /progress
// com um D1 de mentira em memoria.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProgress, mergeProgress, handleProgressGet, handleProgressPut } from '../src/progress.js';
import { planReminders, sanitizeTaskReminders, carrySent, taskKey } from '../src/schedule.js';

const D = (n) => `2026-10-${String(n).padStart(2, '0')}`;

// ---------- merge de progresso ----------
test('merge: max por dia, menor data por conquista, max de totais', () => {
  const a = { days: { [D(12)]: 3, [D(13)]: 1 }, doneLists: { [D(12)]: 1 }, badges: { first: D(12), list1: D(14) }, total: 10, listsDone: 2, reviews: {} };
  const b = { days: { [D(12)]: 5, [D(14)]: 2 }, doneLists: { [D(12)]: 0, [D(15)]: 1 }, badges: { first: D(11), streak7: D(16) }, total: 8, listsDone: 4, reviews: {} };
  const m = mergeProgress(a, b);
  assert.deepEqual(m.days, { [D(12)]: 5, [D(13)]: 1, [D(14)]: 2 });
  assert.deepEqual(m.doneLists, { [D(12)]: 1, [D(15)]: 1 });
  assert.deepEqual(m.badges, { first: D(11), list1: D(14), streak7: D(16) });
  assert.equal(m.total, 10); assert.equal(m.listsDone, 4);
});

test('merge é comutativo, associativo e idempotente (a ordem dos aparelhos não importa)', () => {
  const mk = (seed) => ({ days: { [D(10 + seed)]: seed + 1, [D(20)]: seed }, doneLists: { [D(10 + seed)]: seed }, badges: { ['b' + seed]: D(10 + seed), shared: D(10 + seed) }, total: seed * 3, listsDone: seed, reviews: { [D(5)]: { seen: true, at: D(5 + seed) } } });
  const [x, y, z] = [mk(1), mk(2), mk(3)];
  assert.deepEqual(mergeProgress(x, y), mergeProgress(y, x));
  assert.deepEqual(mergeProgress(mergeProgress(x, y), z), mergeProgress(x, mergeProgress(y, z)));
  assert.deepEqual(mergeProgress(x, x), sanitizeProgress(x));
});

test('merge: revisão vista guarda só a marca e a data mais antiga', () => {
  const m = mergeProgress({ reviews: { [D(5)]: { seen: true, at: D(9) } } }, { reviews: { [D(5)]: { seen: true, at: D(7) }, [D(12)]: { seen: true, at: D(13) } } });
  assert.deepEqual(m.reviews, { [D(5)]: { seen: true, at: D(7) }, [D(12)]: { seen: true, at: D(13) } });
});

test('sanitize: descarta textos livres, chaves inválidas, números absurdos e limita tamanhos', () => {
  const dirty = {
    days: { [D(1)]: 2, 'nao-e-data': 9, '2026-13-99x': 1, [D(2)]: -4, [D(3)]: 'abc', [D(4)]: 1e12 },
    badges: { first: D(1), 'MAIUSCULA': D(1), x: D(1), ok_no: D(1), good: 'texto livre' },
    reviews: { [D(5)]: { seen: true, at: D(6), helped: 'segredo', next: 'outro segredo' }, [D(6)]: { seen: false } },
    total: '12', listsDone: -3, senha: 'x', helped: 'segredo',
  };
  const c = sanitizeProgress(dirty);
  assert.deepEqual(Object.keys(c.days).sort(), [D(1), D(4)]);
  assert.equal(c.days[D(4)], 100000);
  assert.deepEqual(Object.keys(c.badges), ['first']);
  assert.deepEqual(c.reviews, { [D(5)]: { seen: true, at: D(6) } });
  assert.ok(!JSON.stringify(c).includes('segredo'), 'nenhum texto pessoal pode passar');
  assert.equal(c.total, 12); assert.equal(c.listsDone, 0);
  assert.deepEqual(Object.keys(c).sort(), ['badges', 'days', 'doneLists', 'listsDone', 'reviews', 'total']);
  const many = {}; for (let i = 0; i < 500; i++) many[`2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + Math.floor(i / 12) % 28).padStart(2, '0')}`] = 1;
  assert.ok(Object.keys(sanitizeProgress({ days: many }).days).length <= 400);
  assert.deepEqual(sanitizeProgress(null).days, {}); assert.deepEqual(sanitizeProgress('x').badges, {});
});

// ---------- rotas /progress com D1 de mentira ----------
function fakeDb({ missingTable = false } = {}) {
  const rows = new Map();
  const stmt = (sql) => ({
    bind: (...args) => ({
      first: async () => { if (missingTable) throw new Error('no such table: progress'); return rows.get(args[0]) || null; },
      run: async () => { if (missingTable) throw new Error('no such table: progress'); rows.set(args[0], { data: args[1], updatedAt: args[2] }); },
    }),
  });
  return { prepare: stmt, rows };
}
const req = (method, body) => new Request('https://x/progress', { method, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });

test('GET /progress sem nada guardado devolve data:null', async () => {
  const env = { DB: fakeDb() };
  const r = await handleProgressGet(req('GET'), env, { id: 'u1' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { data: null, updatedAt: 0 });
});

test('PUT /progress junta com o que já existe e devolve o resultado; GET devolve o mesmo', async () => {
  const env = { DB: fakeDb() };
  const u = { id: 'u1' };
  let r = await handleProgressPut(req('PUT', { data: { days: { [D(12)]: 3 }, total: 3, badges: { first: D(12) } } }), env, u);
  assert.equal(r.status, 200);
  r = await handleProgressPut(req('PUT', { data: { days: { [D(12)]: 2, [D(13)]: 4 }, total: 1, badges: { first: D(10) } } }), env, u);
  const merged = (await r.json()).data;
  assert.deepEqual(merged.days, { [D(12)]: 3, [D(13)]: 4 });
  assert.equal(merged.total, 3); assert.equal(merged.badges.first, D(10));
  const g = await (await handleProgressGet(req('GET'), env, u)).json();
  assert.deepEqual(g.data, merged);
});

test('cada pessoa só vê o próprio progresso', async () => {
  const env = { DB: fakeDb() };
  await handleProgressPut(req('PUT', { data: { total: 7 } }), env, { id: 'u1' });
  const other = await (await handleProgressGet(req('GET'), env, { id: 'u2' })).json();
  assert.equal(other.data, null);
});

test('PUT rejeita corpo inválido, grande demais e formato errado', async () => {
  const env = { DB: fakeDb() };
  assert.equal((await handleProgressPut(req('PUT', 'não é json'), env, { id: 'u1' })).status, 400);
  assert.equal((await handleProgressPut(req('PUT', { data: [1, 2] }), env, { id: 'u1' })).status, 400);
  assert.equal((await handleProgressPut(req('PUT', { outra: 1 }), env, { id: 'u1' })).status, 400);
  assert.equal((await handleProgressPut(req('PUT', 'x'.repeat(70 * 1024)), env, { id: 'u1' })).status, 413);
});

test('sem a tabela (migração pendente) responde 501 com instrução, sem quebrar', async () => {
  const env = { DB: fakeDb({ missingTable: true }) };
  const g = await handleProgressGet(req('GET'), env, { id: 'u1' });
  const p = await handleProgressPut(req('PUT', { data: { total: 1 } }), env, { id: 'u1' });
  assert.equal(g.status, 501); assert.equal(p.status, 501);
  assert.match((await g.json()).error, /schema\.sql/);
});

// ---------- lembretes ----------
const now = (date, hm) => ({ date, hm, weekday: new Date(date + 'T00:00:00Z').getUTCDay() });
const listRem = (extra) => Object.assign({ listId: 'c', listName: 'Casa', emoji: '🏠', time: '08:00', enabled: true, hasPending: true }, extra || {});

test('lembrete de lista: dispara no horário exato, uma vez por dia', () => {
  const rec = { reminders: [listRem()] };
  assert.equal(planReminders(rec, now(D(14), '07:59')).due.length, 0);
  const p = planReminders(rec, now(D(14), '08:00'));
  assert.equal(p.due.length, 1); assert.equal(p.due[0].payload.title, '🏠 Casa');
  p.due[0].mark();
  assert.equal(planReminders(rec, now(D(14), '08:00')).due.length, 0, 'não repete no mesmo dia');
  assert.equal(planReminders(rec, now(D(15), '08:00')).due.length, 1, 'volta no dia seguinte');
});

test('lembrete de lista: respeita dias da semana e hasPending (comportamento anterior preservado)', () => {
  const wed = D(14); // 2026-10-14 é quarta (3)
  assert.equal(new Date(wed + 'T00:00:00Z').getUTCDay(), 3);
  let rec = { reminders: [listRem({ days: [1, 5] })] };
  let p = planReminders(rec, now(wed, '08:00'));
  assert.equal(p.due.length, 0); assert.equal(p.changed, true);
  rec = { reminders: [listRem({ days: [3] })] };
  assert.equal(planReminders(rec, now(wed, '08:00')).due.length, 1);
  rec = { reminders: [listRem({ days: [] })] };
  assert.equal(planReminders(rec, now(wed, '08:00')).due.length, 1, 'days vazio = todo dia');
  rec = { reminders: [listRem({ hasPending: false })] };
  assert.equal(planReminders(rec, now(wed, '08:00')).due.length, 0);
  rec = { reminders: [listRem({ enabled: false })] };
  assert.equal(planReminders(rec, now(wed, '08:00')).due.length, 0);
  assert.equal(planReminders({ reminders: [listRem()] }, now(wed, '08:00')).due.length, 1, 'registro antigo (sem taskReminders/muteDate) segue igual');
});

const tr = (extra) => Object.assign({ listId: 'c', itemId: 'i1', listName: 'Casa', emoji: '🏠', text: 'Ligar pro dentista', date: D(14), time: '15:30' }, extra || {});

test('lembrete por tarefa: dispara no dia e horário, com o texto da tarefa', () => {
  const rec = { reminders: [], taskReminders: [tr()] };
  assert.equal(planReminders(rec, now(D(14), '15:29')).due.length, 0);
  const p = planReminders(rec, now(D(14), '15:30'));
  assert.equal(p.due.length, 1);
  assert.equal(p.due[0].payload.title, '🏠 Ligar pro dentista');
  assert.match(p.due[0].payload.body, /Casa/);
  assert.equal(p.due[0].payload.tag, 'checklist-task-i1');
  p.due[0].mark();
  assert.equal(planReminders(rec, now(D(14), '15:31')).due.length, 0, 'enviado: não repete');
});

test('lembrete por tarefa: tolera até 2 minutos de atraso do cron e não mais que isso', () => {
  const mk = () => ({ taskReminders: [tr()] });
  assert.equal(planReminders(mk(), now(D(14), '15:32')).due.length, 1);
  assert.equal(planReminders(mk(), now(D(14), '15:33')).due.length, 0);
});

test('lembrete por tarefa: outro dia não dispara; dias passados são descartados', () => {
  const rec = { taskReminders: [tr({ date: D(13) }), tr({ itemId: 'i2', date: D(15) }), tr({ itemId: 'i3', date: D(14), time: '09:00' })] };
  const p = planReminders(rec, now(D(14), '15:30'));
  assert.equal(p.due.length, 0);
  assert.equal(p.changed, true);
  assert.deepEqual(rec.taskReminders.map((t) => t.itemId).sort(), ['i2', 'i3'], 'o de ontem sai');
});

test('"silenciar hoje" bloqueia tudo naquele dia, e só naquele dia', () => {
  const rec = { muteDate: D(14), reminders: [listRem()], taskReminders: [tr({ time: '08:00' })] };
  assert.equal(planReminders(rec, now(D(14), '08:00')).due.length, 0);
  assert.equal(planReminders({ ...rec, muteDate: D(13) }, now(D(14), '08:00')).due.length, 2, 'silêncio de ontem não vale hoje');
  assert.equal(planReminders({ ...rec, muteDate: null }, now(D(14), '08:00')).due.length, 2);
});

test('lembrete de tarefa e de lista no mesmo minuto: os dois saem', () => {
  const rec = { reminders: [listRem({ time: '15:30' })], taskReminders: [tr()] };
  assert.equal(planReminders(rec, now(D(14), '15:30')).due.length, 2);
});

test('sanitizeTaskReminders: valida formato, limita tamanhos e quantidade', () => {
  const bad = [null, { date: 'x', time: '10:00', listId: 'a', itemId: 'b' }, { date: D(14), time: '25', listId: 'a', itemId: 'b' }, { date: D(14), time: '10:00', itemId: 'b' }, 'texto'];
  assert.deepEqual(sanitizeTaskReminders(bad), []);
  assert.deepEqual(sanitizeTaskReminders('x'), []);
  const ok = sanitizeTaskReminders([{ listId: 'a', itemId: 'b', date: D(14), time: '10:00', text: 'y'.repeat(500), listName: 'z'.repeat(500), extra: 'descartado' }]);
  assert.equal(ok.length, 1); assert.equal(ok[0].text.length, 120); assert.equal(ok[0].listName.length, 60); assert.ok(!('extra' in ok[0]));
  assert.equal(sanitizeTaskReminders(Array.from({ length: 300 }, (_, i) => ({ listId: 'a', itemId: 'i' + i, date: D(14), time: '10:00' }))).length, 100);
});

test('carrySent: reenviar o registro não reativa lembretes já enviados', () => {
  const old = { taskReminders: [{ ...tr(), sent: true }, tr({ itemId: 'i2' })], reminders: [listRem({ lastSentDate: D(14) })] };
  const next = { taskReminders: [tr(), tr({ itemId: 'i2' }), tr({ itemId: 'i3' })], reminders: [listRem()] };
  carrySent(old, next);
  assert.deepEqual(next.taskReminders.map((t) => !!t.sent), [true, false, false]);
  assert.equal(next.reminders[0].lastSentDate, D(14));
  assert.equal(taskKey(tr()), 'c:i1:' + D(14) + ':15:30');
  assert.equal(carrySent(null, { a: 1 }).a, 1);
  // se a hora mudou, é outro lembrete
  const moved = carrySent({ taskReminders: [{ ...tr(), sent: true }] }, { taskReminders: [tr({ time: '16:00' })] });
  assert.equal(!!moved.taskReminders[0].sent, false);
});

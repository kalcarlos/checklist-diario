// Progresso sincronizado entre aparelhos (so contagens e marcas, nunca textos).
// Tudo aqui e puro (sem I/O) para poder ser testado em Node; as rotas usam D1.
//
// Formato: {
//   days:      { 'YYYY-MM-DD': n },          itens marcados por dia
//   doneLists: { 'YYYY-MM-DD': n },          listas concluidas por dia
//   badges:    { id: 'YYYY-MM-DD' },         conquista -> dia em que foi desbloqueada
//   total, listsDone: n,
//   reviews:   { 'YYYY-MM-DD': { seen: true, at: 'YYYY-MM-DD' } }   so que a semana foi vista
// }
// O merge e comutativo, associativo e idempotente (max por dia, menor data por
// conquista), entao a ordem em que os aparelhos sincronizam nao importa.

import { json, fail } from './util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]{2,24}$/;
const MAX_DAYS = 400;
const MAX_BADGES = 60;
const MAX_REVIEWS = 60;
const MAX_COUNT = 100000;
const MAX_BODY = 64 * 1024;

function count(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 0;
}

function recentDates(map, max) {
  return Object.keys(map).sort().slice(-max);
}

// Aceita so o formato acima; descarta qualquer outra coisa (inclusive texto livre).
export function sanitizeProgress(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { days: {}, doneLists: {}, badges: {}, total: count(src.total), listsDone: count(src.listsDone), reviews: {} };

  for (const field of ['days', 'doneLists']) {
    const m = src[field] && typeof src[field] === 'object' ? src[field] : {};
    const clean = {};
    Object.keys(m).filter((k) => DATE_RE.test(k)).forEach((k) => { const n = count(m[k]); if (n) clean[k] = n; });
    recentDates(clean, MAX_DAYS).forEach((k) => { out[field][k] = clean[k]; });
  }

  const b = src.badges && typeof src.badges === 'object' ? src.badges : {};
  Object.keys(b).filter((k) => ID_RE.test(k) && typeof b[k] === 'string' && DATE_RE.test(b[k])).slice(0, MAX_BADGES)
    .forEach((k) => { out.badges[k] = b[k]; });

  const r = src.reviews && typeof src.reviews === 'object' ? src.reviews : {};
  const keys = Object.keys(r).filter((k) => DATE_RE.test(k) && r[k] && r[k].seen === true).sort().slice(-MAX_REVIEWS);
  keys.forEach((k) => { out.reviews[k] = { seen: true, at: DATE_RE.test(r[k].at || '') ? r[k].at : k }; });
  return out;
}

export function mergeProgress(a, b) {
  const x = sanitizeProgress(a), y = sanitizeProgress(b);
  const out = { days: {}, doneLists: {}, badges: {}, total: Math.max(x.total, y.total), listsDone: Math.max(x.listsDone, y.listsDone), reviews: {} };
  for (const field of ['days', 'doneLists']) {
    new Set([...Object.keys(x[field]), ...Object.keys(y[field])]).forEach((k) => {
      out[field][k] = Math.max(x[field][k] || 0, y[field][k] || 0);
    });
    const keep = recentDates(out[field], MAX_DAYS);
    const trimmed = {};
    keep.forEach((k) => { trimmed[k] = out[field][k]; });
    out[field] = trimmed;
  }
  new Set([...Object.keys(x.badges), ...Object.keys(y.badges)]).forEach((id) => {
    const d = [x.badges[id], y.badges[id]].filter(Boolean).sort()[0]; // a mais antiga
    out.badges[id] = d;
  });
  new Set([...Object.keys(x.reviews), ...Object.keys(y.reviews)]).forEach((k) => {
    const at = [x.reviews[k] && x.reviews[k].at, y.reviews[k] && y.reviews[k].at].filter(Boolean).sort()[0];
    out.reviews[k] = { seen: true, at };
  });
  return out;
}

// ---------- rotas (D1) ----------

export async function handleProgressGet(request, env, user) {
  try {
    const row = await env.DB.prepare('SELECT data, updated_at AS updatedAt FROM progress WHERE user_id = ?').bind(user.id).first();
    if (!row) return json({ data: null, updatedAt: 0 });
    return json({ data: sanitizeProgress(JSON.parse(row.data)), updatedAt: row.updatedAt });
  } catch (e) {
    return fail(501, 'progresso indisponivel: aplique o schema.sql no banco (tabela progress)');
  }
}

export async function handleProgressPut(request, env, user) {
  const text = await request.text();
  if (text.length > MAX_BODY) return fail(413, 'dados grandes demais');
  let body;
  try { body = JSON.parse(text); } catch (e) { return fail(400, 'json invalido'); }
  if (!body || typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) return fail(400, 'dados invalidos');
  try {
    const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?').bind(user.id).first();
    const merged = mergeProgress(row ? JSON.parse(row.data) : {}, body.data);
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(user.id, JSON.stringify(merged), now).run();
    return json({ data: merged, updatedAt: now });
  } catch (e) {
    return fail(501, 'progresso indisponivel: aplique o schema.sql no banco (tabela progress)');
  }
}

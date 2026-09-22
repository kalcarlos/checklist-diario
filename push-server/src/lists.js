// Listas com permissoes: dono (owner), editor e leitor (viewer).
// O servidor e quem manda: o papel vem do banco, nunca do cliente.

import { json, fail, randomInviteCode, readJson } from './util.js';

const LIST_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const MAX_LIST_BYTES = 256 * 1024;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_USES = 10;
const MAX_MEMBERS = 20; // alem do dono
// Campos que o editor pode mudar; o resto (nome, emoji, tipo, lembrete...) e so do dono.
const EDITOR_FIELDS = ['items', 'lastResetDate'];

function validRole(role) {
  return role === 'editor' || role === 'viewer';
}

function validListData(data) {
  return data && typeof data === 'object' && !Array.isArray(data) &&
    typeof data.name === 'string' && Array.isArray(data.items);
}

async function getAccess(env, listId, userId) {
  const row = await env.DB.prepare(
    'SELECT l.owner_id AS ownerId, l.data AS data, l.rev AS rev, l.updated_at AS updatedAt, ' +
    'm.role AS memberRole FROM lists l ' +
    'LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = ? WHERE l.id = ?'
  ).bind(userId, listId).first();
  if (!row) return null;
  const role = row.ownerId === userId ? 'owner' : row.memberRole;
  if (!role) return null; // sem vinculo = a lista "nao existe" pra esse usuario
  return { role, ownerId: row.ownerId, data: JSON.parse(row.data), rev: row.rev, updatedAt: row.updatedAt };
}

export async function handleListsGet(request, env, user) {
  const { results } = await env.DB.prepare(
    'SELECT l.id AS id, l.data AS data, l.rev AS rev, l.updated_at AS updatedAt, ' +
    'ou.username AS ownerName, ' +
    "CASE WHEN l.owner_id = ?1 THEN 'owner' ELSE m.role END AS role " +
    'FROM lists l JOIN users ou ON ou.id = l.owner_id ' +
    'LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = ?1 ' +
    'WHERE l.owner_id = ?1 OR m.user_id = ?1'
  ).bind(user.id).all();

  const members = {};
  if (results.length) {
    const ids = results.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const memRes = await env.DB.prepare(
      'SELECT m.list_id AS listId, m.user_id AS userId, u.username AS username, m.role AS role ' +
      'FROM list_members m JOIN users u ON u.id = m.user_id WHERE m.list_id IN (' + marks + ')'
    ).bind(...ids).all();
    memRes.results.forEach((m) => {
      (members[m.listId] = members[m.listId] || []).push({ userId: m.userId, username: m.username, role: m.role });
    });
  }

  return json({
    lists: results.map((r) => ({
      id: r.id, role: r.role, rev: r.rev, updatedAt: r.updatedAt, ownerName: r.ownerName,
      data: JSON.parse(r.data), members: members[r.id] || [],
    })),
  });
}

export async function handleListPut(request, env, user, listId) {
  if (!LIST_ID_RE.test(listId)) return fail(400, 'id de lista invalido');
  const raw = await request.text();
  if (raw.length > MAX_LIST_BYTES) return fail(413, 'lista grande demais');
  let body;
  try { body = JSON.parse(raw); } catch (e) { body = null; }
  if (!body || !validListData(body.data)) return fail(400, 'dados invalidos');

  const now = Date.now();
  const access = await getAccess(env, listId, user.id);

  if (!access) {
    const taken = await env.DB.prepare('SELECT 1 AS x FROM lists WHERE id = ?').bind(listId).first();
    if (taken) return fail(404, 'lista nao encontrada');
    await env.DB.prepare('INSERT INTO lists (id, owner_id, data, rev, updated_at) VALUES (?, ?, ?, 1, ?)')
      .bind(listId, user.id, JSON.stringify(body.data), now).run();
    return json({ rev: 1, updatedAt: now, role: 'owner' });
  }

  if (access.role === 'viewer') return fail(403, 'voce so pode ver essa lista');
  if (body.baseRev !== access.rev) {
    return json({ error: 'conflito', rev: access.rev, role: access.role, data: access.data, updatedAt: access.updatedAt }, 409);
  }

  let data = body.data;
  if (access.role === 'editor') {
    data = { ...access.data };
    EDITOR_FIELDS.forEach((f) => { if (f in body.data) data[f] = body.data[f]; });
  }

  const res = await env.DB.prepare('UPDATE lists SET data = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?')
    .bind(JSON.stringify(data), now, listId, access.rev).run();
  if (!res.meta.changes) {
    // Alguem gravou entre a leitura e a escrita.
    const fresh = await getAccess(env, listId, user.id);
    return json({ error: 'conflito', rev: fresh.rev, role: fresh.role, data: fresh.data, updatedAt: fresh.updatedAt }, 409);
  }
  return json({ rev: access.rev + 1, updatedAt: now, role: access.role, data });
}

export async function handleListDelete(request, env, user, listId) {
  const access = await getAccess(env, listId, user.id);
  if (!access) return fail(404, 'lista nao encontrada');
  if (access.role !== 'owner') return fail(403, 'so o dono exclui a lista');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invites WHERE list_id = ?').bind(listId),
    env.DB.prepare('DELETE FROM list_members WHERE list_id = ?').bind(listId),
    env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(listId),
  ]);
  return json({ ok: true });
}

export async function handleInviteCreate(request, env, user, listId) {
  const access = await getAccess(env, listId, user.id);
  if (!access) return fail(404, 'lista nao encontrada');
  if (access.role !== 'owner') return fail(403, 'so o dono cria convites');
  const body = await readJson(request);
  if (!body || !validRole(body.role)) return fail(400, 'papel invalido');
  const code = randomInviteCode();
  const expiresAt = Date.now() + INVITE_TTL_MS;
  await env.DB.prepare('INSERT INTO invites (code, list_id, role, created_by, expires_at, uses_left) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(code, listId, body.role, user.id, expiresAt, INVITE_USES).run();
  return json({ code, role: body.role, expiresAt });
}

export async function handleInvitesList(request, env, user, listId) {
  const access = await getAccess(env, listId, user.id);
  if (!access) return fail(404, 'lista nao encontrada');
  if (access.role !== 'owner') return fail(403, 'so o dono ve os convites');
  const { results } = await env.DB.prepare(
    'SELECT code, role, expires_at AS expiresAt, uses_left AS usesLeft FROM invites ' +
    'WHERE list_id = ? AND expires_at > ? AND uses_left > 0'
  ).bind(listId, Date.now()).all();
  return json({ invites: results });
}

export async function handleInviteRevoke(request, env, user, listId, code) {
  const access = await getAccess(env, listId, user.id);
  if (!access) return fail(404, 'lista nao encontrada');
  if (access.role !== 'owner') return fail(403, 'so o dono revoga convites');
  await env.DB.prepare('DELETE FROM invites WHERE code = ? AND list_id = ?').bind(code, listId).run();
  return json({ ok: true });
}

export async function handleInviteAccept(request, env, user) {
  const body = await readJson(request);
  const code = body && typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return fail(400, 'codigo invalido');

  const invite = await env.DB.prepare('SELECT list_id AS listId, role, expires_at AS expiresAt, uses_left AS usesLeft FROM invites WHERE code = ?')
    .bind(code).first();
  if (!invite || invite.expiresAt <= Date.now() || invite.usesLeft <= 0) return fail(404, 'convite invalido ou expirado');

  const list = await env.DB.prepare('SELECT owner_id AS ownerId FROM lists WHERE id = ?').bind(invite.listId).first();
  if (!list) return fail(404, 'convite invalido ou expirado');
  if (list.ownerId === user.id) return fail(409, 'essa lista ja e sua');

  const already = await env.DB.prepare('SELECT 1 AS x FROM list_members WHERE list_id = ? AND user_id = ?')
    .bind(invite.listId, user.id).first();
  if (!already) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?').bind(invite.listId).first();
    if (count.n >= MAX_MEMBERS) return fail(409, 'essa lista ja atingiu o limite de ' + MAX_MEMBERS + ' membros');
  }

  // Consome o uso de forma atomica; so entra quem conseguiu decrementar.
  const used = await env.DB.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ? AND uses_left > 0').bind(code).run();
  if (!used.meta.changes) return fail(404, 'convite invalido ou expirado');

  await env.DB.prepare(
    'INSERT INTO list_members (list_id, user_id, role) VALUES (?, ?, ?) ' +
    'ON CONFLICT(list_id, user_id) DO UPDATE SET role = excluded.role'
  ).bind(invite.listId, user.id, invite.role).run();
  return json({ listId: invite.listId, role: invite.role });
}

export async function handleMemberPatch(request, env, user, listId, memberId) {
  const access = await getAccess(env, listId, user.id);
  if (!access) return fail(404, 'lista nao encontrada');
  if (access.role !== 'owner') return fail(403, 'so o dono muda papeis');
  const body = await readJson(request);
  if (!body || !validRole(body.role)) return fail(400, 'papel invalido');
  const res = await env.DB.prepare('UPDATE list_members SET role = ? WHERE list_id = ? AND user_id = ?')
    .bind(body.role, listId, memberId).run();
  if (!res.meta.changes) return fail(404, 'membro nao encontrado');
  return json({ ok: true });
}

// O dono remove qualquer membro; um membro so pode remover a si mesmo (sair).
export async function handleMemberDelete(request, env, user, listId, memberId) {
  const access = await getAccess(env, listId, user.id);
  if (!access) return fail(404, 'lista nao encontrada');
  if (access.role !== 'owner' && memberId !== user.id) return fail(403, 'sem permissao');
  await env.DB.prepare('DELETE FROM list_members WHERE list_id = ? AND user_id = ?').bind(listId, memberId).run();
  return json({ ok: true });
}

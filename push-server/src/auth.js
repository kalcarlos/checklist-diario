// Contas de usuario: cadastro, login, sessao. Senha com PBKDF2-SHA256;
// o token de sessao e aleatorio, e o banco guarda so o SHA-256 dele.

import {
  json, fail, sha256Hex, randomToken, randomId, bytesToB64url, b64urlToBytes,
  timingSafeEqual, readJson,
} from './util.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100000; // maximo aceito pelo Workers
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256
  );
  return new Uint8Array(bits);
}

// Limite simples por chave (KV, janela fixa). Retorna true se ainda pode tentar.
async function underRateLimit(env, key, max, windowSec) {
  const kvKey = 'rl:' + key;
  const count = Number((await env.SUBSCRIPTIONS.get(kvKey)) || 0);
  if (count >= max) return false;
  await env.SUBSCRIPTIONS.put(kvKey, String(count + 1), { expirationTtl: Math.max(60, windowSec) });
  return true;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS).run();
  return token;
}

// Devolve { id, username, tokenHash } da sessao valida, ou null.
export async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    'SELECT s.user_id AS id, s.expires_at AS expiresAt, u.username AS username ' +
    'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(tokenHash).first();
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  if (row.expiresAt - now < RENEW_WHEN_LEFT_MS) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(now + SESSION_TTL_MS, tokenHash).run();
  }
  return { id: row.id, username: row.username, tokenHash };
}

function validCredentials(body) {
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return 'dados invalidos';
  if (!USERNAME_RE.test(body.username)) return 'usuario deve ter 3 a 24 caracteres (letras, numeros, _ . -)';
  if (body.password.length < 6 || body.password.length > 200) return 'senha deve ter pelo menos 6 caracteres';
  return null;
}

export async function handleRegister(request, env) {
  const body = await readJson(request);
  const invalid = validCredentials(body);
  if (invalid) return fail(400, invalid);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await underRateLimit(env, 'register:' + ip, 10, 3600))) {
    return fail(429, 'muitos cadastros deste aparelho, tente mais tarde');
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(body.username).first();
  if (existing) return fail(409, 'esse usuario ja existe');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(body.password, salt);
  const id = randomId();
  try {
    await env.DB.prepare('INSERT INTO users (id, username, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, body.username, bytesToB64url(hash), bytesToB64url(salt), Date.now()).run();
  } catch (e) {
    return fail(409, 'esse usuario ja existe');
  }
  const token = await createSession(env, id);
  return json({ token, user: { id, username: body.username } });
}

export async function handleLogin(request, env) {
  const body = await readJson(request);
  const invalid = validCredentials(body);
  if (invalid) return fail(400, 'usuario ou senha invalidos');

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed =
    (await underRateLimit(env, 'login-user:' + body.username.toLowerCase(), 10, 300)) &&
    (await underRateLimit(env, 'login-ip:' + ip, 30, 300));
  if (!allowed) return fail(429, 'muitas tentativas, espere alguns minutos');

  const user = await env.DB.prepare('SELECT id, username, pass_hash, pass_salt FROM users WHERE username = ?')
    .bind(body.username).first();
  // Mesmo custo de PBKDF2 quando o usuario nao existe, pra nao revelar quem tem conta.
  const salt = user ? b64urlToBytes(user.pass_salt) : new Uint8Array(16);
  const hash = await hashPassword(body.password, salt);
  if (!user || !timingSafeEqual(hash, b64urlToBytes(user.pass_hash))) {
    return fail(401, 'usuario ou senha invalidos');
  }
  const token = await createSession(env, user.id);
  return json({ token, user: { id: user.id, username: user.username } });
}

export async function handleLogout(request, env, user) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run();
  return json({ ok: true });
}

export async function handleMe(request, env, user) {
  return json({ user: { id: user.id, username: user.username } });
}

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

// ---------- login com Google ----------
// O app manda o ID token (JWT) do Google; aqui conferimos assinatura, emissor, publico e validade.

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function verifyGoogleToken(idToken, env) {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = decodeJwtPart(parts[0]); payload = decodeJwtPart(parts[1]); } catch (e) { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;

  const jwks = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } }).then((r) => r.json());
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') return null;
  if (payload.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (!payload.exp || payload.exp < now) return null;
  if (!payload.sub) return null;
  return payload;
}

function usernameFromGoogle(payload) {
  const base = String(payload.email || payload.name || 'usuario').split('@')[0]
    .replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 18) || 'usuario';
  return base.length < 3 ? base + '_g' : base;
}

export async function handleGoogleLogin(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return fail(503, 'login com Google nao configurado');
  const body = await readJson(request);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await underRateLimit(env, 'google-ip:' + ip, 30, 300))) return fail(429, 'muitas tentativas, espere alguns minutos');

  const payload = body ? await verifyGoogleToken(body.credential, env).catch(() => null) : null;
  if (!payload) return fail(401, 'login com Google invalido');

  const found = await env.DB.prepare(
    'SELECT u.id AS id, u.username AS username FROM oauth_identities o JOIN users u ON u.id = o.user_id ' +
    "WHERE o.provider = 'google' AND o.subject = ?"
  ).bind(payload.sub).first();
  if (found) {
    return json({ token: await createSession(env, found.id), user: { id: found.id, username: found.username } });
  }

  const id = randomId();
  const base = usernameFromGoogle(payload);
  let username = base;
  for (let i = 0; i < 6; i++) {
    const taken = await env.DB.prepare('SELECT 1 AS x FROM users WHERE username = ?').bind(username).first();
    if (!taken) break;
    username = base.slice(0, 18) + '_' + randomToken(3).replace(/[^A-Za-z0-9]/g, '').slice(0, 4);
  }
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, pass_hash, pass_salt, created_at) VALUES (?, ?, '', '', ?)")
        .bind(id, username, Date.now()),
      env.DB.prepare("INSERT INTO oauth_identities (provider, subject, user_id, email) VALUES ('google', ?, ?, ?)")
        .bind(payload.sub, id, payload.email || null),
    ]);
  } catch (e) {
    return fail(409, 'nao foi possivel criar a conta, tente de novo');
  }
  return json({ token: await createSession(env, id), user: { id, username } });
}

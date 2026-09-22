// Servidor de lembretes e backup (Cloudflare Worker).
// Guarda inscricoes de push por lista e dispara notificacao no horario configurado.
// Implementa Web Push (RFC 8291 / RFC 8292) so com Web Crypto + fetch, sem
// depender do pacote "web-push" (que usa https/node e nao roda em Workers).
// Tambem guarda um backup dos dados do checklist por "codigo de sincronizacao",
// pra recuperar em outro aparelho (rotas /data/save e /data/load).

import { fail } from './util.js';
import {
  authenticate, handleGoogleLogin, handleGoogleLink, handleRegister, handleLogin, handleLogout, handleMe,
  handleUsernameChange, handleAccountDelete,
} from './auth.js';
import {
  handleListsGet, handleListPut, handleListDelete, handleInviteCreate, handleInvitesList,
  handleInviteRevoke, handleInviteAccept, handleMemberPatch, handleMemberDelete,
} from './lists.js';

const ALLOWED_ORIGINS = new Set([
  'https://kalcarlos.github.io',
  'http://localhost:8080',
  'http://localhost:8934',
  'http://localhost:4205',
  'http://127.0.0.1:4205',
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://kalcarlos.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// Rotas de conta e listas (D1). Devolve null se a rota nao for dessas.
async function routeAccounts(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === 'POST' && path === '/auth/register') return handleRegister(request, env);
  if (method === 'POST' && path === '/auth/login') return handleLogin(request, env);
  if (method === 'POST' && path === '/auth/google') return handleGoogleLogin(request, env);

  const isProtected = path === '/auth/logout' || path === '/auth/me' || path === '/auth/google/link' ||
    path === '/lists' || path.startsWith('/lists/') || path === '/invites/accept';
  if (!isProtected) return null;

  const user = await authenticate(request, env);
  if (!user) return fail(401, 'nao autenticado');

  if (method === 'POST' && path === '/auth/logout') return handleLogout(request, env, user);
  if (method === 'GET' && path === '/auth/me') return handleMe(request, env, user);
  if (method === 'PATCH' && path === '/auth/me') return handleUsernameChange(request, env, user);
  if (method === 'DELETE' && path === '/auth/me') return handleAccountDelete(request, env, user);
  if (method === 'POST' && path === '/auth/google/link') return handleGoogleLink(request, env, user);
  if (method === 'GET' && path === '/lists') return handleListsGet(request, env, user);
  if (method === 'POST' && path === '/invites/accept') return handleInviteAccept(request, env, user);

  const parts = path.split('/').filter(Boolean); // ['lists', id, ...]
  if (parts[0] === 'lists' && parts[1]) {
    const listId = decodeURIComponent(parts[1]);
    if (parts.length === 2) {
      if (method === 'PUT') return handleListPut(request, env, user, listId);
      if (method === 'DELETE') return handleListDelete(request, env, user, listId);
    }
    if (parts[2] === 'invites') {
      if (parts.length === 3 && method === 'POST') return handleInviteCreate(request, env, user, listId);
      if (parts.length === 3 && method === 'GET') return handleInvitesList(request, env, user, listId);
      if (parts.length === 4 && method === 'DELETE') return handleInviteRevoke(request, env, user, listId, decodeURIComponent(parts[3]));
    }
    if (parts[2] === 'members' && parts[3] && parts.length === 4) {
      const memberId = decodeURIComponent(parts[3]);
      if (method === 'PATCH') return handleMemberPatch(request, env, user, listId, memberId);
      if (method === 'DELETE') return handleMemberDelete(request, env, user, listId, memberId);
    }
  }
  return fail(404, 'rota nao encontrada');
}

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function importVapidPrivateKey(publicKeyB64url, privateKeyB64url) {
  const pub = b64urlToBytes(publicKeyB64url); // 65 bytes: 0x04 || x(32) || y(32)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const d = b64urlToBytes(privateKeyB64url); // 32 bytes
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true, key_ops: ['sign'],
    x: bytesToB64url(x), y: bytesToB64url(y), d: bytesToB64url(d),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildVapidAuthHeader(endpoint, env) {
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT };
  const encHeader = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const privateKey = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Criptografa o payload conforme RFC 8291 (aes128gcm).
async function encryptPayload(payloadObj, p256dhB64url, authB64url) {
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
  const uaPublicBytes = b64urlToBytes(p256dhB64url); // 65 bytes
  const authSecret = b64urlToBytes(authB64url); // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    'raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, true, []
  );

  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  const ecdhSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256
  );
  const ecdhSecret = new Uint8Array(ecdhSecretBits);

  // Estagio 1: combina segredo ECDH com o auth_secret da inscricao.
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    uaPublicBytes,
    asPublicBytes
  );
  const ikmKey = await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits']);
  const ikmBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, ikmKey, 256
  );
  const ikm = new Uint8Array(ikmBits);

  // Estagio 2: deriva chave de conteudo (CEK) e nonce, com salt aleatorio por mensagem.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm2Key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\0') },
    ikm2Key, 128
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\0') },
    ikm2Key, 96
  );

  const cekKey = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const paddedPlaintext = concatBytes(plaintext, new Uint8Array([0x02])); // delimitador de ultimo registro
  const ciphertextBits = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonceBits), tagLength: 128 }, cekKey, paddedPlaintext
  );
  const ciphertext = new Uint8Array(ciphertextBits);

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(
    salt,
    recordSize,
    new Uint8Array([asPublicBytes.length]),
    asPublicBytes
  );

  return concatBytes(header, ciphertext);
}

async function sendWebPush(subscription, payloadObj, env) {
  const body = await encryptPayload(payloadObj, subscription.keys.p256dh, subscription.keys.auth);
  const authHeader = await buildVapidAuthHeader(subscription.endpoint, env);

  const resp = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': authHeader,
    },
    body,
  });
  return resp;
}

function nowPartsInTz(tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  dtf.formatToParts(new Date()).forEach((p) => { map[p.type] = p.value; });
  return { date: `${map.year}-${map.month}-${map.day}`, hm: `${map.hour}:${map.minute}` };
}

async function handleSubscribe(request, env) {
  const body = await request.json();
  if (!body || !body.subscription || !body.subscription.endpoint) {
    return new Response('dados invalidos', { status: 400 });
  }
  const key = 'sub:' + (await sha256Hex(body.subscription.endpoint));
  const record = {
    subscription: body.subscription,
    timezone: body.timezone || 'America/Sao_Paulo',
    reminders: Array.isArray(body.reminders) ? body.reminders : [],
  };
  await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
  return new Response('ok');
}

async function handleUnsubscribe(request, env) {
  const body = await request.json();
  if (!body || !body.endpoint) return new Response('dados invalidos', { status: 400 });
  const key = 'sub:' + (await sha256Hex(body.endpoint));
  await env.SUBSCRIPTIONS.delete(key);
  return new Response('ok');
}

function isValidSyncCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{6,32}$/.test(code);
}

async function handleDataSave(request, env) {
  const body = await request.json();
  if (!body || !isValidSyncCode(body.code) || typeof body.data !== 'object' || body.data === null) {
    return new Response('dados invalidos', { status: 400 });
  }
  const record = { data: body.data, updatedAt: Date.now() };
  await env.SUBSCRIPTIONS.put('data:' + body.code, JSON.stringify(record));
  return new Response(JSON.stringify({ ok: true, updatedAt: record.updatedAt }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleDataLoad(request, env) {
  const body = await request.json();
  if (!body || !isValidSyncCode(body.code)) {
    return new Response('dados invalidos', { status: 400 });
  }
  const record = await env.SUBSCRIPTIONS.get('data:' + body.code, { type: 'json' });
  if (!record) return new Response('nao encontrado', { status: 404 });
  return new Response(JSON.stringify(record), { headers: { 'Content-Type': 'application/json' } });
}

async function runScheduledCheck(env) {
  const list = await env.SUBSCRIPTIONS.list();
  for (const { name: key } of list.keys) {
    const record = await env.SUBSCRIPTIONS.get(key, { type: 'json' });
    if (!record) continue;

    const { date, hm } = nowPartsInTz(record.timezone);
    let changed = false;

    for (const reminder of record.reminders) {
      if (!reminder.enabled) continue;
      if (reminder.time !== hm) continue;
      if (reminder.lastSentDate === date) continue;
      if (reminder.hasPending === false) { reminder.lastSentDate = date; changed = true; continue; }

      try {
        await sendWebPush(record.subscription, {
          title: `${reminder.emoji || '✅'} ${reminder.listName}`,
          body: 'Hora de checar essa lista.',
          tag: 'checklist-' + reminder.listId,
          listId: reminder.listId,
        }, env);
        reminder.lastSentDate = date;
        changed = true;
      } catch (err) {
        // Inscricao invalida (expirou / usuario desinstalou) -> remove.
        if (err && err.status === 410) {
          await env.SUBSCRIPTIONS.delete(key);
          changed = false;
          break;
        }
      }
    }

    if (changed) {
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    try {
      const accountResp = await routeAccounts(request, env, url);
      if (accountResp) {
        const headers = new Headers(accountResp.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(accountResp.body, { status: accountResp.status, headers });
      }
      if (request.method === 'POST' && url.pathname === '/subscribe') {
        const resp = await handleSubscribe(request, env);
        return new Response(resp.body, { status: resp.status, headers: cors });
      }
      if (request.method === 'POST' && url.pathname === '/unsubscribe') {
        const resp = await handleUnsubscribe(request, env);
        return new Response(resp.body, { status: resp.status, headers: cors });
      }
      if (request.method === 'POST' && url.pathname === '/data/save') {
        const resp = await handleDataSave(request, env);
        return new Response(resp.body, { status: resp.status, headers: cors });
      }
      if (request.method === 'POST' && url.pathname === '/data/load') {
        const resp = await handleDataLoad(request, env);
        return new Response(resp.body, { status: resp.status, headers: cors });
      }
    } catch (err) {
      return new Response('erro: ' + err.message, { status: 500, headers: cors });
    }

    return new Response('checklist-diario-push ok', { headers: cors });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledCheck(env));
  },
};

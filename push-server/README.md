# Servidor de lembretes (Cloudflare Worker)

Guarda as inscrições de notificação push por lista e dispara o aviso no horário configurado. 100% no plano gratuito da Cloudflare (Workers + Cron Trigger + KV).

Implementa Web Push (RFC 8291 / RFC 8292) manualmente com Web Crypto — não usa a lib `web-push` porque ela depende de `https`/`crypto` do Node, que não roda no runtime do Workers.

## Deploy do zero

```
npm install
npx wrangler login
npx wrangler kv namespace create SUBSCRIPTIONS
```

Copia o `id` que aparecer pro `wrangler.toml` (campo `id` em `[[kv_namespaces]]`).

Gerar chaves VAPID (autenticação do push):

```
node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log(k)"
```

(Precisa reinstalar `web-push` temporariamente com `npm install web-push` só pra gerar as chaves, depois pode remover — ele não é usado em produção.)

- Cole a `publicKey` em `wrangler.toml` (`VAPID_PUBLIC_KEY`) e em `../app.js` (`VAPID_PUBLIC_KEY`).
- Cole a `privateKey` como segredo, nunca no código:

```
npx wrangler secret put VAPID_PRIVATE_KEY
```

Deploy:

```
npx wrangler deploy
```

Na primeira vez, se pedir pra registrar um subdomínio `workers.dev`, faz isso pelo painel (Workers & Pages → Set up subdomain) e roda `deploy` de novo.

Copia a URL que aparecer (`https://checklist-diario-push.SEUSUBDOMINIO.workers.dev`) pra `PUSH_SERVER_URL` em `../app.js`, e adiciona a origem do app publicado em `ALLOWED_ORIGINS` (`src/index.js`) se for diferente de `https://kalcarlos.github.io`.

## Limitações

- Fuso horário: usa o fuso do navegador de quem ativou o lembrete (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- Se editar o horário de uma lista no mesmo dia em que o lembrete já disparou, pode repetir o aviso nesse dia (o controle de "já enviei hoje" fica no servidor e é sobrescrito a cada sincronização).

## Contas, listas e login com Google (D1)

O banco `checklist-diario-db` (binding `DB` em `wrangler.toml`) guarda usuários, sessões, listas, membros, convites e vínculos do Google.

```
npx wrangler d1 execute checklist-diario-db --remote --file=schema.sql
```

O `schema.sql` é idempotente (`CREATE TABLE IF NOT EXISTS`); rode de novo depois de alterá-lo, e só então `npx wrangler deploy`.

- Rotas: `/auth/register|login|google|logout|me`, `/lists` (GET), `/lists/:id` (PUT/DELETE), `/lists/:id/invites`, `/invites/accept`, `/lists/:id/members/:userId`.
- Permissões são checadas aqui: dono grava tudo, editor só `items` e `lastResetDate`, leitor recebe 403.
- Login com Google: `GOOGLE_CLIENT_ID` em `[vars]` deve ser igual ao `GOOGLE_CLIENT_ID` de `../app.js`. As origens do app precisam estar autorizadas no Client ID (Google Cloud → Credenciais).
- Sessões duram 30 dias; login e cadastro têm limite de tentativas (KV).

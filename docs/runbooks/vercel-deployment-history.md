# Histórico de Deploy na Vercel

Registro completo da tentativa de hospedar o AllSet na Vercel com serviços auxiliares (PostgreSQL, MinIO, Evolution API) rodando em uma VPS separada (`<VPS_IP>`). Documenta todos os erros encontrados, causas raiz e soluções aplicadas.

---

## Arquitetura tentada

```
Vercel (serverless)       VPS <VPS_IP> (Easypanel / Docker)
└── Next.js app     ←───► ├── PostgreSQL 17  (porta 5432 exposta)
                           ├── MinIO          (porta 9000 exposta)
                           └── Evolution API  (domínio público Easypanel)
```

---

## Erro 1 — 500 no login: banco inacessível

**Sintoma**
```
POST /api/auth/sign-in/email → 500
Can't reach database server at `allset_mvp_allset-db:5432`
```

**Causa**
A `DATABASE_URL` usava o hostname interno do Docker (`allset_mvp_allset-db`). Esse nome só existe dentro da rede Docker da VPS — a Vercel não consegue resolvê-lo.

**Solução**
Trocar para o IP público com a porta exposta:
```
DATABASE_URL=postgres://postgres:<senha>@<VPS_IP>:5432/allset_mvp?sslmode=disable
```

---

## Erro 2 — Nome do banco incorreto

**Sintoma**
```
database "allset-db" does not exist
```

**Causa**
O banco criado no Easypanel era `allset_mvp`, não `allset-db`.

**Solução**
Corrigir o nome na `DATABASE_URL` para `allset_mvp`.

---

## Erro 3 — 20 migrations nunca aplicadas

**Sintoma**
Erros de tabela inexistente (`OutboxMessage`, `BookingStatus`, etc.) nos logs do PostgreSQL após o login funcionar.

**Causa**
O banco foi criado vazio pelo Easypanel. O comando `prisma migrate deploy` nunca foi executado contra o banco de produção.

**Solução**
Rodar localmente apontando para o banco de produção:
```bash
DATABASE_URL="postgres://..." npx prisma migrate deploy
```

---

## Erro 4 — Advisory lock preso

**Sintoma**
`prisma migrate deploy` travou indefinidamente sem progresso.

**Causa**
Uma execução anterior do Prisma foi interrompida sem liberar o advisory lock `72707369` no PostgreSQL. O Prisma aguarda indefinidamente até obter o lock.

**Solução**
Conectar ao banco e matar a sessão que segurava o lock:
```sql
SELECT pg_terminate_backend(a.pid)
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory' AND l.objid = 72707369;
```

---

## Erro 5 — Migrations em estado inconsistente na `_prisma_migrations`

**Sintoma**
`prisma migrate deploy` reportava migrations como `failed` ou `rolled_back`, bloqueando o processo.

**Causa**
Execuções interrompidas anteriores deixaram registros em `_prisma_migrations` com status incorreto. Em alguns casos as tabelas já existiam no banco mas a migration não estava marcada como aplicada.

**Solução**
Para cada migration inconsistente, avaliar o estado real e resolver manualmente:

```bash
# Tabelas JÁ existem no banco — marcar como aplicada
npx prisma migrate resolve --applied <nome-da-migration>

# Tabelas NÃO existem — marcar como revertida e re-aplicar
npx prisma migrate resolve --rolled-back <nome-da-migration>
npx prisma migrate deploy
```

---

## Erro 6 — Loop de redirect no painel admin após login bem-sucedido

**Sintoma**
Login retornava 200, mas a UI ficava em loop em `/login`. Logs do servidor:
```
This page couldn't load / A server error occurred.
```

**Causa**
`src/app/admin/layout.tsx` exige duas condições:
1. Sessão válida na tabela `AuthUser` do Better Auth ✓
2. Registro na tabela de domínio `User` com `role = 'ADMIN'` ✗

O seed criou apenas o `AuthUser`. O `User` de domínio correspondente não existia, causando redirect infinito.

**Solução**
Inserir o registro de domínio diretamente:
```sql
-- Obter o ID do AuthUser
SELECT id FROM "AuthUser" WHERE email = 'admin@allset.app';

-- Inserir o User de domínio
INSERT INTO "User" (id, "authUserId", "phoneE164", role, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  '<id-obtido-acima>',
  '+5500000000000',
  'ADMIN',
  NOW(),
  NOW()
);
```

---

## Erro 7 — Webhook da Evolution retornando 401

**Sintoma**
```
UNAUTHORIZED evolution webhook (status 401)
```

**Causa**
A Evolution não enviava o header `x-allset-webhook-secret`. O webhook foi cadastrado sem o secret, e `EVOLUTION_WEBHOOK_SECRET` na Vercel estava vazia.

**Solução**

1. Gerar um novo secret:
   ```bash
   openssl rand -base64 32
   # <EVOLUTION_WEBHOOK_SECRET>
   ```

2. Configurar na Evolution API. O container não tinha `curl`, então foi feito via Node.js direto no container:
   ```bash
   docker exec -it <container-evolution> node -e "
     const http = require('http');
     const body = JSON.stringify({
       enabled: true,
       url: 'https://allset-whatsapp.vercel.app/api/messaging/evolution/webhook',
       webhookByEvents: false,
       webhookBase64: false,
       events: ['MESSAGES_UPSERT'],
       headers: { 'x-allset-webhook-secret': '<EVOLUTION_WEBHOOK_SECRET>' }
     });
     const req = http.request(
       { hostname: 'localhost', port: 8080, path: '/webhook/set/allset-mvp', method: 'POST',
         headers: { 'Content-Type': 'application/json', 'apikey': '<EVOLUTION_API_KEY>' } },
       res => res.on('data', d => process.stdout.write(d))
     );
     req.write(body); req.end();
   "
   ```

3. Adicionar `EVOLUTION_WEBHOOK_SECRET` na Vercel e fazer redeploy.

---

## Erro 8 — Outbox com `fetch failed` (Evolution inacessível)

**Sintoma**
Mensagens chegavam e eram salvas na outbox, mas nunca eram enviadas. Logs:
```
fetch failed — causa: connect ECONNREFUSED <VPS_IP>:8080
```

**Causa**
`EVOLUTION_BASE_URL` estava definida como `http://<VPS_IP>:8080`. A porta 8080 não estava exposta publicamente no Easypanel — só acessível internamente na VPS.

**Solução**
O Easypanel expõe cada serviço num domínio HTTPS público. Usar esse domínio:
```
EVOLUTION_BASE_URL=https://allset-mvp-evolution-api.vn6tpb.easypanel.host
```

---

## Erro 9 — Race condition: unique constraint em `ContactIntentConversation`

**Sintoma**
Em rajadas de webhook (múltiplos eventos simultâneos do mesmo número):
```
Unique constraint failed on the fields: (`phoneE164`)
```

**Causa**
Dois workers concorrentes faziam `findUnique` (retornava null para ambos) e em seguida tentavam `create` — um deles violava a unique constraint.

**Correção aplicada** em `src/application/customer/contact-intent-conversation.usecase.ts`:
```typescript
// Antes: findUnique → create (race condition)
// Depois:
const conversation = await tx.contactIntentConversation.upsert({
  where: { phoneE164: input.phoneE164 },
  create: { phoneE164: input.phoneE164, provider: input.provider, lastInboundAt: new Date() },
  update: { lastInboundAt: new Date() },
});
```

---

## Erro 10 — Grupos de WhatsApp disparando o fluxo de atendimento

**Sintoma**
Mensagens enviadas em grupos acionavam o webhook e iniciavam fluxos de recrutamento/atendimento.

**Causa**
A normalização do webhook não filtrava `remoteJid` com sufixo `@g.us` (identificador de grupos no protocolo WhatsApp).

**Correção aplicada** em `src/infrastructure/messaging/evolution-webhook.ts`:
```typescript
if (key.remoteJid.endsWith("@g.us")) return null;
```

---

## Problema estrutural — Respostas atrasadas ~2 minutos

**Sintoma**
Usuário enviava mensagem e recebia resposta após ~2 minutos.

**Causa**
O fluxo de resposta depende de dois passos assíncronos:
1. Webhook processa a mensagem e enfileira a resposta na outbox
2. Um cron drena a outbox a cada 2 minutos e envia via Evolution

Tentativa de correção: adicionar `dispatchNextOutboxMessage` como fire-and-forget diretamente no handler do webhook:
```typescript
dispatchNextOutboxMessage(prisma, createMessagingGatewayRegistry(), "system:webhook-dispatch")
  .catch(err => logger.error({ err }, "Falha ao despachar outbox inline"));
return Response.json({ ok: true, ...result });
```

**Por que não funcionou na Vercel**
Em funções serverless, o runtime é encerrado assim que a resposta HTTP é enviada. Promises em background são destruídas antes de completar — o dispatch nunca terminava de fato.

**Solução tentada (não aplicada)**
O pacote `@vercel/functions` oferece `waitUntil`, que mantém o contexto de execução vivo para tarefas em background:
```typescript
import { waitUntil } from "@vercel/functions";
waitUntil(dispatchNextOutboxMessage(...).catch(...));
return Response.json({ ok: true, ...result });
```

**Decisão final**
Migrar a aplicação para a VPS, onde o Node.js roda como processo contínuo e fire-and-forget funciona nativamente. Ver `docs/runbooks/vps-deploy.md`.

---

## Resumo das mudanças de código aplicadas durante a tentativa na Vercel

| Arquivo | Mudança |
|---|---|
| `src/infrastructure/messaging/evolution-webhook.ts` | Filtro de grupos (`@g.us`) |
| `src/application/customer/contact-intent-conversation.usecase.ts` | `findUnique + create` → `upsert` |
| `src/app/api/messaging/evolution/webhook/route.ts` | Fire-and-forget de dispatch inline (funciona na VPS) |

Essas mudanças foram mantidas na branch `feat/vps-deploy` pois continuam válidas e necessárias independente de onde o app roda.

# Runbook: Deploy na VPS (Easypanel)

Histórico completo do processo de deploy do AllSet — desde a tentativa na Vercel até a migração para VPS. Inclui todos os erros encontrados, causas raiz e como cada um foi resolvido.

---

## Arquitetura final

```
VPS (<VPS_IP>) — Easypanel
├── allset-app          → Next.js 16 (este repo, branch feat/vps-deploy)
├── allset-db           → PostgreSQL 17
├── minio               → MinIO (storage S3-compatível)
└── evolution-api       → Evolution API (gateway WhatsApp)
```

Todos os serviços se comunicam via rede Docker interna do Easypanel.  
Hostnames internos: `<projeto>_<serviço>` (ex.: `allset_mvp_evolution-api`).

---

## Parte 1 — Tentativa na Vercel (e por que não funcionou)

### Contexto inicial

O app foi deployado na Vercel com PostgreSQL, MinIO e Evolution API rodando na VPS.  
A ideia era usar Vercel para o app (serverless, zero-ops) e a VPS só para serviços auxiliares.

---

### Erro 1 — 500 no login (`DATABASE_URL` apontando para hostname interno Docker)

**Sintoma:** `POST /api/auth/sign-in/email` retornava 500. Logs da Vercel:
```
Can't reach database server at `allset_mvp_allset-db:5432`
```

**Causa:** A `DATABASE_URL` configurada na Vercel usava o hostname interno do Docker (`allset_mvp_allset-db`), que só é resolvível dentro da rede Docker da VPS. A Vercel não tem acesso a esse hostname.

**Solução:** Trocar para o IP público da VPS com a porta exposta:
```
DATABASE_URL=postgres://postgres:<DB_PASSWORD>@<VPS_IP>:5432/allset_mvp?sslmode=disable
```

---

### Erro 2 — Nome do banco incorreto

**Sintoma:** Conexão falhou com `database "allset-db" does not exist`.

**Causa:** O nome do banco configurado inicialmente era `allset-db`, mas o banco criado no Easypanel era `allset_mvp`.

**Solução:** Corrigir a `DATABASE_URL` para usar `allset_mvp`.

---

### Erro 3 — Migrations nunca aplicadas (20 migrations pendentes)

**Sintoma:** Erros de tabela não encontrada (`OutboxMessage`, `BookingStatus`, etc.) nos logs do PostgreSQL.

**Causa:** O banco foi criado vazio. As 20 migrations do Prisma nunca foram executadas contra o banco de produção.

**Solução:** Rodar manualmente com a `DATABASE_URL` de produção apontada:
```bash
npx prisma migrate deploy
```

---

### Erro 4 — Advisory lock preso (`72707369`)

**Sintoma:** `prisma migrate deploy` travou indefinidamente esperando pelo lock do Prisma.

**Causa:** Uma execução anterior do Prisma morreu sem liberar o advisory lock no PostgreSQL.

**Solução:** Conectar ao banco e matar a sessão que segurava o lock:
```sql
SELECT pg_terminate_backend(a.pid)
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory' AND l.objid = 72707369;
```

---

### Erro 5 — Migrations marcadas como falhas na tabela `_prisma_migrations`

**Sintoma:** `prisma migrate deploy` reportava migrations em estado `failed` ou `rolled_back`.

**Causa:** Execuções anteriores que foram interrompidas deixaram registros inconsistentes em `_prisma_migrations`. Algumas migrations tinham as tabelas criadas no banco mas não estavam marcadas como aplicadas.

**Solução:** Para cada migration inconsistente:
- Migrations onde as tabelas JÁ existiam no banco:
  ```bash
  npx prisma migrate resolve --applied <nome-da-migration>
  ```
- Migrations que realmente falharam (nenhuma tabela criada):
  ```bash
  npx prisma migrate resolve --rolled-back <nome-da-migration>
  ```
  Depois rodar `migrate deploy` novamente para aplicá-las.

---

### Erro 6 — Loop de redirect no painel admin após login

**Sintoma:** Login retornava 200 mas a UI ficava presa em `/login` sem avançar. Logs mostravam `This page couldn't load / A server error occurred`.

**Causa:** `src/app/admin/layout.tsx` verifica duas coisas:
1. Sessão válida do Better Auth (tabela `AuthUser`) ✓ existia
2. Registro na tabela de domínio `User` com `role: "ADMIN"` ✗ não existia

O seed do banco criou o `AuthUser` mas não criou o `User` de domínio correspondente.

**Solução:** Inserir o `User` de domínio diretamente via SQL:
```sql
INSERT INTO "User" (id, "authUserId", "phoneE164", role, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  '<id-do-auth-user>',
  '+5500000000000',
  'ADMIN',
  NOW(),
  NOW()
);
```

O `authUserId` foi obtido via `SELECT id FROM "AuthUser" WHERE email = 'admin@allset.app'`.

---

### Erro 7 — Webhook da Evolution retornando 401

**Sintoma:** Todos os webhooks chegavam com status 401. Log:
```
UNAUTHORIZED evolution webhook
```

**Causa:** A Evolution não estava enviando o header `x-allset-webhook-secret`. O webhook foi configurado sem o secret, e a variável `EVOLUTION_WEBHOOK_SECRET` na Vercel estava vazia.

**Solução (em dois passos):**

1. Gerar um novo secret:
   ```bash
   openssl rand -base64 32
   # Resultado: <EVOLUTION_WEBHOOK_SECRET>
   ```

2. Configurar na Evolution API via Node.js (sem curl disponível no container):
   ```bash
   docker exec -it <container-evolution> node -e "
   const http = require('http');
   const data = JSON.stringify({
     enabled: true,
     url: 'https://allset-whatsapp.vercel.app/api/messaging/evolution/webhook',
     webhookByEvents: false,
     webhookBase64: false,
     events: ['MESSAGES_UPSERT'],
     headers: { 'x-allset-webhook-secret': '<EVOLUTION_WEBHOOK_SECRET>' }
   });
   // ... requisição HTTP para a API interna da Evolution
   "
   ```

3. Adicionar `EVOLUTION_WEBHOOK_SECRET=<EVOLUTION_WEBHOOK_SECRET>` na Vercel e fazer redeploy.

---

### Erro 8 — Outbox com `fetch failed` (Evolution inacessível pela Vercel)

**Sintoma:** Mensagens chegavam no webhook e eram salvas no banco, mas a resposta nunca saía. Logs mostravam `fetch failed` ao tentar despachar a outbox.

**Causa:** `EVOLUTION_BASE_URL` estava configurada como `http://<VPS_IP>:8080`, mas essa porta não estava exposta publicamente no Easypanel. A Vercel não conseguia alcançar a Evolution.

**Solução:** O Easypanel gera um domínio público HTTPS para cada serviço. Trocar para o domínio público:
```
EVOLUTION_BASE_URL=https://allset-mvp-evolution-api.vn6tpb.easypanel.host
```

---

### Erro 9 — Race condition: `ContactIntentConversation` violando unique constraint

**Sintoma:** Em picos de webhook (múltiplas mensagens simultâneas do mesmo número), erro:
```
Unique constraint failed on the fields: (`phoneE164`)
```

**Causa:** Dois workers processavam o mesmo número ao mesmo tempo, ambos faziam `findUnique` (retornava null), e ambos tentavam `create` — um deles falhava.

**Solução:** Substituir find-then-create por `upsert` em `contact-intent-conversation.usecase.ts`:
```typescript
const conversation = await tx.contactIntentConversation.upsert({
  where: { phoneE164: input.phoneE164 },
  create: { phoneE164: input.phoneE164, provider: input.provider, lastInboundAt: new Date() },
  update: { lastInboundAt: new Date() },
});
```

---

### Erro 10 — Mensagens de grupos sendo processadas

**Sintoma:** Grupos de WhatsApp disparavam o fluxo de atendimento.

**Causa:** A normalização do webhook não filtrava `remoteJid` terminados em `@g.us` (identificador de grupos no WhatsApp).

**Solução:** Adicionar filtro explícito em `evolution-webhook.ts`:
```typescript
if (key.remoteJid.endsWith("@g.us")) return null;
```

---

### Problema 11 — Respostas atrasadas ~2 minutos (serverless + fire-and-forget)

**Sintoma:** Usuário mandava mensagem, recebia resposta após ~2 minutos em vez de imediatos.

**Causa raiz:** O fluxo de resposta é:
1. Webhook recebe mensagem → salva no banco → enfileira resposta na outbox
2. Um cron de 2 minutos drena a outbox e envia via Evolution

Na tentativa de corrigir, foi adicionado um `dispatchNextOutboxMessage` fire-and-forget direto no webhook handler. Mas em funções serverless da Vercel, promises em background são mortas quando a função retorna a resposta HTTP — o dispatch nunca completava.

**Por que não foi resolvido na Vercel:** A solução seria usar `waitUntil` do pacote `@vercel/functions` para manter o contexto de execução vivo. Optou-se por migrar para VPS onde Node.js é um processo contínuo e fire-and-forget funciona nativamente.

---

## Parte 2 — Migração para VPS

### Por que migrar

| Vercel | VPS |
|---|---|
| Função serverless morre após resposta | Processo Node.js contínuo |
| Fire-and-forget não funciona | Fire-and-forget funciona |
| Evolution acessada via internet (latência) | Evolution acessada via rede Docker interna |
| `DATABASE_URL` exposta publicamente | Banco na rede interna |
| Crons gerenciados pela Vercel | Crontab do sistema operacional |

---

### Arquivos criados para o deploy

#### `Dockerfile`
Build multi-stage:
- **deps**: instala dependências com `pnpm install --frozen-lockfile`
- **builder**: gera o Prisma client (`prisma generate`) e builda o Next.js
- **runner**: copia o output standalone (`.next/standalone`), arquivos estáticos, schema e binários do Prisma

#### `docker-entrypoint.sh`
Roda `prisma migrate deploy` antes de iniciar o servidor, garantindo que o banco está sempre atualizado ao subir o container:
```sh
#!/bin/sh
set -e
node /app/node_modules/prisma/build/index.js migrate deploy
exec node server.js
```

#### `next.config.ts`
Adicionado `output: "standalone"` para gerar um bundle mínimo:
```typescript
const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
};
```

#### `.dockerignore`
Exclui `node_modules`, `.next`, `.env*`, arquivos de teste e docs do contexto de build.

---

### Configuração do Easypanel

1. **Criar novo App** → Source: GitHub repo → branch `feat/vps-deploy` → Build: Dockerfile
2. **Porta:** `3000`
3. **Variáveis de ambiente:** copiar de `.env.vps` (ver arquivo na raiz do projeto)

Três valores precisam ser preenchidos após criar o serviço:
- `BETTER_AUTH_URL` → domínio público gerado pelo Easypanel para o app
- `EVOLUTION_API_KEY` → copiar da Vercel (painel de variáveis de ambiente)
- `S3_PUBLIC_URL` → domínio público do MinIO no Easypanel

**Hostnames internos a confirmar no Easypanel:**
- `DATABASE_URL` hostname: `allset_mvp_<nome-do-serviço-postgres>:5432`
- `S3_ENDPOINT` hostname: `http://allset_mvp_<nome-do-serviço-minio>:9000`

---

### Crons na VPS

Os endpoints de cron são HTTP simples protegidos por `CRON_SECRET`. Na Vercel eram chamados pelo scheduler da plataforma; na VPS usar crontab do sistema.

Adicionar ao crontab do servidor (via Easypanel terminal ou SSH):
```cron
# Drena outbox de mensagens a cada minuto
* * * * * curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/messaging/dispatch

# Baixa e transcreve áudios pendentes a cada minuto
* * * * * curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/messaging/download-audio

# Reengaja leads silenciosos uma vez por dia à meia-noite
0 0 * * * curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/recruitment/reengage

# Expira oportunidades não respondidas a cada hora
0 * * * * curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/marketplace/expire
```

Substitua `<CRON_SECRET>` pelo valor em `.env.vps`.

---

### Webhook da Evolution

Após o app estar no ar, reconfigurar o webhook da Evolution para apontar para o novo domínio:

```
URL: https://<app>.vn6tpb.easypanel.host/api/messaging/evolution/webhook
Header: x-allset-webhook-secret: <EVOLUTION_WEBHOOK_SECRET>
Eventos: MESSAGES_UPSERT
```

---

### Checklist de go-live

- [ ] App buildado e rodando no Easypanel (verificar logs de startup)
- [ ] `prisma migrate deploy` executou sem erros no startup (ver logs do container)
- [ ] `BETTER_AUTH_URL` atualizado com o domínio real
- [ ] Login de admin funcionando
- [ ] Webhook da Evolution reconfigurado para o novo domínio
- [ ] Enviar mensagem de teste no WhatsApp e verificar resposta imediata
- [ ] Crontab configurado e testado manualmente
- [ ] Cron de download/transcrição de áudio configurado e testado com um áudio real
- [ ] Monitor chama `GET /api/internal/health` com `x-allset-job-secret` e alerta em resposta diferente de 200
- [ ] Vercel desativado / projeto removido

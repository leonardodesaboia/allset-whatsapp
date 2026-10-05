# Briefing para IA — AllSet (2026-09-01)

Este documento é um briefing autossuficiente para qualquer IA que vá trabalhar no projeto AllSet. Ele substitui a necessidade de explorar o repositório do zero: leia-o primeiro, depois abra os arquivos que ele indicar.

---

## O que é o AllSet

Marketplace de limpeza doméstica acionado via WhatsApp. Clientes pedem limpeza pelo WhatsApp; profissionais recebem e aceitam oportunidades pelo WhatsApp. Um painel administrativo web gerencia o funil de recrutamento de profissionais e o estado dos agendamentos.

**Stack:** Next.js 16 (App Router) + TypeScript strict + Prisma 6 + PostgreSQL + Evolution API (gateway WhatsApp) + OpenAI Whisper (transcrição de áudio) + MinIO (storage S3-compatível) + BullMQ + Redis + Better Auth.

**Deploy:** VPS Linux com Easypanel + Docker. Não usa Vercel. Package manager: apenas `pnpm`.

---

## Arquitetura — regra de dependência inviolável

```
src/domain/          regras puras — sem I/O, sem frameworks, sem Prisma
src/application/     casos de uso e read models — importa domain, nunca app/infra
src/infrastructure/  Prisma, Better Auth, adapters externos
src/app/             Next.js: Server Components, Server Actions, rotas HTTP
prisma/              schema + migrations aditivas
```

**A regra:** `domain → nada. application → domain. infrastructure → domain + application. app → qualquer camada.` Nunca o inverso.

Verifique com `pnpm architecture:check` após qualquer mudança.

---

## Convenções obrigatórias — nunca viole

1. **Transições de status de lead**: sempre `transitionLeadStatusInTransaction(tx, { leadId, targetStatus, actor, reason? })`. Nunca `prisma.recruitmentLead.update({ data: { status } })` direto. A função aplica máquina de estados, lock otimista com `version`, histórico (`RecruitmentStatusHistory`), evento (`LeadEvent`) e `AuditLog` numa transação.

2. **Transições de status de booking**: sempre `transitionBookingStatusInTransaction(tx, { bookingId, targetStatus, actor, reason? })`. Mesma razão.

3. **Mensagens de saída**: sempre `enqueueOutboundMessage(tx, { provider, recipient, payload, idempotencyKey, correlationId, actor })` dentro de uma transação. A função faz upsert por `idempotencyKey` — chamadas repetidas com a mesma chave são idempotentes. Nunca chamar Evolution API diretamente de Server Actions ou casos de uso.

4. **Erros recuperáveis**: padrão `Result<T, E>` com `ok(value)` / `err(error)` de `src/domain/shared/result.ts`. `throw` somente para falhas inesperadas (bugs, invariantes quebradas).

5. **Concorrência / lock otimista**: `updateMany({ where: { id, version } })` e verificar `.count === 0` (conflito). Nunca `update` sem version quando há risco de concorrência. O campo `version` incrementa em toda escrita significativa.

6. **Transações multi-tabela**: `prisma.$transaction(async (tx) => { ... })`. Passar `tx` para os casos de uso e `enqueueOutboundMessage`; nunca usar o `prisma` global dentro de uma transação aberta.

7. **Sem barrel files**: importar de `src/domain/shared/result.ts`, não de `src/domain/shared/index.ts`. O projeto não tem `index.ts` nos módulos internos.

8. **Sem comentários desnecessários**: apenas quando o WHY é não-óbvio (invariante oculta, workaround de bug específico).

---

## Fluxo WhatsApp — visão geral

### Entrada de mensagem (texto)

```
Evolution API → POST /api/messaging/evolution/webhook
  → evolution-webhook.ts (normaliza, valida HMAC, limita 1 MiB)
  → persiste InboundMessage (idempotente por externalId)
  → routeInboundText (process-contact-conversation-text.usecase.ts)
     ├── ContactIntentConversation: roteamento inicial (CHOOSING_INTENT)
     │     cliente → startCustomerBookingConversation
     │     profissional → startRecruitmentConversation / processRecruitmentAnswer
     ├── CustomerBookingConversation: processCustomerBookingAnswer
     └── RecruitmentConversation: processRecruitmentAnswer
  → OutboxMessage (via enqueueOutboundMessage)
  → dispatch-outbox cron → Evolution API
```

### Estados da conversa de cliente (CustomerBookingConversation)

`INTRODUCTION → NAME → PROPERTY_CHARACTERISTICS → SCHEDULE_DATE → SCHEDULE_TIME → QUOTE_ACCEPTANCE → ADDRESS → MANUAL_REVIEW | FINAL_CONFIRMATION → AWAITING_PAYMENT → COMPLETED`

### Estados do pré-cadastro de profissional (RecruitmentConversation)

`INTRODUCTION → CHANNEL_PREFERENCE → NAME → NEIGHBORHOOD → PROFESSIONAL_EXPERIENCE → EXPERIENCE_DURATION | INFORMAL_EXPERIENCE → SERVICE_AREA → AVAILABILITY → COMPLETED`

### Marketplace

- Admin cria `ServiceOpportunity` com prazo e tokens de resposta.
- Profissional responde `SIM {código}` ou `NÃO {código}` no WhatsApp.
- Primeira aceitação é atômica: `updateMany({ where: { id, status: "OPEN", expiresAt: { gt: now } } })`.
- Expiração sem aceite: `expire-opportunities cron` move booking para `REVIEW_REQUIRED` e notifica o cliente.

---

## Mapa dos arquivos mais importantes

| Arquivo | Papel |
|---|---|
| `src/env.ts` | Validação de env com Zod; build usa placeholders seguros |
| `src/domain/shared/result.ts` | `ok()` / `err()` / `Result<T,E>` |
| `src/domain/recruitment/recruitment-state-machine.ts` | `ALLOWED_TRANSITIONS` para leads |
| `src/domain/booking/booking-state-machine.ts` | `ALLOWED_TRANSITIONS` para bookings |
| `src/domain/recruitment/conversation-definition.ts` | Perguntas, parser e comandos globais do pré-cadastro |
| `src/domain/customer/customer-conversation-definition.ts` | Perguntas e parser do booking de cliente |
| `src/application/recruitment/conversation-engine.usecase.ts` | Lógica completa da conversa de profissional |
| `src/application/customer/customer-booking-conversation.usecase.ts` | Lógica completa da conversa de cliente |
| `src/application/recruitment/transition-lead-status.usecase.ts` | Única entrada para transições de status de lead |
| `src/application/booking/transition-booking-status.usecase.ts` | Única entrada para transições de status de booking |
| `src/application/messaging/process-contact-conversation-text.usecase.ts` | Roteamento de inbound: qual conversa responder |
| `src/application/messaging/dispatch-outbox.usecase.ts` | Lease, retry exponencial, dead letter da outbox |
| `src/application/messaging/enqueue-outbound-message.usecase.ts` | Upsert idempotente no OutboxMessage |
| `src/application/customer/expire-stale-bookings.usecase.ts` | Lembrete 12h e cancelamento 24h de bookings sem pagamento |
| `src/application/marketplace/expire-opportunities.usecase.ts` | Expira oportunidades sem aceite |
| `src/application/marketplace/process-opportunity-response.usecase.ts` | Aceite/recusa de oportunidade (first-acceptance-wins) |
| `src/infrastructure/messaging/evolution-webhook.ts` | Normaliza e valida webhook da Evolution API |
| `src/infrastructure/auth/compare-secret.ts` | Comparação timing-safe de segredos |

---

## Variáveis de ambiente

| Variável | Obrigatoriedade | Papel |
|---|---|---|
| `DATABASE_URL` | Obrigatória | PostgreSQL |
| `BETTER_AUTH_SECRET` | Obrigatória | Segredo de sessão (≥32 chars) |
| `BETTER_AUTH_URL` | Obrigatória | URL base do app (para cookies) |
| `EVOLUTION_WEBHOOK_SECRET` | Obrigatória em produção | HMAC de validação do webhook |
| `EVOLUTION_BASE_URL` | Opcional | URL da Evolution API |
| `EVOLUTION_API_KEY` | Opcional | API key da Evolution |
| `EVOLUTION_INSTANCE` | Opcional | Nome da instância WhatsApp |
| `CRON_SECRET` | Obrigatório em produção | Bearer token dos crons |
| `PIX_KEY` | Opcional | Chave PIX do negócio (pagamento vai ao admin, que repassa ao profissional) |
| `REDIS_URL` | Opcional | BullMQ (jobs de áudio e reengajamento) |
| `OPENAI_API_KEY` | Opcional | Transcrição Whisper |
| `S3_ENDPOINT` | Opcional | MinIO / S3 |
| `S3_BUCKET` | Opcional | Bucket privado |
| `S3_REGION` | Opcional | Região |
| `S3_ACCESS_KEY_ID` | Opcional | Credencial S3 |
| `S3_SECRET_ACCESS_KEY` | Opcional | Credencial S3 |
| `S3_PUBLIC_URL` | Opcional | URL pública para URLs assinadas |
| `MESSAGING_DEFAULT_PROVIDER` | Default `"evolution"` | Provider de fallback |

---

## Crons — registrar no Easypanel

Todos: método `GET`, header `Authorization: Bearer $CRON_SECRET`.

| Rota | Intervalo sugerido | Finalidade |
|---|---|---|
| `/api/cron/messaging/dispatch` | 1 min | Despacha outbox, retry exponencial, dead letter |
| `/api/cron/messaging/download-audio` | 1 min | Baixa mídia da Evolution, aciona Whisper |
| `/api/cron/marketplace/expire` | 2 min | Expira oportunidades sem aceite no prazo |
| `/api/cron/customer/expire-stale` | 30 min | Lembrete PIX (12h) e cancelamento (24h) |
| `/api/cron/recruitment/reengage` | 4 h | Reengaja pré-cadastros silenciosos |

---

## Suítes de teste

```bash
pnpm test                    # unitários — sem Docker, rápido
pnpm test:integration        # integração com Testcontainers — requer Docker
pnpm test:e2e                # Playwright standalone — requer Docker
pnpm ci:check                # tudo: lint + typecheck + unit + integration + architecture
```

**Após qualquer mudança, no mínimo:**
```bash
pnpm tsc --noEmit && pnpm architecture:check && pnpm test
```

**Padrão de teste de integração** (copie este esqueleto):
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";

describe("nome do caso de uso", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => { if (stop) await stop(); });

  it("comportamento esperado", async () => {
    // seed → act → assert
  });
});
```

---

## Estado atual da branch `fix/comprehensive-audit-2026-08-19`

Esta branch está 38 commits à frente de `main`. Ela concentra uma auditoria completa de engenharia/segurança/QA feita em 5 sessões entre 2026-08-19 e 2026-09-01. O histórico completo está em `docs/analise-correcoes-completa-2026-08-19.md`.

### O que já foi corrigido (não refaça)

- Locks otimistas em todas as transições críticas (lead, booking, conversa, mensagem manual).
- Máquina de estados de booking com `transitionBookingStatusInTransaction`.
- Webhook Evolution: validação HMAC, limite de 1 MiB, idempotência, tratamento de retry.
- Outbox: lease, retry exponencial, dead letter, reenvio em massa pelo painel.
- 9 unhappy paths de conversa WhatsApp que silenciavam o usuário (PARAR, DECLINED, BOOKING_NOT_CONFIGURED, PHONE_ALREADY_USED, conversa pausada, conclusão de pré-cadastro, LEAD_NOT_FOUND, booking sem profissional, oportunidade já aceita).
- BOOKING_NOT_CONFIGURED: booking agora vai para `REVIEW_REQUIRED` antes de mover a conversa (estava em `COLLECTING_DATA`, invisível na fila do admin).
- PIX automático ao confirmar pedido, no follow-up durante `AWAITING_PAYMENT` e no lembrete do cron.
- Expiração de `ContactIntentConversation` após 7 dias de inatividade.
- Guard de LEAD/PRE_CADASTRO no fluxo ativo (evitava reset indevido de profissionais em início de pré-cadastro).
- Completude do pré-cadastro: envia mensagem contextual com base em `triageTarget` (CONVERSA_PENDENTE / BASE_FUTURA / AGUARDANDO_COMPLEMENTACAO).
- Seed administrativo seguro (sem senha no código, transacional, idempotente).
- Coverage do Vitest configurado com threshold de 80%.
- BullMQ: job `RECRUITMENT_REENGAGEMENT` agendado após cada mensagem de recrutamento.
- UI admin: acessibilidade do Kanban, teclado (KeyboardSensor), modal com foco, feedback de ações, formulários responsivos.
- E2E: login/logout, visitante, headers HTTP, menu móvel 375px, modal 320px, Kanban por teclado.

### P0 — bloqueadores de equivalência com produção

**1. Node 24**
Todo o desenvolvimento local ocorreu em Node 22. O repositório declara `>=24` no `engines` de `package.json`. O Dockerfile e `.nvmrc` já apontam para Node 24. Ação necessária: executar `docker build` e smoke test do container Node 24; rodar `pnpm ci:check` sob Node 24 e registrar a evidência.

**2. Prisma 6 → 7 (alerta de segurança)**
`pnpm audit --prod` mostra 1 alerta alto em `deepmerge-ts < 8`, dependência transitiva de `@prisma/config` via Prisma 6. A versão corrigida requer Prisma 7. Ação: planejar upgrade com revisão de migration API, `prisma migrate deploy`, build e smoke. Não use override forçado — pode quebrar o tooling de migration.

### P1 — homologação externa pendente

**3. Evolution + WhatsApp real**
O webhook foi auditado com mocks. Falta: configurar `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` e `EVOLUTION_WEBHOOK_SECRET` em staging; enviar mensagem real e confirmar fluxo de inbound → outbox → Evolution.

**4. S3 / MinIO**
Bucket privado, usuário de privilégio mínimo, URLs assinadas funcionais. Sem isso, upload de documentos de profissional e assets de perguntas de áudio falham silenciosamente.

**5. Whisper / áudio**
Worker `download-audio` existe (`/api/cron/messaging/download-audio`). Falta homologar com `OPENAI_API_KEY` real e áudio gravado no WhatsApp: download → `ReceivedAudio` → `POST /api/internal/messaging/transcribe` → engine de conversa.

**6. Crons reais no Easypanel**
Os 5 crons da tabela acima ainda não foram cadastrados no scheduler do Easypanel. Sem eles: outbox não despacha, bookings vencidos não expiram, áudio não é processado, reengajamento não acontece.

### P1 — qualidade e cobertura

**7. Viewports e navegadores faltantes**
Há evidência em 320px e 375px no Chromium. Faltam: 390, 430, 768, 1024, 1280 e 1440px; Safari e Firefox quando aplicável; zoom 200% e text scaling.

**8. Acessibilidade assistiva**
Foco, Escape, Tab e teclado do Kanban foram verificados. Falta: avaliação com NVDA/VoiceOver, contraste AA medido, smoke com zoom e texto ampliado.

### P2 — desejável

**9. Provider de coverage no CI**
O Vitest tem thresholds de 80% configurados, mas o CI ainda não publica o relatório. Ação: integrar `--coverage` na pipeline e falhar se abaixo do threshold.

**10. Testes de carga e resiliência**
Sem cenários de concorrência sustentada (outbox/webhook simultâneos), indisponibilidade de providers externos ou recuperação pós-restart. Necessário antes de escalar tráfego real.

---

## Como trabalhar neste projeto

### Antes de qualquer mudança

1. Leia o arquivo relevante com `Read`.
2. Verifique se existe um caso de uso centralizado para a operação (ex.: transição de status tem função própria — não reimplemente inline).
3. Confira se a mudança precisa de migration no Prisma (`prisma/schema.prisma`). Migrations são aditivas; nunca drope coluna sem período de deprecação.

### Ciclo de trabalho

```bash
# 1. alterar o arquivo
# 2. verificar tipos
pnpm tsc --noEmit
# 3. verificar arquitetura
pnpm architecture:check
# 4. rodar testes unitários
pnpm test
# 5. se mudou use case com banco, rodar integração
pnpm test:integration
```

### Regra de commit

Formato: `tipo(escopo): mensagem em português`
Tipos: `fix`, `feat`, `test`, `refactor`, `docs`, `chore`.
Exemplos: `fix(booking): corrige lock otimista na transição CANCELLED`, `test(marketplace): cobre expiração simultânea de oportunidades`.

### Padrões de idempotency key

```
{domínio}:{id-da-entidade}:{evento}:{timestamp-ou-inbound-id}
```
Exemplos:
- `recruitment:${conversation.id}:completed`
- `customer-booking:${conversation.id}:stopped:${updatedAt.getTime()}`
- `opportunity:${opportunityId}:${responseId}:confirmed`
- `payment-reminder:${conversationId}`

A chave é o que torna `enqueueOutboundMessage` idempotente. Retries com a mesma chave são ignorados.

---

## Modelos Prisma principais

`RecruitmentLead` → `RecruitmentConversation` (1:1)  
`RecruitmentLead` → `ProfessionalProfile` (1:0..1, criado na ativação)  
`User` (AuthUser) → `CustomerProfile` (1:1)  
`CustomerProfile` → `Booking` (1:N)  
`Booking` → `CustomerBookingConversation` (1:0..1)  
`Booking` → `ServiceOpportunity` (1:N, histórico de ofertas)  
`ServiceOpportunity` → `OpportunityResponse` (1:N, um por profissional convidado)  
`ContactIntentConversation` — por número de telefone (routing layer)  
`InboundMessage` — toda mensagem recebida; `processedAt` é o lock de processamento  
`OutboxMessage` — toda mensagem a enviar; `idempotencyKey` previne duplicação  

---

## Documentação existente

| Arquivo | Conteúdo |
|---|---|
| `CLAUDE.md` | Convenções e mapa de arquivos (versão resumida deste briefing) |
| `docs/analise-correcoes-completa-2026-08-19.md` | Histórico completo das 5 sessões de auditoria |
| `docs/analise-correcoes-e-minio-2026-08-18.md` | Checklist operacional de deploy |
| `docs/runbooks/evolution-messaging.md` | Runbook de mensageria Evolution |
| `docs/runbooks/vps-deploy.md` | Histórico de deploy e erros resolvidos |
| `docs/product/implementation-status-2026-08-07.md` | Inventário de features entregues |
| `docs/adr/` | Decisões de arquitetura registradas |

---

## O que fazer agora (sugestão de ordem)

1. **Node 24**: `docker build -t allset:node24 .` e `docker run --rm allset:node24 node --version` para confirmar; depois `pnpm ci:check` sob Node 24.
2. **Crons no Easypanel**: cadastrar os 5 crons da tabela acima com `CRON_SECRET` correto.
3. **PIX_KEY no Easypanel**: adicionar `PIX_KEY=<chave-pix-do-admin>` nas variáveis de ambiente.
4. **Homologação Evolution**: enviar mensagem de teste e confirmar fluxo completo inbound → processamento → outbound.
5. **Prisma 7**: branch separada, upgrade de `@prisma/*`, `prisma migrate deploy`, build, smoke.
6. **Coverage no CI**: `pnpm test --coverage` + publicar relatório e falhar em < 80%.

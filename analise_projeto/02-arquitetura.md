# Arquitetura

Decisão registrada em `docs/adr/0001-arquitetura-monolito-modular.md`:
**monólito modular**, não microsserviços. Um deploy, um banco, quatro camadas com
dependência em sentido único.

---

## 1. Camadas

```
src/domain/          regras puras — sem I/O, sem framework, sem Prisma
src/application/     casos de uso transacionais e read models
src/infrastructure/  Prisma, Better Auth, adapters (Evolution, Whisper, S3)
src/app/             Next.js App Router: páginas, Server Actions, rotas HTTP
```

**Regra de dependência** (verificada por `pnpm architecture:check`):

```
domain          → nada
application     → domain
infrastructure  → domain + application
app             → qualquer camada
```

Nunca o sentido contrário. O `dependency-cruiser` também proíbe que `src/domain`
importe `next`, `@prisma/*`, `better-auth` ou `pino`.

### O que mora em cada camada

| Camada | Exemplos reais |
|---|---|
| `domain` | `recruitment-state-machine.ts` (transições permitidas), `opportunity-matching-policy.ts` (elegibilidade), `customer-schedule.ts` (datas em `America/Fortaleza`), `opportunity-reply.ts` (parser de "SIM ABC123"), `result.ts`, `money.ts` |
| `application` | `conversation-engine.usecase.ts`, `transition-lead-status.usecase.ts`, `dispatch-outbox.usecase.ts`, `notify-opportunity.usecase.ts`, `kanban-read-model.ts` |
| `infrastructure` | `prisma-client.ts`, `auth.ts`, `evolution-messaging-adapter.ts`, `evolution-webhook.ts`, `s3-storage-provider.ts`, `openai-whisper-transcriber.ts` |
| `app` | `/api/messaging/evolution/webhook`, `/api/internal/*`, `/api/cron/*`, dashboard `/admin/*` |

---

## 2. Ports & adapters

O domínio declara interfaces em `src/domain/ports/` e a infraestrutura as
implementa. Isso mantém os casos de uso testáveis sem rede:

| Port | Implementações |
|---|---|
| `MessagingGateway` | `EvolutionMessagingAdapter`, `MockMessagingAdapter` |
| `StorageProvider` | `S3StorageProvider`, `LocalStorageProvider`, `InMemoryStorageProvider` |
| `AudioTranscriber` | `OpenAIWhisperTranscriber` |
| `InboundMediaDownloader` | `EvolutionMediaDownloader` |
| `PaymentProvider` | `MockPaymentProvider` (integração real ainda não existe) |
| `ErrorReporter` | `ConsoleErrorReporter` |

---

## 3. Os cinco padrões obrigatórios

### 3.1 Transições de status sempre pela máquina de estados

Proibido `prisma.recruitmentLead.update({ data: { status } })`. A única entrada é
`transitionLeadStatusInTransaction` (`src/application/recruitment/transition-lead-status.usecase.ts`),
que em uma transação:

1. valida a transição contra `ALLOWED_TRANSITIONS`;
2. aplica lock otimista por `version`;
3. grava `RecruitmentStatusHistory`;
4. grava `LeadEvent`;
5. grava `AuditLog`;
6. promove o lead a `ProfessionalProfile` quando o alvo é `ATIVA`.

O equivalente para pedidos é `transitionBookingStatusInTransaction`.

### 3.2 Mensagens de saída sempre pela outbox

Proibido chamar a Evolution API de uma Server Action ou de um caso de uso. Todo
envio é `enqueueOutboundMessage(tx, …)` **dentro da transação** que produziu a
mudança de estado. Assim, ou o estado e a mensagem existem juntos, ou nenhum dos
dois existe. Detalhes em [exemplos/07-outbox-de-mensagens.md](exemplos/07-outbox-de-mensagens.md).

### 3.3 `Result<T, E>` para erros recuperáveis

```ts
const transition = transitionRecruitmentStatus(current, target);
if (!transition.ok) return err(transition.error);
```

`throw` fica reservado para falhas inesperadas (que devem estourar e ser
reportadas). Erros de negócio são valores com código estável.

### 3.4 Lock otimista com `version`

```ts
const updated = await tx.recruitmentLead.updateMany({
  where: { id: current.id, version: current.version },
  data: { status: target, version: { increment: 1 } },
});
if (!updated.count) return err(new DomainError("Lead alterado concorrentemente", …));
```

`updateMany` + checagem de `.count` — zero significa conflito de concorrência.

### 3.5 Transações atômicas com `tx` propagado

`prisma.$transaction(async (tx) => { … })` para qualquer operação multi-tabela, e
o `tx` é passado adiante. **Nunca** usar o `prisma` global dentro de uma
transação: isso criaria uma segunda conexão fora do escopo transacional.

---

## 4. Idempotência de ponta a ponta

O WhatsApp e a Evolution podem reentregar eventos. O sistema assume isso:

| Ponto | Mecanismo |
|---|---|
| Entrada | `@@unique([provider, externalId])` em `InboundMessage`; duplicata é detectada por `P2002` e devolve a mensagem original |
| Processamento | *Claim* da mensagem: `updateMany({ where: { id, processedAt: null } })` — só um processamento avança |
| Saída | `idempotencyKey @unique` em `OutboxMessage` com `upsert` |
| Envio | Header `x-idempotency-key` enviado à Evolution |
| Oportunidade | `@@unique([opportunityId, leadId])` e lock `OPEN → FILLED` |
| Transcrição | `transcriptionLeaseUntil` impede duas transcrições simultâneas |

---

## 5. Fronteiras de segurança

| Superfície | Proteção |
|---|---|
| `/api/messaging/evolution/webhook` | Header `x-allset-webhook-secret` comparado em tempo constante |
| `/api/internal/*` | Header `x-allset-job-secret` (`INTERNAL_JOB_SECRET`) |
| `/api/cron/*` | `Authorization: Bearer <CRON_SECRET>` |
| `/admin/*` e Server Actions | Sessão Better Auth **e** confirmação de que o e-mail corresponde a um `User` com `role: ADMIN` |
| Variáveis de ambiente | Validadas por Zod no boot; secret de placeholder é rejeitado |

Toda Server Action começa por `currentActor()`, que devolve `null` se não houver
admin válido — e o caso de uso nunca é chamado nesse caso.

---

## 6. Read models

Consultas de leitura ficam separadas dos casos de uso de escrita. Exemplo:
`src/application/recruitment/kanban-read-model.ts` expõe `getKanbanBoard`,
`getNeedsMeLeads` e `searchLeads`, consumidos diretamente por Server Components
— sem passar por API HTTP.

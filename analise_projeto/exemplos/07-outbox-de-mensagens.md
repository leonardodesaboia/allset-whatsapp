# Exemplo 07 — Outbox: como toda mensagem sai do sistema

**Pergunta que o fluxo responde:** como garantir que uma mudança de estado e a
mensagem que a comunica nunca fiquem dessincronizadas?

Resposta: **transactional outbox**. Nenhum caso de uso e nenhuma Server Action
chama a Evolution API diretamente.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/application/messaging/enqueue-outbound-message.usecase.ts` | Enfileira (dentro da transação de negócio) |
| `src/application/messaging/dispatch-outbox.usecase.ts` | Lease, envio, retry e dead letter |
| `src/infrastructure/messaging/evolution-messaging-adapter.ts` | Envio real |
| `src/app/api/cron/messaging/dispatch/route.ts` | Drena até 50 mensagens por execução |
| `src/app/api/internal/messaging/dispatch/route.ts` | Despacha uma mensagem (worker) |
| `src/app/admin/outbox/page.tsx` | Visualização operacional da fila |

---

## Por que não enviar direto

```ts
// ERRADO — a mensagem pode sair e a transação fazer rollback depois
await tx.recruitmentLead.update(...);
await evolutionApi.send(...);

// CERTO — as duas coisas commitam juntas ou nenhuma commita
await prisma.$transaction(async (tx) => {
  await transitionLeadStatusInTransaction(tx, { ... });
  await enqueueOutboundMessage(tx, { ... });
});
```

---

## Passo 1 — enfileirar

```ts
await enqueueOutboundMessage(tx, {
  provider: "evolution",
  recipient: "+5585999990000",
  payload: textPayload("Recebemos seu pedido de ajuda! 📞 …"),
  idempotencyKey: `ajuda:${inboundMessageId}`,
  correlationId: inboundMessageId,
  actor: "system:ack",
});
```

A operação é um **`upsert` por `idempotencyKey`**: chamar duas vezes com a mesma
chave não cria duas mensagens. Por isso as chaves são construídas a partir de
identificadores estáveis:

| Fluxo | Formato da chave |
|---|---|
| Pergunta de recrutamento | `recruitment:<conversationId>:<estado>:<updatedAt>:text` |
| Áudio da pergunta | `recruitment:<conversationId>:<estado>:<updatedAt>:audio:<assetId>` |
| Conversa do cliente | `customer-booking:<conversationId>:<estado>:<updatedAt>` |
| Oferta de oportunidade | `opportunity:<opportunityId>:<leadId>:offer` |
| Confirmação de aceite | `opportunity:<opportunityId>:<responseId>:confirmed` |
| Reengajamento | `reengagement:<conversationId>:<tentativa>:nudge` |

Cada enfileiramento também grava `OUTBOX_MESSAGE_ENQUEUED` no `AuditLog`.

---

## Passo 2 — despachar

`dispatchNextOutboxMessage` roda em quatro etapas.

### a) Selecionar candidata

```ts
where: {
  OR: [
    { status: { in: ["PENDING", "FAILED"] }, availableAt: { lte: now } },
    { status: "SENDING", leaseExpiresAt: { lte: now } },   // lease vencida
  ],
},
orderBy: { createdAt: "asc" }
```

A segunda cláusula é a recuperação de worker morto: uma mensagem presa em
`SENDING` com lease vencida volta a ser elegível.

### b) Reivindicar (claim)

```ts
const claimed = await prisma.outboxMessage.updateMany({
  where: { id: candidate.id, status: candidate.status, ... },
  data: { status: "SENDING", attempts: { increment: 1 },
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000) },
});
if (!claimed.count) return null;   // outro worker pegou primeiro
```

Lease de **5 minutos**, deliberadamente longa: a Evolution pode demorar em redes
móveis, e uma lease curta faria dois workers tentarem a mesma entrega.

### c) Enviar

O gateway é escolhido pelo campo `provider` da própria mensagem. Duas guardas
antes do envio:

| Guarda | Efeito |
|---|---|
| Provider não registrado | Falha comum, entra em retry |
| Mensagem `AUDIO` e gateway sem capacidade de áudio | Vai **direto para dead letter** (retry não resolveria) |

### d) Registrar o resultado

Sucesso: `status = SENT`, `sentAt`, `externalId` devolvido pela Evolution,
`lastError = null`, lease liberada, `AuditLog` com `OUTBOX_MESSAGE_SENT`.

---

## Falha e retry exponencial

```ts
const retryDelayMs = (attempt) => Math.min(3_600_000, 1_000 * 2 ** Math.min(attempt, 10));
const maxAttempts = 8;
```

| Tentativa | Próximo envio em |
|---|---|
| 1 | 2 s |
| 2 | 4 s |
| 3 | 8 s |
| 4 | 16 s |
| 5 | 32 s |
| 6 | ~1 min |
| 7 | ~2 min |
| 8 | **dead letter** |

O teto é de 1 hora. A mensagem de erro é truncada em 500 caracteres antes de ir
para `lastError` — corpos de resposta grandes não poluem o banco.

`DEAD_LETTER` é um estado terminal, visível em `/admin/outbox`, que exige decisão
humana.

---

## Estados possíveis

```
PENDING ──claim──► SENDING ──ok──► SENT
   ▲                  │
   │                  └──erro──► FAILED ──(retry)──► SENDING
   │                                 │
   └──(lease vencida volta a ser elegível)
                                     └──8ª falha──► DEAD_LETTER
```

---

## Como o despacho é acionado

| Gatilho | Rota | Volume |
|---|---|---|
| Inline após o webhook | `dispatchNextOutboxMessage(...)` chamado em *fire-and-forget* no final do handler | 1 mensagem — serve para a resposta sair imediatamente |
| Cron | `GET /api/cron/messaging/dispatch` | Até 50 por execução |
| Worker interno | `POST /api/internal/messaging/dispatch` | 1 por chamada |

O disparo inline no webhook (commit `8a8b11f`) é o que faz a resposta parecer
instantânea para quem está conversando; ele nunca derruba a resposta HTTP —
falhas só vão para o log:

```ts
dispatchNextOutboxMessage(prisma, registry, "system:webhook-dispatch")
  .catch((err) => logger.error({ err }, "Falha ao despachar outbox inline no webhook"));
```

---

## Garantia oferecida

**At-least-once.** Uma mensagem pode, em cenários raros (envio concluído na
Evolution mas resposta perdida), ser reenviada. Por isso o adapter envia
`x-idempotency-key` na requisição — a deduplicação final fica com o provider.

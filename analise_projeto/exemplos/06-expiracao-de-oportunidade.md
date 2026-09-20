# Exemplo 06 — Expiração de oportunidade sem aceite

**Pergunta que o fluxo responde:** o que acontece com um pedido cuja oferta
ninguém aceitou dentro do prazo?

Um job varre as oportunidades vencidas, fecha-as e **devolve o pedido para a
operação** em vez de deixá-lo preso em `MATCHING`.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/application/marketplace/expire-opportunities.usecase.ts` | A varredura |
| `src/app/api/cron/marketplace/expire/route.ts` | Entrada por cron (`CRON_SECRET`) |
| `src/app/api/internal/marketplace/expire/route.ts` | Entrada por worker (`INTERNAL_JOB_SECRET`) |

---

## Cenário

```
10:00  Oferta disparada para 5 profissionais. expiresAt = 14:00
10:00  Booking: MATCHING
…      Ninguém responde
14:03  Job de expiração roda
```

---

## O que o job faz, por oportunidade

Cada oportunidade é tratada em **sua própria transação** — uma falha isolada não
derruba o lote inteiro:

```ts
const claimed = await tx.serviceOpportunity.updateMany({
  where: { id: candidate.id, status: "OPEN" },
  data: { status: "EXPIRED" },
});
if (!claimed.count) return false;
```

O `where: { status: "OPEN" }` é o ponto crítico: se, entre a leitura da lista e a
escrita, alguém tiver aceitado a oferta, `count` é zero e o job **não sobrescreve
o aceite**. Esse é exatamente o caso de corrida entre "aceite às 13:59:59" e
"job às 14:00:00".

Tendo vencido o claim:

1. todas as `OpportunityResponse` ainda sem resposta viram `EXPIRED` com
   `respondedAt`;
2. o `Booking` volta de `MATCHING` para `REVIEW_REQUIRED`:

```ts
const movedBooking = await tx.booking.updateMany({
  where: { id: candidate.bookingId, status: "MATCHING" },
  data: { status: "REVIEW_REQUIRED", version: { increment: 1 } },
});
```

3. `BookingStatusHistory` **só é criado se `movedBooking.count > 0`** — o
   comentário no código é explícito: nunca fabricar histórico para uma transição
   que não aconteceu;
4. `AuditLog` com `OPPORTUNITY_EXPIRED` e o metadado
   `bookingMovedToReview: true | false`.

---

## Retorno

```json
{ "ok": true, "scanned": 3, "expired": 2 }
```

`scanned` ≠ `expired` significa que alguma candidata foi resolvida por outro
caminho entre a leitura e a escrita — situação esperada, não erro.

---

## Por que `REVIEW_REQUIRED` e não `CANCELLED`

`REVIEW_REQUIRED` é um estado de decisão humana. A operação pode:

- disparar a oportunidade de novo (talvez com pagamento maior);
- contatar o cliente para remarcar;
- cancelar, se for o caso.

Cancelar automaticamente descartaria um pedido que o cliente já aceitou e, em
vários casos, já pagou.

---

## Como acionar

```bash
# via cron
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://<host>/api/cron/marketplace/expire

# via worker interno
curl -X POST -H "x-allset-job-secret: $INTERNAL_JOB_SECRET" \
     https://<host>/api/internal/marketplace/expire
```

> **Atenção operacional:** o `vercel.json` agenda hoje apenas
> `/api/cron/recruitment/reengage`. A rota de expiração existe e funciona, mas
> precisa de um agendamento (Vercel Cron, GitHub Actions ou scheduler externo)
> para rodar sozinha.

---

## Nota sobre o prazo

`OPPORTUNITY_EXPIRY_HOURS` é validado em `src/env.ts` como inteiro positivo com
máximo de 168 (uma semana) e padrão de 4 horas. O valor é aplicado no momento do
disparo, não no da expiração — mudar a variável não altera ofertas já enviadas.

# ServiceOpportunityEngine — Design Spec

## Objetivo

Fechar o loop do marketplace: quando um `Booking` entra em `MATCHING`, profissionais
elegíveis (ATIVA/PREFERENCIAL) recebem a oferta via WhatsApp, respondem SIM ou NAO,
e o sistema atribui o primeiro a aceitar. Sem isso, o funil de recrutamento não tem
saída de valor real.

**Escopo deste plano:** somente o lado profissional — notificação, resposta e atribuição.
O fluxo WhatsApp do cliente (criação do Booking) é especificado separadamente.
Por ora, bookings são criados pelo admin via painel.

---

## Arquitetura

Monólito modular existente: `domain → application → infrastructure → app`.
Este plano adiciona `src/domain/marketplace/` e `src/application/marketplace/`
seguindo exatamente o mesmo padrão do `ConversationEngine` e `ReenagagementEngine`.

---

## Schema Prisma

### Novos enums

```prisma
enum ServiceOpportunityStatus {
  OPEN        // aguardando respostas
  FILLED      // profissional atribuído
  EXPIRED     // ninguém aceitou dentro do prazo
  CANCELLED   // booking cancelado antes de fechar
}

enum OpportunityResponseValue {
  ACCEPTED
  DECLINED
  EXPIRED     // não respondeu antes do prazo
}
```

### Novo model `ServiceOpportunity`

```prisma
model ServiceOpportunity {
  id              String                   @id @default(uuid())
  bookingId       String                   @unique
  booking         Booking                  @relation(fields: [bookingId], references: [id])
  neighborhood    String
  scheduledAt     DateTime
  durationMinutes Int                      @default(180)
  paymentCents    Int
  status          ServiceOpportunityStatus @default(OPEN)
  expiresAt       DateTime
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  responses       OpportunityResponse[]

  @@index([status, expiresAt])
}
```

### Novo model `OpportunityResponse`

```prisma
model OpportunityResponse {
  id            String                    @id @default(uuid())
  opportunityId String
  opportunity   ServiceOpportunity        @relation(fields: [opportunityId], references: [id])
  leadId        String
  lead          RecruitmentLead           @relation(fields: [leadId], references: [id])
  sentAt        DateTime                  @default(now())
  respondedAt   DateTime?
  response      OpportunityResponseValue?

  @@unique([opportunityId, leadId])
  @@index([leadId, response])             // webhook lookup: telefone → resposta pendente
}
```

### Alterações em models existentes

**`Booking`** — campos adicionais:
```prisma
scheduledAt       DateTime?
neighborhood      String?
durationMinutes   Int?
professionalPaymentCents Int?            // quanto o profissional recebe (pode diferir de totalCents)
opportunities     ServiceOpportunity[]
```

**`RecruitmentLead`** — relação reversa:
```prisma
opportunityResponses OpportunityResponse[]
```

---

## Critérios de elegibilidade de profissional

Um `RecruitmentLead` é elegível para receber uma oportunidade se:

1. **Status:** `ATIVA` ou `PREFERENCIAL`
2. **Bairro:** `canServeInitialArea != "NAO"` **e** `neighborhood` do lead é igual ou
   compatível com o bairro do serviço (fase MVP: mesmo bairro exato ou `canServeInitialArea = "SIM"`)
3. **Disponibilidade de dia:** o dia da semana de `scheduledAt` está em `availabilityDays` do lead
4. **Sem conflito de slot:** não existe outro `OpportunityResponse` com `response = ACCEPTED`
   cujo `opportunity.scheduledAt` caia no mesmo dia (MVP: mesmo dia calendar, não hora exata)

A função `isEligibleForOpportunity(lead, opportunity, existingAcceptedSlots)` vive em
`src/domain/marketplace/opportunity-matching-policy.ts` — pura, sem I/O, testável.

---

## Fluxo completo

```
Admin cria Booking (status DRAFT → MATCHING via Server Action)
    ↓
notifyOpportunity(prisma, bookingId)
    - busca Booking (scheduledAt, neighborhood, paymentCents)
    - busca RecruitmentLeads com status ATIVA/PREFERENCIAL e phoneE164 != null
    - aplica isEligibleForOpportunity para cada lead
    - cria ServiceOpportunity (status=OPEN, expiresAt = now + 4h por padrão)
    - para cada lead elegível:
        cria OpportunityResponse (response=null)
        enqueueOutboundMessage: texto com detalhes + "Responda SIM para aceitar ou NAO para recusar"
    - transita Booking para MATCHING
    - tudo em uma $transaction
    ↓
Profissional responde via WhatsApp
    ↓
Webhook recebe mensagem
    - antes de checar RecruitmentLead: busca OpportunityResponse
      WHERE leadId = <phoneE164's lead> AND response IS NULL
    - se encontrar → processOpportunityResponse(prisma, { responseId, text })
    - senão → fluxo de recrutamento existente
    ↓
processOpportunityResponse(prisma, { responseId, text })
    - parseia texto: "sim" → ACCEPTED, "não"/"nao" → DECLINED (case-insensitive, aceita variações)
    - se ACCEPTED:
        tenta updateMany({ where: { opportunityId, response: null } , data: { response: ACCEPTED, respondedAt } })
        se count > 0: transita Booking para PROFESSIONAL_ASSIGNED, atualiza ServiceOpportunity status=FILLED
                      enfileira confirmação para profissional ("Ótimo! Você está confirmado para X")
                      enfileira mensagens "Vaga preenchida" para todos os outros leads com response=null
        se count = 0: oportunidade já foi preenchida → enfileira "Desculpe, já foi preenchido"
    - se DECLINED:
        marca OpportunityResponse.response = DECLINED
        enfileira confirmação ("Tudo bem, obrigado! Avisaremos em novas oportunidades.")
    - o lock de "primeiro a aceitar" é resolvido pelo `updateMany({ where: { opportunityId, response: null } })`:
      quem ganhar a corrida seta response=ACCEPTED; os demais encontram count=0
    - tudo em $transaction
    ↓
expireOpportunities() — chamado por cron via POST /api/internal/marketplace/expire
    - busca ServiceOpportunity WHERE status=OPEN AND expiresAt < now
    - para cada uma: status=EXPIRED, OpportunityResponse pendentes → EXPIRED
                     Booking → REVIEW_REQUIRED
                     enfileira alerta para admin (LeadEvent)
```

---

## Roteamento no webhook

Arquivo: `src/app/api/messaging/evolution/webhook/route.ts`

Após validar o webhook e antes de chamar `processRecruitmentAnswer`:

```typescript
// Verifica se há oportunidade pendente para este remetente
const pendingResponse = await prisma.opportunityResponse.findFirst({
  where: {
    lead: { phoneE164: event.sender },
    response: null,
    opportunity: { status: "OPEN" },
  },
  include: { opportunity: true },
});
if (pendingResponse) {
  await processOpportunityResponse(prisma, {
    responseId: pendingResponse.id,
    text: event.text ?? "",
    inboundMessageId: inboundMessage.id,
  });
  return Response.json({ ok: true, routed: "opportunity" });
}
```

Profissionais que estão simultaneamente no pré-cadastro e recebem uma oportunidade são
raros (estado ATIVA/PREFERENCIAL já pressupõe cadastro completo), mas o roteamento
prioriza a oportunidade — que tem janela de tempo curta — sobre o fluxo de recrutamento.

---

## Mensagem WhatsApp (texto)

Gerada por `src/domain/marketplace/opportunity-message.ts`:

```
Olá! Temos uma oportunidade de serviço para você.

📍 Bairro: {neighborhood}
📅 Data: {data por extenso}
⏰ Horário: {HH:MM}
⏱ Duração estimada: {N}h
💰 Pagamento: R$ {valor}

Responda *SIM* para aceitar ou *NAO* para recusar.
Você tem até {expiresAt hora} para responder.
```

`opportunity-message.ts` é função pura: `formatOpportunityMessage(opportunity): string`.

---

## Admin UI

### `src/app/admin/bookings/page.tsx`
Listagem de bookings com colunas: status, bairro, data/hora, ação.
Botão "Enviar para Matching" → Server Action em `actions.ts`.

### `src/app/admin/bookings/actions.ts`
`dispatchOpportunityAction(bookingId)`:
- Valida que booking tem `scheduledAt`, `neighborhood`, `professionalPaymentCents`
- Chama `notifyOpportunity(prisma, bookingId)`
- `revalidatePath("/admin/bookings")`

### `src/app/admin/bookings/[id]/opportunity/page.tsx`
View read-only:
- Status da oportunidade (OPEN/FILLED/EXPIRED)
- Tabela de respostas: nome do profissional, bairro, enviado em, respondido em, resposta
- Sem ações (apenas leitura neste MVP)

### `src/app/admin/bookings/new/page.tsx`
Formulário simples: serviço, bairro (select de ServiceArea ativas), data, hora, duração,
valor ao profissional, valor total. Server Action cria Booking em DRAFT.

---

## Cron de expiração

`POST /api/internal/marketplace/expire` — protegido por `INTERNAL_JOB_SECRET`.
Chama `expireOpportunities(prisma)`.
Variável de ambiente: `OPPORTUNITY_EXPIRY_HOURS` (padrão: 4).

---

## Variáveis de ambiente

```
OPPORTUNITY_EXPIRY_HOURS=""   # horas até expiração (padrão: 4)
```

---

## Testes

| Arquivo | Tipo | O que cobre |
|---|---|---|
| `opportunity-matching-policy.test.ts` | Unitário | Bairro incompatível → false; dia errado → false; conflito de slot → false; elegível → true |
| `opportunity-message.test.ts` | Unitário | Formatação: data por extenso, valor formatado, hora correta |
| `notify-opportunity.usecase.integration.test.ts` | Testcontainers | 3 profissionais: 2 elegíveis, 1 não. Verifica 2 OutboxMessages e 2 OpportunityResponses criadas. Booking em MATCHING. |
| `process-opportunity-response.usecase.integration.test.ts` | Testcontainers | Dois profissionais elegíveis. Primeiro responde SIM → PROFESSIONAL_ASSIGNED. Segundo tenta SIM → "já preenchido". |
| `expire-opportunities.usecase.integration.test.ts` | Testcontainers | Oportunidade expirada: booking vai para REVIEW_REQUIRED, responses ficam EXPIRED. |

---

## Arquivos criados/modificados

| Ação | Arquivo |
|---|---|
| CREATE | `prisma/migrations/<ts>_add_service_opportunity/migration.sql` |
| MODIFY | `prisma/schema.prisma` |
| CREATE | `src/domain/marketplace/opportunity-matching-policy.ts` |
| CREATE | `src/domain/marketplace/opportunity-matching-policy.test.ts` |
| CREATE | `src/domain/marketplace/opportunity-message.ts` |
| CREATE | `src/domain/marketplace/opportunity-message.test.ts` |
| CREATE | `src/application/marketplace/notify-opportunity.usecase.ts` |
| CREATE | `src/application/marketplace/notify-opportunity.usecase.integration.test.ts` |
| CREATE | `src/application/marketplace/process-opportunity-response.usecase.ts` |
| CREATE | `src/application/marketplace/process-opportunity-response.usecase.integration.test.ts` |
| CREATE | `src/application/marketplace/expire-opportunities.usecase.ts` |
| CREATE | `src/application/marketplace/expire-opportunities.usecase.integration.test.ts` |
| MODIFY | `src/app/api/messaging/evolution/webhook/route.ts` |
| CREATE | `src/app/api/internal/marketplace/expire/route.ts` |
| CREATE | `src/app/admin/bookings/page.tsx` |
| CREATE | `src/app/admin/bookings/actions.ts` |
| CREATE | `src/app/admin/bookings/new/page.tsx` |
| CREATE | `src/app/admin/bookings/[id]/opportunity/page.tsx` |
| MODIFY | `src/env.ts` |
| MODIFY | `.env.example` |

---

## Fora do escopo deste plano

- Fluxo WhatsApp do cliente (spec separada)
- Pagamento ao profissional
- Rating pós-serviço
- Notificação ao cliente quando profissional é atribuído (mensagem simples pode ser adicionada depois sem mudança de schema)
- Suporte a áudio nas mensagens de oportunidade

# Exemplo 05 — Oportunidade no marketplace ("primeiro aceite vence")

**Pergunta que o fluxo responde:** como oferecer o mesmo serviço a várias
profissionais ao mesmo tempo sem correr o risco de alocar duas para o mesmo
horário?

É o fluxo com mais controle de concorrência do projeto.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/domain/marketplace/opportunity-matching-policy.ts` | Regra de elegibilidade (pura) |
| `src/domain/marketplace/opportunity-message.ts` | Formatação da oferta |
| `src/domain/marketplace/opportunity-reply.ts` | Parser de `SIM <código>` / `NAO <código>` |
| `src/application/marketplace/notify-opportunity.usecase.ts` | Dispara a oferta |
| `src/application/marketplace/process-opportunity-response.usecase.ts` | Resolve a resposta |

---

## Passo 1 — disparo

Um admin aciona `dispatchOpportunityAction(bookingId)`. O `Booking` precisa ter
`scheduledAt`, `neighborhood` e `professionalPaymentCents` — sem isso o caso de
uso lança erro.

### Quem é elegível

`isEligibleForOpportunity` (domínio puro, sem I/O) aplica cinco filtros:

```ts
1. status ∈ { ATIVA, PREFERENCIAL }
2. tem telefone
3. canServeInitialArea ≠ NAO e ≠ null
4. se canServeInitialArea = TALVEZ → só se o bairro for exatamente o da oportunidade
5. disponibilidade: se os dias forem parseáveis, o dia da semana precisa bater
6. sem outra oportunidade já aceita no mesmo dia
```

O parser de disponibilidade entende texto livre em português: `"segunda a sexta"`
vira `{1,2,3,4,5}`; `"seg, qua, sex"` vira `{1,3,5}`; acentos são removidos. Se
nada for reconhecido, o filtro de dia **não** é aplicado (não elimina ninguém por
não ter conseguido interpretar o texto).

### O que é criado

Em uma única transação:

- uma `ServiceOpportunity` com `expiresAt = now + OPPORTUNITY_EXPIRY_HOURS`
  (padrão: 4 horas);
- uma `OpportunityResponse` por profissional elegível, cada uma com um
  `responseToken` único de 10 caracteres;
- uma `OutboxMessage` por profissional;
- transição do `Booking` para `MATCHING` com lock otimista;
- `BookingStatusHistory` e `AuditLog` (`OPPORTUNITY_DISPATCHED`).

### A mensagem enviada

```
Ola! Temos uma oportunidade de servico para voce.

Bairro: Meireles
Data: segunda-feira, 21 de setembro
Horario: 09:00
Duracao estimada: 3h
Pagamento: R$ 120,00

Responda *SIM A1B2C3D4E5* para aceitar ou *NAO A1B2C3D4E5* para recusar.
Voce tem ate 13:00 para responder.
```

Datas e horários são formatados com `Intl.DateTimeFormat` em
`America/Fortaleza`.

---

## Passo 2 — a resposta chega

No webhook, a checagem de oportunidade vem **antes** do roteamento de conversa:

```ts
const pendingOpportunityResponses = await prisma.opportunityResponse.findMany({
  where: { lead: { phoneE164: event.sender }, response: null, opportunity: { status: "OPEN" } },
  orderBy: { sentAt: "asc" },
});
```

| Situação | Comportamento |
|---|---|
| Resposta com código e o código bate | Resolve aquela oportunidade |
| Sem código, mas só há **uma** oportunidade aberta | Resolve essa |
| Sem código e há **várias** abertas | `requestOpportunityClarification` pede o código (até 3 listados) |
| Nenhuma oportunidade aberta | Segue para o roteador de conversa normal |

`parseOpportunityReply` aceita `SIM`, `S`, `NAO`, `N`, com ou sem código de 10
caracteres, ignorando acentos e caixa.

---

## Passo 3 — o aceite, e o lock

Esta é a linha central do fluxo:

```ts
const claimedOpportunity = await tx.serviceOpportunity.updateMany({
  where: { id: opportunity.id, status: "OPEN", expiresAt: { gt: now } },
  data: { status: "FILLED" },
});
if (!claimedOpportunity.count) { /* chegou tarde */ }
```

A transição `OPEN → FILLED` é atômica no banco. Se duas profissionais responderem
"SIM" no mesmo milissegundo, **apenas uma** obtém `count = 1`.

Vencendo a corrida, na mesma transação:

1. `Booking` vai para `PROFESSIONAL_ASSIGNED` com `assignedProfessionalLeadId`
   (também com lock otimista — se falhar, tudo faz rollback, inclusive o
   `FILLED`, e uma nova tentativa resolve corretamente);
2. a resposta vencedora vira `ACCEPTED`;
3. **todas** as demais respostas pendentes viram `DECLINED` e recebem aviso;
4. `BookingStatusHistory` + `AuditLog` (`OPPORTUNITY_ACCEPTED`).

### O que cada uma recebe

| Quem | Mensagem |
|---|---|
| Quem aceitou primeiro | `Confirmado, Maria Souza: segunda-feira, 21 de setembro 09:00 em Meireles.` |
| Quem respondeu depois | `Esta oportunidade já foi preenchida. Avisaremos quando surgir uma nova.` |
| Quem não respondeu | `Obrigado pelo interesse! Esta oportunidade acabou de ser preenchida.` |
| Quem recusou (`NAO`) | `Tudo bem, obrigado! Avisaremos quando surgir uma nova oportunidade.` |

---

## Proteção contra uso indevido do código

```ts
if (!inbound || inbound.sender !== response.lead.phoneE164) {
  return { outcome: "NOT_FOUND" };
}
```

Um `responseToken` vazado **não** pode ser usado por outro número: o remetente do
inbound precisa ser exatamente o telefone da profissional dona da resposta. O
retorno é `NOT_FOUND` (não "não autorizado"), para não confirmar a existência do
código.

---

## Resumo dos desfechos possíveis

| `outcome` | Quando |
|---|---|
| `ACCEPTED` | Primeiro "SIM" válido dentro do prazo |
| `DECLINED` | "NAO" válido |
| `ALREADY_FILLED` | Oportunidade já preenchida, expirada, ou resposta já registrada |
| `INVALID_RESPONSE` | Texto que não é SIM/NAO |
| `AMBIGUOUS_RESPONSE` | Várias oportunidades abertas e nenhum código informado |
| `DUPLICATE_INBOUND` | Reentrega do mesmo evento |
| `NOT_FOUND` | Resposta inexistente ou telefone que não confere |

# Exemplo 04 — Validação de cobertura pela operação

**Pergunta que o fluxo responde:** o endereço que o cliente mandou está dentro da
área atendida? É o único ponto humano obrigatório do fluxo de agendamento.

O endereço em texto livre não é validado por automação: um admin olha, decide, e
essa decisão **destrava ou encerra** a conversa do cliente.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/application/customer/validate-booking-coverage.usecase.ts` | Regra da decisão |
| `src/app/admin/bookings/actions.ts` | Server Action `validateBookingCoverageAction` |
| `src/app/admin/bookings/page.tsx` | Tela onde a operação decide |

---

## Estado de partida

```
Booking.status        = REVIEW_REQUIRED
Booking.addressLine1  = "Rua Silva Jatahy, 100, apto 802 — Meireles"
Conversa do cliente   = MANUAL_REVIEW
```

---

## Caminho A — endereço dentro da cobertura

A operação clica em "Dentro da área" no dashboard:

```ts
await validateBookingCoverageAction(bookingId, true);
```

Dentro de uma transação:

1. `REVIEW_REQUIRED → AWAITING_CUSTOMER_CONFIRMATION`, motivo
   *"Cobertura validada manualmente"*;
2. conversa vai de `MANUAL_REVIEW` para `FINAL_CONFIRMATION`;
3. `coverageValidatedAt = now`, `outsideCoverageArea = false`;
4. mensagem enfileirada na outbox.

O cliente recebe:

```
Endereço validado para atendimento.

Valor da limpeza: R$ 180,00

Podemos seguir para o pagamento?

1 — Confirmar e pagar
2 — Alterar informações
```

Respondendo `1`, a conversa avança para `AWAITING_PAYMENT` e o `Booking` também
(`AWAITING_CUSTOMER_CONFIRMATION → AWAITING_PAYMENT`). Respondendo `2`, volta
para a escolha de faixa de imóvel e o pedido retorna a `COLLECTING_DATA`.

---

## Caminho B — endereço fora da cobertura

```ts
await validateBookingCoverageAction(bookingId, false);
```

1. conversa vai direto para `COMPLETED` com `automationPausedAt` preenchido;
2. `Booking.outsideCoverageArea = true` (o pedido **não** é cancelado — fica como
   demanda registrada para expansão de área);
3. mensagem ao cliente:

```
Seu endereço ficou na nossa lista de espera. Se conseguirmos uma profissional
para esta região, entraremos em contato.
```

---

## Guardas implementadas

```ts
if (booking.status !== "REVIEW_REQUIRED" || !booking.customerConversation) {
  return { ok: false, reason: "BOOKING_NOT_AWAITING_COVERAGE" };
}
```

| Guarda | Efeito |
|---|---|
| Entrada validada por Zod (`bookingId` uuid, `isCovered` boolean, `actor` 1–160 chars) | Rejeita payload malformado antes de tocar o banco |
| Status precisa ser exatamente `REVIEW_REQUIRED` | Duplo clique ou requisição repetida não reprocessa |
| Precisa existir conversa vinculada | Evita validar um pedido criado manualmente sem conversa |
| Server Action exige admin | `currentActor()` devolve `null` → nada é executado |
| `version: { increment: 1 }` na conversa | Lock otimista |

---

## Outras ações da operação na mesma tela

| Ação | Caso de uso | Uso típico |
|---|---|---|
| Enviar mensagem manual | `sendManualCustomerMessage` | Pedir uma referência do endereço, tirar dúvida |
| Retomar automação | `resumeCustomerBookingConversation` | Voltar ao robô depois de um atendimento humano |
| Disparar oportunidade | `notifyOpportunity` | Publicar o serviço para as profissionais ([exemplo 05](05-oportunidade-marketplace.md)) |

Todas passam pelo mesmo `currentActor()` e todas escrevem no `AuditLog`.

# Exemplo 01 — Triagem de intenção no primeiro contato

**Pergunta que o fluxo responde:** quem acabou de mandar "oi" quer *contratar*
uma limpeza ou quer *trabalhar* como profissional?

Antes deste fluxo existir, toda mensagem nova criava um lead de recrutamento.
Hoje um menu neutro decide, e o estado fica em `ContactIntentConversation`.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/domain/customer/contact-intent.ts` | Texto do menu e parser das respostas aceitas |
| `src/application/customer/contact-intent-conversation.usecase.ts` | Cria a conversa de intenção e processa a escolha |
| `src/application/messaging/process-contact-conversation-text.usecase.ts` | Roteador: decide entre intenção, cliente e recrutamento |
| `src/app/api/messaging/evolution/webhook/route.ts` | Porta de entrada |

---

## Exemplo executado

### Passo 1 — a mensagem chega

```http
POST /api/messaging/evolution/webhook
x-allset-webhook-secret: <EVOLUTION_WEBHOOK_SECRET>

{
  "data": {
    "key": { "id": "3EB0C1", "remoteJid": "5585999990000@s.whatsapp.net", "fromMe": false },
    "message": { "conversation": "oi" }
  }
}
```

`normalizeEvolutionWebhook` (`src/infrastructure/messaging/evolution-webhook.ts`)
descarta o evento se:

- `fromMe` for `true` (mensagem enviada por nós);
- o `remoteJid` terminar em `@g.us` (**grupos nunca criam leads**);
- o número não casar com `^\d{8,15}$`.

Passando, o telefone vira `+5585999990000` (E.164) — o mesmo formato do cadastro
manual, para não duplicar leads.

### Passo 2 — persistência idempotente

`processInboundEvent` grava em `InboundMessage`. Se a Evolution reentregar o
mesmo `externalId`, o `@@unique([provider, externalId])` dispara `P2002`, o caso
de uso devolve `{ duplicate: true }` e o webhook responde sem reprocessar:

```json
{ "ok": true, "duplicate": true }
```

### Passo 3 — roteamento

Em `processContactConversationText`, o número não tem `RecruitmentLead` nem
`ContactIntentConversation`. Logo:

```ts
if (!contactIntent && !lead) {
  await startContactIntentConversation(prisma, { phoneE164, provider, inboundMessageId });
  return { routed: "contact-intent", started: true };
}
```

`startContactIntentConversation` faz, **em uma transação**: marca o inbound como
processado, faz `upsert` da conversa em `CHOOSING_INTENT` e enfileira o menu na
outbox.

### Passo 4 — o que a pessoa recebe

```
Olá! Como a AllSet pode ajudar?

1 — Quero contratar uma limpeza
2 — Quero trabalhar como profissional
```

### Passo 5 — a escolha

`parseContactIntent` aceita mais do que o número:

| Resposta digitada | Resultado |
|---|---|
| `1`, `cliente`, `contratar`, `contratar limpeza` | `CUSTOMER` |
| `2`, `profissional`, `trabalhar`, `trabalhar como profissional` | `PROFESSIONAL` |
| qualquer outra coisa | `undefined` → o menu é reenviado |

A normalização remove acentos (`NFD` + remoção de diacríticos) e faz uppercase,
então "Profissional" e "PROFISSIONAL" funcionam igualmente.

### Passo 6 — o caminho escolhido

```ts
if (selection.intent === "CUSTOMER")     → startCustomerBookingConversation(...)
if (selection.intent === "PROFESSIONAL") → startRecruitmentConversation(...)
```

O estado da `ContactIntentConversation` passa a `CUSTOMER` ou `PROFESSIONAL` e
todas as mensagens seguintes daquele número já entram direto no fluxo certo.

---

## Detalhes que importam

**Claim da mensagem antes de agir.** Em `processContactIntentSelection`:

```ts
const claimed = await tx.inboundMessage.updateMany({
  where: { id: inbound.id, processedAt: null },
  data: { processedAt: new Date() },
});
if (!claimed.count) return { handled: false, reason: "DUPLICATE_INBOUND" };
```

Duas entregas simultâneas do mesmo evento: apenas uma vence a corrida e avança o
estado.

**Quem já é lead pula o menu.** Se o número já tem `RecruitmentLead`, o roteador
vai direto para o fluxo de recrutamento — ninguém que já está em processo de
seleção recebe o menu de novo.

**Estado `PAUSED`.** Se a conversa de intenção estiver pausada, o roteador devolve
`{ routed: "paused" }` e nenhuma automação responde: a operação assume a conversa.

---

## Cenários de borda cobertos pelo código

| Situação | Comportamento |
|---|---|
| Mensagem de grupo | Ignorada (`{ ok: true, ignored: true }`) |
| Mensagem enviada por nós (`fromMe`) | Ignorada |
| `remoteJid` com formato não numérico | Ignorada |
| Resposta inválida ao menu | Menu reenviado, conversa segue em `CHOOSING_INTENT` |
| Reentrega do mesmo evento | `duplicate: true`, sem efeito colateral |
| Telefone já cadastrado como profissional | Vai direto ao recrutamento, sem menu |

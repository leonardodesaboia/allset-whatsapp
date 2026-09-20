# Exemplo 09 — Reengajamento de cadastro abandonado

**Pergunta que o fluxo responde:** a pessoa começou o pré-cadastro, respondeu
três perguntas e sumiu. O que o sistema faz?

Manda um lembrete — no máximo duas vezes, com no mínimo 24 horas entre elas, e
retomando exatamente da pergunta em que parou.

É o **único job que já está agendado** no `vercel.json`.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/domain/recruitment/reengagement-policy.ts` | Regra de elegibilidade (pura) |
| `src/application/recruitment/reengage-silent-conversations.usecase.ts` | A varredura |
| `src/app/api/cron/recruitment/reengage/route.ts` | Cron diário (`0 0 * * *`) |
| `src/app/api/internal/recruitment/reengage/route.ts` | Worker manual |

---

## Quem é candidata

```ts
where: {
  state: { in: activeStates },                    // estados com pergunta pendente
  lastInboundAt: { lte: cutoff },                 // silêncio >= afterHours
  reengagementCount: { lt: maximumAttempts },     // ainda não esgotou tentativas
  OR: [{ lastReengagementAt: null },
       { lastReengagementAt: { lte: cutoff } }],  // respeita intervalo entre lembretes
},
orderBy: { lastInboundAt: "asc" },                // quem está parado há mais tempo primeiro
take: limit,                                      // 1..100, padrão 25
```

`activeStates` é derivado de `QUESTIONS` **excluindo `INTRODUCTION`** — ou seja,
os oito estados com pergunta pendente, de `CHANNEL_PREFERENCE` a `AVAILABILITY`.
Ficam de fora, por construção, `PAUSED`, `COMPLETED` e `MANUAL_REVIEW`: quem
pediu para parar, quem já concluiu e quem está em revisão humana nunca recebem
cobrança. O domínio repete essa lista em `reengagement-policy.ts`, e o caso de
uso valida pelas duas vias antes de enviar.

### Parâmetros

| Variável | Padrão | Significado |
|---|---|---|
| `RECRUITMENT_REENGAGEMENT_AFTER_HOURS` | 24 | Silêncio necessário |
| `RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS` | 2 | Teto de lembretes por conversa |

Ambas validadas em `src/env.ts` como inteiro positivo, máximo 168.

---

## Exemplo executado

```
Seg 14:00  Maria responde "Aldeota" (NEIGHBORHOOD → PROFESSIONAL_EXPERIENCE)
           Bot pergunta sobre experiência
Seg 14:00  lastInboundAt = 14:00
…          silêncio
Ter 00:00  Cron roda — silêncio de apenas 10h → não elegível
Qua 00:00  Cron roda — silêncio de 34h → elegível
```

A Maria recebe duas mensagens:

```
Olá, Maria! Seu cadastro na AllSet ficou pela metade.
Vamos retomar de onde paramos.
```

```
Você já trabalhou fazendo limpeza para outras pessoas?
1 — Sim
2 — Não
```

A segunda é **a mesma pergunta do estado atual**, reenviada por
`enqueueRecruitmentQuestion` — o que significa que o áudio equivalente também vai
junto, se existir. A conversa não recomeça do zero.

Sem `fullName` ainda capturado, o lembrete abre com `"Olá!"` em vez de
`"Olá, Maria!"`.

---

## Duplo claim: a proteção contra lembrete duplicado

O job relê e revalida cada candidata **dentro** da transação, e só então
reivindica:

```ts
const claimed = await tx.recruitmentConversation.updateMany({
  where: {
    id: conversation.id,
    state: { in: activeStates },
    lastInboundAt: { lte: cutoff },
    reengagementCount: { lt: input.maximumAttempts },
    OR: [{ lastReengagementAt: null }, { lastReengagementAt: { lte: cutoff } }],
  },
  data: { lastReengagementAt: now, reengagementCount: { increment: 1 } },
});
if (!claimed.count) return false;
```

Todas as condições da busca são repetidas no `where` da escrita. Se a pessoa
respondeu entre a leitura e a escrita — ou se duas execuções do cron se
sobrepuseram — `count` é zero e nenhum lembrete é enviado.

A chave de idempotência da outbox fecha a última brecha:

```
reengagement:<conversationId>:<tentativa>:nudge
reengagement:<conversationId>:<tentativa>:text
reengagement:<conversationId>:<tentativa>:audio:<assetId>
```

---

## Rastro deixado

| Registro | Conteúdo |
|---|---|
| `LeadEvent` | `REENGAGEMENT_SENT` — *"Lembrete de pré-cadastro enviado (tentativa 1)"* |
| `AuditLog` | `RECRUITMENT_REENGAGEMENT_SENT` com `{ attempt, state }` |
| `RecruitmentConversation` | `lastReengagementAt`, `reengagementCount` |

---

## Retorno

```json
{ "ok": true, "scanned": 12, "reengaged": 9 }
```

Três candidatas não foram reengajadas — responderam no meio do caminho, perderam
o claim, estavam sem telefone ou estavam em um estado sem pergunta definida.

---

## Quando ela responde

Ao responder, `lastInboundAt` é atualizado e `misunderstandingCount` zerado. O
`reengagementCount` **não** é zerado — o teto de duas tentativas vale para a vida
inteira da conversa, não por ciclo de silêncio. É a proteção contra virar spam.

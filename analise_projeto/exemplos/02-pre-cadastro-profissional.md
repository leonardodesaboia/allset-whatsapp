# Exemplo 02 — Pré-cadastro da profissional pelo WhatsApp

**Pergunta que o fluxo responde:** como transformar um "quero trabalhar" em um
lead qualificado, sem formulário e sem operador humano?

É o fluxo mais completo do sistema: máquina de estados de conversa, ramificação
condicional, comandos globais, contagem de incompreensões e triagem automática
no final.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/domain/recruitment/conversation-definition.ts` | Perguntas, parser de respostas e comandos globais |
| `src/application/recruitment/conversation-engine.usecase.ts` | Motor da conversa de ponta a ponta |
| `src/application/recruitment/recruitment-question-outbox.ts` | Enfileira texto **e** áudio equivalentes da pergunta |
| `src/application/recruitment/transition-lead-status.usecase.ts` | Única entrada para mudar o status do lead |

---

## O grafo da conversa

```
INTRODUCTION
     ↓
CHANNEL_PREFERENCE  "1 — WhatsApp  /  2 — Ligação"
     ├─ PHONE ─────────────────────────► PAUSED + status LIGACAO_SOLICITADA
     └─ WHATSAPP
          ↓
        NAME → NEIGHBORHOOD → PROFESSIONAL_EXPERIENCE
                                   ├─ SIM → EXPERIENCE_DURATION ─┐
                                   └─ NAO → INFORMAL_EXPERIENCE ─┤
                                                                 ↓
                                                    SERVICE_AREA → AVAILABILITY
                                                                        ↓
                                                                    COMPLETED
```

A função que define o grafo cabe em 9 linhas (`nextState`, em
`conversation-engine.usecase.ts`) — a ramificação por experiência está ali.

---

## Exemplo executado

### Abertura

`startRecruitmentConversation` faz `upsert` do lead (`origin: WHATSAPP`), move
`LEAD → PRE_CADASTRO` e envia **duas** mensagens de uma vez: a apresentação e a
primeira pergunta.

```
Olá! 👋

A AllSet ajuda profissionais de limpeza a encontrar novos clientes.

Quando surgir uma oportunidade, você recebe pelo WhatsApp:
📍 onde será
📅 o dia
🕘 o horário
💰 quanto você vai receber

Você escolhe se quer aceitar.

Você não paga para receber oportunidades.
```

```
Como você prefere continuar?
1 — Continuar pelo WhatsApp
2 — Quero receber uma ligação
```

### Diálogo completo

| Estado | Bot | Pessoa | Efeito no `RecruitmentLead` |
|---|---|---|---|
| `CHANNEL_PREFERENCE` | menu acima | `1` | — (segue para `NAME`) |
| `NAME` | "Como você se chama? Pode escrever ou mandar um áudio." | `Maria Souza` | `fullName = "Maria Souza"` |
| `NEIGHBORHOOD` | "Em qual bairro você mora?" | `Aldeota` | `neighborhood = "Aldeota"` |
| `PROFESSIONAL_EXPERIENCE` | "Você já trabalhou fazendo limpeza para outras pessoas? 1 — Sim / 2 — Não" | `1` | `hasProfessionalExperience = true` |
| `EXPERIENCE_DURATION` | "Há mais ou menos quanto tempo? 1…4" | `3` | `experienceDuration = "GT_3Y"` |
| `SERVICE_AREA` | "Você consegue trabalhar no Meireles ou na Aldeota? 1 — Sim / 2 — Talvez / 3 — Não" | `1` | `canServeInitialArea = "SIM"` |
| `AVAILABILITY` | "Quais dias você costuma ter disponíveis?" | `segunda a sexta` | `availabilityDays = ["segunda a sexta"]` |

### Triagem automática ao final

Chegando em `COMPLETED`, o motor move o lead para `TRIAGEM` e então decide
sozinho o destino:

```ts
const canServeArea = triageLead.canServeInitialArea !== "NAO";
const definitelyNoExperience =
  triageLead.hasProfessionalExperience === false &&
  triageLead.hasInformalExperience === false;

const triageTarget = !canServeArea
  ? "BASE_FUTURA"
  : definitelyNoExperience
    ? "AGUARDANDO_COMPLEMENTACAO"
    : "CONVERSA_PENDENTE";
```

| Perfil | Destino | Significado operacional |
|---|---|---|
| Não atende a área inicial | `BASE_FUTURA` | Guardado para quando a AllSet expandir |
| Atende, mas sem nenhuma experiência | `AGUARDANDO_COMPLEMENTACAO` | Precisa de informação adicional |
| Atende e tem experiência | `CONVERSA_PENDENTE` + `nextAction: "Iniciar entrevista"` | Entra na fila de entrevista |

No caso da Maria: `CONVERSA_PENDENTE`, e ela aparece no Kanban do admin pronta
para entrevista.

---

## Comandos globais (valem em qualquer estado)

| Digitado | Efeito |
|---|---|
| `ajuda` / `help` | Status → `LIGACAO_SOLICITADA`, conversa → `PAUSED`, `nextAction: "Ligar para profissional"` |
| `ligacao` / `ligar` / `phone` | Idem |
| `parar` / `stop` | Conversa → `PAUSED` (sem mudar o status do lead) |
| `não entendi` | 1ª vez: repete a pergunta atual. 2ª vez: pede ligação e pausa |
| `menu` | Reconhecido como comando global |

---

## Tratamento de resposta inválida

Para perguntas com opções fechadas, uma resposta fora do conjunto aceito
incrementa `misunderstandingCount`:

```
1ª resposta inválida → repete a pergunta
2ª resposta inválida → conversa vai para MANUAL_REVIEW
                       lead ganha nextAction: "Revisar resposta não estruturada"
```

Perguntas abertas (`NAME`, `NEIGHBORHOOD`, `AVAILABILITY`) aceitam texto livre —
`parseAnswer` devolve o texto normalizado quando o estado não tem `options`.

---

## Acessibilidade: texto e áudio sempre em par

`enqueueRecruitmentQuestion` enfileira o texto e, se houver um
`QuestionAudioAsset` ativo para aquela pergunta, enfileira **também** o áudio com
a mesma pergunta:

```ts
idempotencyKey: `${prefix}:text`
idempotencyKey: `${prefix}:audio:${audio.id}`
```

Profissionais com pouca familiaridade com texto conseguem ouvir a pergunta e
responder por áudio (ver [exemplo 08](08-audio-e-transcricao.md)).

---

## Proteções de concorrência

| Proteção | Como |
|---|---|
| Mensagem processada uma só vez | `updateMany({ where: { id, processedAt: null } })` antes de qualquer efeito |
| Idempotência do envio | A chave inclui `conversation.updatedAt.getTime()` — reenvios da mesma pergunta no mesmo instante colapsam em uma linha |
| Transição de status | Sempre por `transitionLeadStatusInTransaction`, com lock por `version` |
| Lead sem telefone | Guard explícito: `if (!phoneE164) return { reason: "NO_PHONE" }` |
| Conversa encerrada ou pausada | `CONVERSATION_NOT_ACTIVE` — a automação não responde |

---

## Quando o lead está no funil mas sem conversa ativa

Se uma profissional já aprovada mandar mensagem, não existe conversa de
pré-cadastro para avançar. `processContactConversationText` então:

- se ela digitar `AJUDA` → move para `LIGACAO_SOLICITADA` e responde
  *"Recebemos seu pedido de ajuda! 📞 Nossa equipe entrará em contato…"*;
- caso contrário → envia um ACK contextual conforme o status (`ATIVA`,
  `PAUSADA`/`SUSPENSA` ou em andamento) **e cria uma `LeadNote`** com o texto
  recebido, para o operador ver no dashboard.

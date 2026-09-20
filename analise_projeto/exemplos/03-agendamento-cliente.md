# Exemplo 03 — Agendamento de limpeza pelo cliente

**Pergunta que o fluxo responde:** como um cliente contrata uma limpeza inteira
pelo WhatsApp, recebendo orçamento, sem falar com ninguém?

Duas máquinas de estado avançam em paralelo e na mesma transação: a **conversa**
(`CustomerBookingConversationState`) e o **pedido** (`BookingStatus`).

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/domain/customer/customer-conversation-definition.ts` | Perguntas e parser de escolhas |
| `src/domain/customer/customer-schedule.ts` | Datas e horários em `America/Fortaleza` |
| `src/application/customer/customer-booking-conversation.usecase.ts` | Motor da conversa |
| `src/application/booking/transition-booking-status.usecase.ts` | Transições do `Booking` |
| `src/domain/booking/booking-state-machine.ts` | `ALLOWED_TRANSITIONS` do pedido |

---

## As duas máquinas, lado a lado

| Estado da conversa | Status do `Booking` | O que acontece |
|---|---|---|
| `INTRODUCTION` | — | Confirma que quer contratar |
| `NAME` | — | Captura o nome real do cliente |
| `PROPERTY_CHARACTERISTICS` | `DRAFT → COLLECTING_DATA` | Cria o `Booking` com a faixa de preço escolhida |
| `SCHEDULE_DATE` | `COLLECTING_DATA` | Escolhe o dia |
| `SCHEDULE_TIME` | `COLLECTING_DATA → QUOTED` | Escolhe a hora, fecha `scheduledAt` e o orçamento |
| `QUOTE_ACCEPTANCE` | `QUOTED → QUOTE_ACCEPTED` | Aceita o valor |
| `ADDRESS` | `QUOTE_ACCEPTED → REVIEW_REQUIRED` | Recebe o endereço e manda para revisão humana |
| `MANUAL_REVIEW` | `REVIEW_REQUIRED` | Aguarda a operação validar cobertura |
| `FINAL_CONFIRMATION` | `AWAITING_CUSTOMER_CONFIRMATION` | (destravado pelo admin — ver [exemplo 04](04-validacao-de-cobertura.md)) |
| `AWAITING_PAYMENT` | `AWAITING_PAYMENT` | Aguarda pagamento |

---

## Exemplo executado

### Abertura

O cliente respondeu `1` no menu de intenção. `startCustomerBookingConversation`
cria o `User` com `role: CUSTOMER` — usando o **telefone como `fullName`
provisório**, um placeholder técnico que nunca é exibido como nome — e envia:

```
Olá! Você quer contratar uma limpeza residencial?
```

### Diálogo

**Cliente:** `1`

```
Qual é o seu nome?
```

**Cliente:** `Ana Ribeiro`
→ `User.fullName` é atualizado; as faixas ativas de `PropertyPricingTier` são
carregadas e montadas dinamicamente:

```
Qual opção descreve melhor o seu imóvel?

1 — Apartamento até 2 quartos
2 — Apartamento 3 quartos
3 — Casa até 3 quartos
```

**Cliente:** `2`
→ Aqui o **`Booking` nasce**, já com `propertyPricingTierId`,
`propertyCharacteristics` (cópia do JSON da faixa), `durationMinutes`,
`totalCents` e `requestedAt`; transição `DRAFT → COLLECTING_DATA`.

```
Qual dia você prefere?

1 — Amanhã (21/09)
2 — Depois de amanhã (22/09)
3 — 23/09
4 — 24/09
5 — 25/09
```

As opções são geradas por `customerScheduleDateChoices()`, sempre relativas ao
**fuso de Fortaleza**, nunca ao fuso do servidor.

**Cliente:** `1`
→ A data fica em `pendingScheduleDate` (ainda não é `scheduledAt`, porque falta
a hora).

```
Qual horário você prefere?
```
(opções fixas: `08:00`, `09:00`, `13:00`, `14:00`)

**Cliente:** `2`
→ `scheduledAtFromFortalezaLocal("2026-09-21", "09:00")` produz um `Date` com
offset `-03:00`. Se a data resultante já tiver passado, a conversa **volta** para
`SCHEDULE_DATE` em vez de aceitar um agendamento no passado.

→ Transição `COLLECTING_DATA → QUOTED`, `quotedAt` preenchido:

```
Este é o valor para a limpeza completa:

Valor: R$ 180,00
Duração prevista: 180 minutos

Quer seguir com este valor?

1 — Confirmar e continuar
2 — Alterar informações
```

**Cliente:** `1`
→ Transição `QUOTED → QUOTE_ACCEPTED`.

```
Agora envie o endereço completo do atendimento.
Ele será usado apenas para validar a área atendida.
```

**Cliente:** `Rua Silva Jatahy, 100, apto 802 — Meireles`
→ Endereço gravado em `addressLine1`, transição
`QUOTE_ACCEPTED → REVIEW_REQUIRED` com motivo *"Endereço aguarda validação de
cobertura"*, conversa vai para `MANUAL_REVIEW`:

```
Recebemos seus dados. Vamos validar o endereço e continuaremos por aqui.
```

A partir daqui a bola está com a operação ([exemplo 04](04-validacao-de-cobertura.md)).

---

## Caminhos alternativos implementados

### "Alterar informações" (opção 2 no orçamento)

Volta o `Booking` para `COLLECTING_DATA` e a conversa para
`PROPERTY_CHARACTERISTICS`. O `Booking` **não é recriado**: é atualizado e tem
data, endereço e validação de cobertura **limpos**, para não misturar dados de
duas cotações.

### Comandos do cliente

| Digitado | Efeito |
|---|---|
| `ajuda`, `help`, `menu` | Repete a pergunta atual (exceto em `MANUAL_REVIEW` e `AWAITING_PAYMENT`) |
| `falar com alguem`, `ligacao`, `ligar` | Conversa → `PAUSED` + *"Uma pessoa da AllSet continuará seu atendimento."* |
| `PARAR` | Conversa → `PAUSED`, sem resposta automática |
| Qualquer coisa em `MANUAL_REVIEW` | *"Seu pedido está sendo revisado. Vamos continuar por aqui assim que possível."* |
| Qualquer coisa em `AWAITING_PAYMENT` | *"Seu pedido continua aguardando pagamento."* |

### Configuração ausente

| Situação | Comportamento |
|---|---|
| Nenhum `PropertyPricingTier` ativo | Conversa → `MANUAL_REVIEW` + aviso ao cliente (`PRICING_NOT_CONFIGURED`) |
| Nenhum `ServiceDefinition` ativo | Idem (`SERVICE_NOT_CONFIGURED`) |
| Telefone pertence a um usuário não-cliente | `PHONE_ALREADY_USED` — não cria conversa |

### Retomada pela operação

`resumeCustomerBookingConversation` volta uma conversa `PAUSED` para o
`lastQuestionKey` guardado e **reenvia a pergunta daquele ponto**, reconstruindo
o texto dinâmico (faixas, datas, orçamento). Estados não retomáveis:
`PAUSED`, `COMPLETED`, `MANUAL_REVIEW`, `AWAITING_PAYMENT`, `QUOTE`.

---

## Validações de entrada

| Campo | Regra |
|---|---|
| Nome | 2 a 120 caracteres |
| Faixa de imóvel | Índice inteiro dentro da lista ativa |
| Data | Índice 1–5 ou `YYYY-MM-DD` |
| Horário | Índice 1–4 ou um dos valores permitidos; resultado precisa ser futuro |
| Endereço | 8 a 500 caracteres |

Toda resposta inválida reenvia a mesma pergunta — a conversa nunca trava sem
saída.

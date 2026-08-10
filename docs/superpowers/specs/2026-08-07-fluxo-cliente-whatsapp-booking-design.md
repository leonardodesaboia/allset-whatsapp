# Fluxo do cliente via WhatsApp — descoberta e design

## Objetivo

Permitir que uma pessoa solicite uma limpeza pelo WhatsApp, com uma pergunta por
vez, e criar um `Booking` consistente para o motor de oportunidades. O painel
admin continua como fallback para criar, corrigir e revisar pedidos.

## Limites

- Não reutilizar `RecruitmentConversation`: ela representa o funil de uma
  profissional e possui estados, dados e regras diferentes.
- Não acoplar regras ao adapter Evolution. O fluxo recebe a mensagem canônica
  já persistida por `InboundEventProcessor` e responde via outbox.
- Áudio é uma entrada oficial: o worker existente guarda e transcreve antes de
  enviar o texto para o motor da conversa. Falha de transcrição vira revisão
  humana; não descarta o pedido.
- Não implementar preço automático, pagamento real, CEP/geocoding ou matching
  sem decisões comerciais explícitas.

## Fluxo externo proposto (MVP)

```text
Cliente envia mensagem
  -> identifica intenção: pedir limpeza
  -> nome (se ainda não houver Customer/User)
  -> características/tamanho do imóvel
  -> data desejada
  -> horário desejado
  -> preço da tabela
  -> cliente aceita seguir
  -> endereço e complemento
  -> validação de cobertura pelo endereço
  -> resumo final e pagamento
  -> Booking em AWAITING_PAYMENT
  -> pagamento confirmado -> MATCHING
```

O matching só começa após pagamento identificado. Isso evita disparar ofertas e
reservar atenção de profissionais para um pedido que ainda pode não ser pago.
O preço não depende do bairro. Endereço completo só é coletado depois que o
cliente aceita o valor, mas antes do pagamento, para validar a cobertura real
sem cobrar por um endereço fora da área.

## Estados internos sugeridos

Criar um agregado próprio `CustomerBookingConversation`, associado a `User`
(quando identificado) e a um `Booking` provisório:

```text
INTENT
NAME
PROPERTY_SIZE
SCHEDULE_DATE
SCHEDULE_TIME
QUOTE
QUOTE_ACCEPTANCE
ADDRESS
FINAL_CONFIRMATION
PAYMENT
MANUAL_REVIEW
PAUSED
COMPLETED
```

Comandos globais: `AJUDA`, `MENU`, `PARAR` e `FALAR COM ALGUÉM`. Uma resposta
inesperada repete a pergunta uma vez; na recorrência cria próxima ação para o
admin, preservando tudo que já foi respondido.

## Dados e migrations previstos

`Booking` precisa receber apenas os dados de atendimento realmente necessários:

- `addressLine1`, `addressLine2?`, `reference?`;
- `customerNotes?`;
- `requestedAt`;
- `propertySize`;
- `quotedTotalCents?` e `quotedAt?` — valor fixo da tabela vigente no momento
  da cotação, preservado no pedido;
- `coverageValidatedAt?` e `outsideCoverageArea`.

`CustomerBookingConversation` deve guardar `userId?`, `bookingId?`, provider,
estado, última pergunta, `lastInboundAt`, pausa, versão e timestamps. Respostas
estruturadas pertencem ao `Booking`; conteúdo não interpretado continua em
  `InboundMessage`/`ReceivedAudio`, com referência operacional no booking apenas
  quando necessário.

## Decisões necessárias antes da implementação

1. Serviço único: limpeza residencial completa; diferença somente por tamanho
   do imóvel.
2. O bairro não é perguntado nem participa da precificação. A cobertura padrão
   (Meireles e Aldeota) é validada pelo endereço completo; fora dela, o pedido
   entra em lista de espera e pode receber tentativa excepcional/manual de
   encontrar profissional que aceite a área.
3. Endereço completo: somente depois de o cliente aceitar o valor, mas antes do
   pagamento, para validar cobertura real.
4. Preço fixo por tamanho de imóvel; o administrador mantém a tabela.
5. Confirmação de intenção e reserva são eventos distintos: cliente aceita a
   cotação, depois paga; a reserva só é confirmada após pagamento.
6. Estado de negócio proposto: `DRAFT -> QUOTED -> QUOTE_ACCEPTED ->
   AWAITING_PAYMENT -> PAID -> MATCHING -> PROFESSIONAL_ASSIGNED -> SCHEDULED`.
   A enumeração atual de `BookingStatus` precisará de migration para `QUOTED` e
   `QUOTE_ACCEPTED`; `SCHEDULED` representa a reserva confirmada.
7. Cancelamento até 24h antes de `scheduledAt`: reembolso integral. Depois:
   reembolso de 50%. Provider de pagamento permanece uma decisão separada.
8. Admin pode intervir a qualquer momento; a primeira mensagem manual pausa a
   automação, preservando o estado para retomada explícita.

## Critérios de aceite para a futura entrega

- Cliente inicia e retoma o mesmo pedido pelo WhatsApp.
- Texto e áudio chegam ao mesmo motor após o worker de mídia.
- Cada mensagem automática usa linguagem curta e uma pergunta por vez.
- Endereço e notas não aparecem em logs ou mensagens destinadas a profissionais.
- A cotação, o aceite de intenção, a validação de endereço e o pagamento ficam
  auditados em eventos distintos.
- Somente pagamento identificado e uma transição válida movem o booking para
  `MATCHING`.
- Todos os envios passam pela outbox e todos os estados pela máquina de estados.

## Implementação inicial (07/08/2026)

Foi implementada a primeira fatia do fluxo, sem dependência direta da Evolution:

- `ContactIntentConversation` apresenta um menu persistido que separa cliente
  de profissional; uma mensagem nova não vira lead de recrutamento por padrão.
- `CustomerBookingConversation` conduz apresentação, nome, escolha numerada da
  faixa de imóvel, data, horário, cotação, aceite e captura do endereço.
- As opções de imóvel vêm de `PropertyPricingTier`, mantida pelo administrador;
  nenhum preço ou tamanho foi hardcoded.
- As cinco próximas datas e os horários são enviados como opções numeradas. O
  booking recebe `scheduledAt` antes da cotação e do matching.
- A cobertura do endereço é decisão humana no admin. Fora da cobertura, o
  cliente recebe mensagem de lista de espera; dentro, recebe a confirmação para
  pagamento. O booking só alcança `AWAITING_PAYMENT` após essa confirmação.
- Tanto texto nativo quanto texto transcrito de áudio passam pelo mesmo roteador
  de conversas. Todos os envios automáticos usam a outbox.
- Uma mensagem manual enviada pelo admin pausa a automação e fica auditada; o
  admin pode retomá-la do mesmo passo quando for apropriado.
- A tela `Admin > Preços` permite cadastrar e ativar/desativar as faixas de
  imóvel, criando também o único serviço residencial padrão quando necessário.

Ainda faltam disponibilidade real por profissional (as opções de horário são
uma configuração inicial), provider de pagamento, confirmação do pagamento e
o disparo de matching. Esses pontos permanecem fora desta fatia porque
dependem de integrações e configurações comerciais que ainda não foram
definidas.

## Próximo passo

Definir as categorias concretas de tamanho e os respectivos preços; então
transformar esta spec em plano de implementação incremental: schema + motor de
conversa puro, casos de uso, webhook/outbox, painel de revisão e testes de
integração/E2E.

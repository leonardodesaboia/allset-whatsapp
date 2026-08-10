# ConversationEngine e pré-cadastro automatizado — Sub-spec 3

**Data:** 2026-08-07  
**Status:** Pronto para planejamento  
**Depende de:** Sub-spec 1 e Sub-spec 2

## Objetivo

Automatizar o pré-cadastro de profissionais sobre a mensageria genérica. Uma
mensagem inbound deve criar ou retomar um lead, persistir o estado da conversa,
enviar uma pergunta por vez via outbox e mover o Kanban conforme as respostas.

## Limites

- Provider continua sendo somente `MockMessagingAdapter`; Evolution permanece
  fora desta entrega.
- Perguntas são texto e opções; o requisito de áudio é implementado no
  Sub-spec 4. Cada definição terá uma chave estável, pronta para receber um
  `audioAssetId` depois.
- Não implementar entrevista, referência, documentos, onboarding ou teste.
- Não inferir respostas livres/áudio: entradas não estruturadas vão para
  revisão manual, preservando a conversa.

## Dados e estados

Adicionar `RecruitmentConversation` ligada 1:1 a `RecruitmentLead`, com:

- `state`: `INTRODUCTION`, `CHANNEL_PREFERENCE`, `NAME`, `NEIGHBORHOOD`,
  `PROFESSIONAL_EXPERIENCE`, `EXPERIENCE_DURATION`,
  `INFORMAL_EXPERIENCE`, `SERVICE_AREA`, `AVAILABILITY`, `MANUAL_REVIEW`,
  `PAUSED`, `COMPLETED`.
- `lastQuestionKey`, `misunderstandingCount`, `automationPausedAt` e
  `lastInboundAt`.

As perguntas são definições puras e imutáveis no domínio. A fonte de verdade
do fluxo é o estado persistido, não dados em memória do worker.

## Fluxo

1. Entrada inbound com intenção de recrutamento cria/localiza lead e conversa.
2. Engine envia apresentação e preferência de canal.
3. `PHONE`, `LIGAÇÃO`, `AJUDA` ou equivalente preservam respostas, marcam
   `LIGACAO_SOLICITADA`, definem próxima ação e pausam automação.
4. WhatsApp percorre nome, bairro, experiência, área e disponibilidade.
5. Resposta válida atualiza o lead e enfileira a próxima pergunta na mesma
   transação. Repetição do mesmo inbound não duplica avanço/outbox.
6. Ao concluir, triagem determinística: área `NAO` -> `BASE_FUTURA`; dados
   ausentes -> `AGUARDANDO_COMPLEMENTACAO`; dados mínimos ->
   `CONVERSA_PENDENTE`, com próxima ação humana.

## Comandos globais

Reconhecer case-insensitivamente `AJUDA`, `LIGAÇÃO`, `LIGACAO`, `PARAR` e
`MENU`. `NÃO ENTENDI` repete uma vez a pergunta; na segunda ocorrência oferece
ligação. Nenhum comando reinicia o pré-cadastro.

## Critérios de aceite

1. Nova pessoa percorre o pré-cadastro sem clique manual do admin.
2. Reentrada retoma a pergunta pendente, sem perda ou duplicação de dados.
3. Pedido de ligação aparece no Kanban com próxima ação e automação pausada.
4. Branch de experiência profissional/informal é explícito e testado.
5. Triagem move o lead para `CONVERSA_PENDENTE`, `BASE_FUTURA` ou revisão.
6. Respostas livres inesperadas nunca descartam a conversa.

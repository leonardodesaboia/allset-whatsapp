# ConversationEngine e pré-cadastro automatizado — Sub-spec 3: plano

## 1. Schema e migration

- [ ] Criar enum `RecruitmentConversationState` e model
  `RecruitmentConversation` com vínculo único ao lead.
- [ ] Criar migration aditiva e testes de integração de persistência.

## 2. Definições puras de perguntas e parser

- [ ] Criar `domain/recruitment/conversation-definition.ts` com question key,
  texto, opções, próximo estado e placeholder de áudio.
- [ ] Criar normalizador de entrada e parser explícito de opções/comandos.
- [ ] Testar branches e comandos globais sem I/O.

## 3. Criação/retomada de conversa

- [ ] Implementar use case que recebe `InboundMessage`, localiza/cria lead por
  telefone e cria/retoma a conversa idempotentemente.
- [ ] Enfileirar a apresentação e próxima pergunta pela outbox na mesma
  transação.
- [ ] Testar reentrada e duplicidade inbound.

## 4. Processamento de resposta

- [ ] Implementar o engine transacional: interpretar resposta, gravar dados no
  lead, avançar estado e enfileirar uma única próxima pergunta.
- [ ] Implementar ajuda, ligação, parar e não-entendimento.
- [ ] Encaminhar conteúdo livre não estruturado a `MANUAL_REVIEW` com evento e
  próxima ação, sem apagar dados.

## 5. Triagem

- [ ] Criar função pura de triagem operacional, sem julgamento de qualidade.
- [ ] Atualizar status do lead exclusivamente pelo caso de uso de transição.
- [ ] Criar próxima ação quando a decisão for humana.

## 6. Integração e verificação

- [ ] Conectar consumidor inbound ao `processInboundEvent` do Sub-spec 2.
- [ ] Testar o caminho completo mock: entrada -> outbox -> dispatcher ->
  resposta -> avanço -> Kanban.
- [ ] Rodar lint, typecheck, architecture check, unitários, integração e E2E.

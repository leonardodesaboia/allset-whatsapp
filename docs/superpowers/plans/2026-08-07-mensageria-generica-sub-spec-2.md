# Mensageria genérica — Sub-spec 2: plano de implementação

> Execute em commits pequenos, com teste vermelho antes de cada implementação.

## Meta

Entregar mensageria genérica, mock e outbox confiável; não implementar ainda
webhook de Evolution nem regras conversacionais.

## 1. Schema e migration

- [ ] Adicionar `OutboundMessageStatus`, `InboundMessage` e `OutboxMessage` a
  `prisma/schema.prisma`.
- [ ] Criar migration aditiva com índices para entrega (`status, availableAt`)
  e idempotência inbound (`provider, externalId` único).
- [ ] Regenerar Prisma Client e rodar typecheck.
- [ ] Teste de integração: índices/unique rejeitam o inbound duplicado.

## 2. Contratos puros de mensageria

Arquivos: `src/domain/messaging/message.ts`,
`src/domain/ports/messaging-gateway.ts` e testes unitários.

- [ ] Definir envelope canônico versionado, `TextMessage`, identificadores de
  correlação e resultado de entrega.
- [ ] Definir `MessagingCapabilities`, `MessagingGateway.send()` e `health()`.
- [ ] Validar invariantes de domínio sem Prisma e sem provider.
- [ ] Rodar `architecture:check`.

## 3. Adapter mock

Arquivos: `src/infrastructure/messaging/mock-messaging-adapter.ts` e testes.

- [ ] Implementar adapter imutável em memória que registra envios e permite
  configurar a próxima falha.
- [ ] Testar envio, capacidades, falha transitória e nenhum acesso de rede.

## 4. Outbox transacional

Arquivos: `src/application/messaging/enqueue-outbound-message.usecase.ts` e
teste de integração.

- [ ] Criar input validado, payload JSON canônico e `OutboxMessage` pendente.
- [ ] Aceitar `PrismaClient` ou `TransactionClient`, para permitir que um caso
  de uso de negócio faça alteração + outbox numa única transação.
- [ ] Registrar `AuditLog` com correlação, sem payload sensível.
- [ ] Testar rollback atômico e persistência de uma pendência.

## 5. Dispatcher com retry

Arquivos: `src/application/messaging/dispatch-outbox.usecase.ts` e teste de
integração.

- [ ] Reivindicar uma mensagem por update condicionado (`PENDING`/`FAILED` e
  `availableAt <= now`) para evitar despacho concorrente.
- [ ] Chamar a porta, marcar sucesso, ou reagendar falha com backoff limitado.
- [ ] Registrar `AuditLog` e log estruturado por correlação.
- [ ] Testar sucesso, falha e duas chamadas concorrentes.

## 6. Entrada idempotente

Arquivos: `src/application/messaging/process-inbound-event.usecase.ts` e
teste de integração.

- [ ] Persistir evento canônico pelo par provider/ID externo.
- [ ] Retornar resultado idempotente para repetição, sem erro e sem segunda
  linha de banco.
- [ ] Registrar auditoria apenas no primeiro processamento.
- [ ] Expor o evento persistido para o `ConversationEngine` futuro, mas não
  iniciar conversa nesta fase.

## 7. Wiring e verificação

- [ ] Criar composition root interno que injeta `MockMessagingAdapter` nos
  testes; nenhum componente Next importa adapter diretamente.
- [ ] Rodar lint, typecheck, architecture check, testes unitários, integração
  e build.
- [ ] Atualizar roadmap/ADR somente se uma decisão nova for necessária.

## Ordem de dependências

`1 -> 2 -> (3 e 4) -> 5 -> 6 -> 7`. Os itens 3 e 4 são independentes após
os contratos e podem ser desenvolvidos em paralelo.

# Mensageria genérica — Sub-spec 2

**Data:** 2026-08-07  
**Status:** Pronto para planejamento  
**Depende de:** Fundação e Sub-spec 1 (funil)

## Objetivo

Criar a base de mensageria agnóstica de provider da AllSet: contrato canônico,
adapter em memória, recebimento idempotente e outbox transacional para envio.
Ela deve tornar possível construir o `ConversationEngine` no Sub-spec 3 sem
acoplar o domínio à Evolution API ou a qualquer API de WhatsApp.

## Escopo

- `MessagingGateway` com envio, capacidade e saúde do provider.
- Modelo canônico de mensagens de entrada e saída.
- `MockMessagingAdapter` determinístico, sem I/O externo, para testes.
- `InboundEventProcessor` idempotente que normaliza e persiste eventos de
  entrada para consumo futuro.
- Outbox transacional persistente, relay de despacho e política de retry.
- Auditoria e observabilidade do ciclo de envio.

## Fora do escopo

- Evolution API, webhooks HTTP públicos e credenciais de providers.
- `ConversationEngine`, fluxo de recrutamento, perguntas ou triagem.
- Áudio, upload/download de mídia, TTS e `StorageProvider` para mensageria.
- pg-boss e workers de longa duração: o relay síncrono/testável desta fase
  deixa a interface pronta para um worker posterior na Fase 6.

## Arquitetura

```
Use case de negócio
  -> OutboxMessage (na mesma transação)
  -> OutboxDispatcher
  -> MessagingGateway (porta)
  -> MockMessagingAdapter (infra; Evolution depois)

Provider normaliza entrada
  -> InboundEventProcessor
  -> InboundMessage persistida e auditada
  -> consumidor futuro: ConversationEngine (Sub-spec 3)
```

O domínio só conhece tipos e a porta. Prisma, retries, adapter e logs vivem
nas camadas application/infrastructure. Nenhum componente de UI chama um
provider diretamente.

## Dados

Migration aditiva:

- `OutboundMessageStatus`: `PENDING`, `SENDING`, `SENT`, `FAILED`.
- `InboundMessage`: provider, ID externo, remetente/destinatário, tipo,
  payload canônico, recebido em; unicidade `(provider, externalId)`.
- `OutboxMessage`: provider, destinatário, payload canônico, status, número
  de tentativas, `availableAt`, última falha, IDs de correlação e timestamps.

Payloads são JSON canônico versionado. Não guardar tokens, segredos ou
credenciais nos payloads.

## Invariantes

- Enfileirar uma mensagem e alterar uma entidade crítica devem ocorrer na
  mesma transação do Prisma.
- O mesmo evento externo não pode produzir duas mensagens inbound.
- O dispatcher só despacha `PENDING`/`FAILED` cujo `availableAt` já passou.
- Uma falha do provider não perde a mensagem; ela incrementa tentativas e
  agenda retry com backoff limitado.
- O mock nunca realiza rede e registra cada envio para asserções.
- O estado `SENT` só é gravado após resposta de sucesso do gateway.

## Critérios de aceite

1. Um use case consegue criar uma mensagem de outbox na mesma transação.
2. O dispatcher envia uma pendência pelo mock e a marca `SENT`.
3. Falha transitória deixa a mensagem recuperável e auditável.
4. Evento inbound repetido é ignorado sem duplicar persistência.
5. A camada de domínio não importa Prisma, Next nem provider concreto.
6. Os testes de integração usam Postgres real e os unitários não fazem I/O.

## Riscos

- Duplicidade por retries: mitigar por chave de idempotência e status
  condicionado no update.
- Acoplamento prematuro a WhatsApp: limitar o contrato a texto e metadados
  extensíveis; mídia entra somente no Sub-spec 4.
- Conflito de worker: não introduzir pg-boss antes de existir um processo de
  execução e operação definidos.

# AllSet — guia rápido para o Claude Code

Marketplace de limpeza doméstica acionado via WhatsApp.

## Arquitetura

Monólito modular em Next.js 16 (App Router) + TypeScript strict + Prisma 6 + PostgreSQL.
Decisão registrada em `docs/adr/0001-arquitetura-monolito-modular.md`.

```
src/domain/          regras puras — sem I/O, sem frameworks
src/application/     casos de uso transacionais e read models
src/infrastructure/  Prisma, Better Auth, adapters (Evolution, Whisper, Storage)
src/app/             Next.js App Router: Server Components, Server Actions, rotas HTTP
prisma/              schema + migrations aditivas
```

**Regra de dependência** (enforced por `pnpm architecture:check`):
`domain` → nada. `application` → `domain`. `infrastructure` → domínio + application.
`app` → qualquer camada. Nunca o sentido contrário.

## Convenções críticas

- **Transições de status**: sempre via `transitionLeadStatusInTransaction`. Nunca `update({ status })` direto — a função aplica a máquina de estados, lock otimista, histórico, evento e auditoria em uma transação.
- **Mensagens de saída**: sempre `enqueueOutboundMessage` dentro de uma transação. Nunca chamar Evolution API diretamente de Server Actions ou casos de uso.
- **Erros recuperáveis**: padrão `Result<T, E>` com `ok()` / `err()` de `src/domain/shared/result.ts`. Usar `throw` somente para falhas inesperadas.
- **Concorrência**: lock otimista com campo `version`. Usar `updateMany({ where: { id, version } })` e checar `.count` — zero significa conflito.
- **Transações atômicas**: `prisma.$transaction(async (tx) => { ... })` para qualquer operação multi-tabela. Passar `tx` adiante, nunca o `prisma` global dentro de uma transação.
- **Package manager**: somente `pnpm`. Não usar `npm` ou `yarn`.
- **Sem barrel files**: importar de módulos específicos, nunca de `index.ts`.

## Mapa de arquivos importantes

| Arquivo | Papel |
|---|---|
| `src/domain/recruitment/recruitment-state-machine.ts` | `ALLOWED_TRANSITIONS` e `transitionRecruitmentStatus` |
| `src/domain/recruitment/conversation-definition.ts` | perguntas do pré-cadastro, parser de respostas e comandos globais |
| `src/application/recruitment/conversation-engine.usecase.ts` | lógica de conversa WhatsApp de ponta a ponta |
| `src/application/recruitment/transition-lead-status.usecase.ts` | única entrada para transições de status de lead |
| `src/application/recruitment/kanban-read-model.ts` | colunas do Kanban e queries de leitura |
| `src/application/messaging/dispatch-outbox.usecase.ts` | lease, retry exponencial e dead letter da outbox |
| `src/infrastructure/messaging/evolution-webhook.ts` | normalização e validação do webhook da Evolution |
| `src/infrastructure/auth/compare-secret.ts` | comparação de segredos em tempo constante (timing-safe) |
| `src/env.ts` | validação de variáveis de ambiente com Zod |

## Testes

| Suite | Comando | Requer Docker? |
|---|---|---|
| Unitários (rápidos) | `pnpm test` | Não |
| Integração (Testcontainers) | `pnpm test:integration` | Sim |
| E2E (Playwright) | `pnpm test:e2e` | Sim |

Verificação completa (igual ao CI): `pnpm ci:check`.

Após qualquer alteração, no mínimo: `pnpm tsc --noEmit && pnpm architecture:check && pnpm test`.

## Estado de produção

O fluxo de **texto** é funcional de ponta a ponta. Único bloqueador para o fluxo de **áudio**:
o worker que baixa mídia da Evolution API, chama `recordReceivedAudio` e aciona
`POST /api/internal/messaging/transcribe`. Sem ele, áudios chegam no webhook mas não chegam ao Whisper.

Runbook completo: `docs/runbooks/evolution-messaging.md`.
Inventário de entregas: `docs/product/implementation-status-2026-08-07.md`.

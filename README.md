# AllSet

Marketplace de serviços via WhatsApp. Além da fundação, o repositório contém o
funil de recrutamento, mensageria com outbox, `ConversationEngine`, assets de
áudio e os primeiros adapters de integração.

Para a operação de WhatsApp e transcrição, consulte o
[runbook da Evolution e áudio](docs/runbooks/evolution-messaging.md) e a
[decisão de transcrição](docs/adr/0004-transcricao-whisper.md). O inventário
completo do que já foi entregue e do que ainda depende de homologação está em
[estado consolidado da implementação](docs/product/implementation-status-2026-08-07.md).

## Pré-requisitos

- **Node 24+** (ver `.nvmrc` — `nvm use`)
- **pnpm** (único package manager suportado; versão fixada em
  `packageManager` no `package.json`, use `corepack enable`)
- **Docker** rodando — necessário para o Postgres local e para os testes de
  integração (Testcontainers)

## Setup

```bash
# 1. Variáveis de ambiente
cp .env.example .env
```

> O `.env.example` já traz valores prontos para MinIO local. Para o fluxo
> de texto puro, os campos `S3_*` podem ficar em branco — o provider local
> é ativado automaticamente. Para áudio (Evolution + Whisper), MinIO é necessário.

⚠️ Edite o `.env` e **gere um `BETTER_AUTH_SECRET` real** — o valor de
placeholder do `.env.example` é rejeitado de propósito por `src/env.ts` (ele é
público, está versionado; assinar sessões com ele permitiria forjar um cookie
de admin). Gere um assim:

```bash
openssl rand -base64 32
```

Para habilitar a integração real também gere e configure `EVOLUTION_*`,
`INTERNAL_JOB_SECRET` e, para transcrição, `OPENAI_API_KEY`. As variáveis e os
procedimentos de homologação estão no runbook; nenhuma delas é necessária para
os testes unitários.

```bash
# 2. Dependências
pnpm install

# 3. Banco de dados local
docker compose up -d db

# 4. Migrations + Prisma Client
pnpm prisma:deploy
pnpm prisma:generate

# 5. Subir a aplicação
pnpm dev            # http://localhost:3000
```

## Testes

| Comando                | O que roda                                  | Precisa de Docker? |
| ---------------------- | ------------------------------------------- | ------------------ |
| `pnpm test`            | Testes unitários (rápidos, sem I/O)         | Não                |
| `pnpm test:integration`| Testes `*.integration.test.ts` (Testcontainers: sobe um Postgres descartável por arquivo) | **Sim** |
| `pnpm test:e2e`        | Playwright (buila o app, sobe e navega)     | **Sim** (Postgres local via `docker compose up -d db`) |

O `pnpm test:e2e` usa o banco **local** (não um Testcontainer) e seeda o admin
`admin@allset.test`. Esse seed é travado para só rodar contra
`localhost`/`127.0.0.1` e fora de produção.

Para os browsers do Playwright na primeira execução:

```bash
pnpm exec playwright install chromium
```

## Verificação completa

```bash
pnpm ci:check   # lint + typecheck + arquitetura + dead-code + unit tests + build
```

Este é o mesmo conjunto que o CI roda (`.github/workflows/ci.yml`), que além
disso executa `pnpm test:integration` e `pnpm test:e2e`.

### Guardrails

- `pnpm architecture:check` — dependency-cruiser: o domínio (`src/domain`) não
  pode importar de `src/infrastructure`, `src/application`, `src/app` nem de
  frameworks (`next`, `@prisma/*`, `better-auth`, `pino`).
- `pnpm dead-code:check` — Knip: exports/dependências não usados.

## Fluxo de pré-cadastro (WhatsApp)

```text
INTRODUCTION     apresentação da AllSet (enviado automaticamente no primeiro contato)
     ↓
CHANNEL_PREFERENCE   "1 — WhatsApp  /  2 — Ligação"
     ├─ PHONE ──────────────────────────────────────→ PAUSED + LIGACAO_SOLICITADA
     └─ WHATSAPP
          ↓
         NAME → NEIGHBORHOOD → PROFESSIONAL_EXPERIENCE
                                    ├─ SIM → EXPERIENCE_DURATION ─┐
                                    └─ NAO → INFORMAL_EXPERIENCE  ─┤
                                                                   ↓
                                                             SERVICE_AREA → AVAILABILITY
                                                                                ↓
                                                                            COMPLETED → triagem automática
                                                                               ├─ não cobre área     → BASE_FUTURA
                                                                               ├─ sem experiência    → AGUARDANDO_COMPLEMENTACAO
                                                                               └─ qualificado        → CONVERSA_PENDENTE
```

Comandos globais aceitos em qualquer estado: `ajuda` / `ligar` → solicita ligação;
`parar` → pausa a automação; `não entendi` → repete a pergunta atual (1ª vez) ou
solicita ligação (2ª vez).

## Pendências de produção

O fluxo de **texto** funciona de ponta a ponta. O único bloqueador para o fluxo
de **áudio** é o worker de download de mídia da Evolution:

1. O webhook recebe o evento de áudio e devolve `{ needsMediaDownload: true }`
2. Um worker externo deve buscar os bytes na Evolution, chamar
   `recordReceivedAudio` e acionar `POST /api/internal/messaging/transcribe`
3. Sem esse worker, áudios chegam ao webhook mas não são processados pelo Whisper

Detalhes operacionais, variáveis de ambiente e checklist de homologação:
`docs/runbooks/evolution-messaging.md`.

## Estrutura

```
src/domain/          # regras de negócio puras (sem framework, sem I/O)
src/application/     # casos de uso, orquestração
src/infrastructure/  # Prisma, Better Auth, logger, adapters de ports
src/app/             # Next.js App Router
prisma/              # schema + migrations
tests/integration/   # harness de Testcontainers
tests/e2e/           # specs do Playwright + seed
docs/adr/            # decisões de arquitetura
docs/runbooks/        # operação e homologação de integrações
```

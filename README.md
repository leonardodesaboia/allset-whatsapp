# AllSet

Marketplace de serviços via WhatsApp. Este repositório está na **Fase 1 —
Fundação** (domínio, schema, ports, auth de admin e guardrails de arquitetura).

> Documentação completa é escopo da Fase 8. Isto aqui é só o "como rodar".

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

⚠️ Edite o `.env` e **gere um `BETTER_AUTH_SECRET` real** — o valor de
placeholder do `.env.example` é rejeitado de propósito por `src/env.ts` (ele é
público, está versionado; assinar sessões com ele permitiria forjar um cookie
de admin). Gere um assim:

```bash
openssl rand -base64 32
```

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
```

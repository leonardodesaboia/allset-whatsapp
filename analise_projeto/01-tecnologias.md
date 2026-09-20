# Tecnologias do projeto

Levantamento feito a partir de `package.json`, `prisma/schema.prisma`,
`docker-compose.yml`, `vercel.json` e do código em `src/`.

---

## 1. Base de execução

| Item | Versão / escolha | Onde aparece |
|---|---|---|
| Runtime | **Node.js 24+** | `package.json` (`engines.node`), `.nvmrc` |
| Linguagem | **TypeScript 5.7** em modo strict | `tsconfig.json` |
| Package manager | **pnpm 10.34.5** (fixado via `packageManager`) — `npm`/`yarn` não são suportados | `package.json` |
| Módulos | ESM (`"type": "module"`) | `package.json` |

---

## 2. Framework de aplicação

| Item | Versão | Papel |
|---|---|---|
| **Next.js 16** (App Router) | `^16.3.0` | Monólito: Server Components, Server Actions e Route Handlers HTTP no mesmo deploy |
| **React 19** | `^19.2.8` | UI do dashboard administrativo |

Três formas de entrada convivem em `src/app/`:

- **Server Components** — páginas do admin que leem direto dos read models
  (ex.: `src/app/admin/recruitment/page.tsx`).
- **Server Actions** (`"use server"`) — mutações vindas do dashboard, sempre
  autenticadas antes de chamar o caso de uso (`src/app/admin/recruitment/actions.ts`).
- **Route Handlers** — integrações externas: webhook da Evolution, endpoints
  internos de worker e endpoints de cron (`src/app/api/**`).

---

## 3. Persistência

| Item | Versão | Papel |
|---|---|---|
| **PostgreSQL 17** | imagem `postgres:17-alpine` | Banco único (monólito modular) |
| **Prisma 6** | `^6.19.3` | ORM, migrations aditivas e client tipado |

Características relevantes do modelo (`prisma/schema.prisma`):

- **Enums de domínio no banco**: `RecruitmentStatus` (21 valores), `BookingStatus`
  (21 valores), `ServiceOpportunityStatus`, `OutboundMessageStatus`, etc.
- **Lock otimista** por campo `version` em `RecruitmentLead`, `Booking` e
  `CustomerBookingConversation`.
- **Idempotência no schema**: `@@unique([provider, externalId])` em `InboundMessage`,
  `idempotencyKey @unique` em `OutboxMessage`, `@@unique([opportunityId, leadId])`
  em `OpportunityResponse`.
- **Trilha de auditoria** de primeira classe: `AuditLog`, `RecruitmentStatusHistory`,
  `BookingStatusHistory`, `LeadEvent`.

Migrations são **aditivas** e versionadas em `prisma/migrations/` (22 migrations,
de `20260807001029_init` em diante).

---

## 4. Autenticação

| Item | Versão | Papel |
|---|---|---|
| **Better Auth** | `^1.6.26` | Sessão e credenciais do admin (e-mail + senha) |
| **@better-auth/prisma-adapter** | `^1.6.26` | Persistência das tabelas `Auth*` |

Decisão explícita em `src/infrastructure/auth/auth.ts`: as tabelas de
autenticação (`AuthUser`, `AuthSession`, `AuthAccount`, `AuthVerification`) são
**separadas** do `User` de domínio, para que sessão e credencial não se acoplem
a papéis de negócio. Senha mínima de 10 caracteres e rate limit de 5 tentativas
por minuto. Todo login gera `ADMIN_LOGIN_ATTEMPT` no `AuditLog`.

Segredos de webhook e de jobs usam comparação em tempo constante
(`src/infrastructure/auth/compare-secret.ts`).

---

## 5. Mensageria (WhatsApp)

| Item | Papel |
|---|---|
| **Evolution API** (serviço externo) | Gateway de WhatsApp: recebe webhooks e envia texto/mídia |
| `EvolutionMessagingAdapter` | Implementa o port `MessagingGateway` (`src/infrastructure/messaging/evolution-messaging-adapter.ts`) |
| `MockMessagingAdapter` | Mesmo port, para desenvolvimento e testes |
| Registry de gateways | Seleção por `provider` gravado na mensagem (`messaging-gateway-registry.ts`) |

O envio nunca é direto: a aplicação grava em `OutboxMessage` e um worker
despacha. O adapter envia `x-idempotency-key` para a Evolution e, para áudio,
gera uma URL assinada temporária do storage.

---

## 6. Storage de mídia

| Item | Versão | Papel |
|---|---|---|
| **AWS SDK S3 v3** | `^3.1106.0` | Cliente S3 (`@aws-sdk/client-s3`) |
| **@aws-sdk/s3-request-presigner** | `^3.1106.0` | URLs assinadas para a Evolution buscar o áudio |
| **MinIO** | imagem `minio/minio` | S3 local em desenvolvimento (`docker-compose.yml`) |

Três implementações do port `StorageProvider`: `S3StorageProvider`,
`LocalStorageProvider` (dev sem S3) e `InMemoryStorageProvider` (testes). A
escolha é feita em runtime por `storage-runtime.ts` conforme as variáveis `S3_*`.

---

## 7. Transcrição de áudio

| Item | Papel |
|---|---|
| **OpenAI Whisper** | Transcreve áudios recebidos (`openai-whisper-transcriber.ts`) |
| Port `AudioTranscriber` | Abstração de domínio — o caso de uso não conhece a OpenAI |

Decisão registrada em `docs/adr/0004-transcricao-whisper.md`. A transcrição é
tratada como **recurso de acessibilidade**, não como critério de seleção: falhas
não apagam o áudio e podem ser revisadas manualmente.

---

## 8. Interface do dashboard

| Item | Versão | Papel |
|---|---|---|
| **Tailwind CSS 4** | `^4.3.3` | Estilos (via `@tailwindcss/postcss`) |
| **Radix UI** | avatar, dialog, dropdown-menu, separator, slot, tooltip | Primitivas acessíveis |
| **dnd-kit** | `^6.3.1` | Drag-and-drop do Kanban de recrutamento (ADR 0003) |
| **lucide-react** | `^1.31.0` | Ícones |
| **class-variance-authority**, **clsx**, **tailwind-merge** | — | Composição de classes dos componentes em `src/components/ui/` |

---

## 9. Validação, erros e observabilidade

| Item | Papel |
|---|---|
| **Zod 4** | Validação de variáveis de ambiente (`src/env.ts`) e de entradas de casos de uso e Server Actions |
| **Pino 10** | Logging estruturado (`src/infrastructure/observability/logger.ts`) |
| `Result<T, E>` | Erros recuperáveis sem exceção (`src/domain/shared/result.ts`); `throw` fica para falhas inesperadas |
| `DomainError` | Erro de domínio com código estável (ex.: `INVALID_RECRUITMENT_TRANSITION`) |
| Port `ErrorReporter` | Ponto de extensão para APM/Sentry; hoje há o `ConsoleErrorReporter` |

Destaque de `src/env.ts`: o schema **rejeita explicitamente** o placeholder de
`BETTER_AUTH_SECRET` publicado no `.env.example`, porque ele é versionado e
permitiria forjar um cookie de admin.

---

## 10. Testes

| Suite | Ferramenta | Comando | Docker |
|---|---|---|---|
| Unitários | **Vitest 4** | `pnpm test` | Não |
| Integração | **Vitest + Testcontainers** (`@testcontainers/postgresql`) | `pnpm test:integration` | Sim |
| E2E | **Playwright 1.62** | `pnpm test:e2e` | Sim |

Os testes de integração sobem um Postgres descartável por arquivo; os E2E usam o
Postgres local e um seed de admin travado para `localhost` fora de produção.

---

## 11. Guardrails e qualidade

| Ferramenta | Comando | O que garante |
|---|---|---|
| **dependency-cruiser 18** | `pnpm architecture:check` | A regra de dependência entre camadas (domínio não importa framework nem infra) |
| **Knip 6** | `pnpm dead-code:check` | Exports e dependências não usados |
| **ESLint 10** + typescript-eslint | `pnpm lint` | Padrões de código |
| **Prettier 3** | — | Formatação |
| `tsc --noEmit` | `pnpm typecheck` | Tipagem strict |

Verificação completa (mesma do CI): `pnpm ci:check`.

---

## 12. Infraestrutura e deploy

| Item | Papel |
|---|---|
| **Docker Compose** | Postgres 17 + MinIO + inicialização do bucket, para desenvolvimento local |
| **Vercel** | Deploy; `vercel.json` agenda o cron `/api/cron/recruitment/reengage` diariamente (`0 0 * * *`) |
| Endpoints internos (`/api/internal/*`) | Workers protegidos por `INTERNAL_JOB_SECRET` no header `x-allset-job-secret` |
| Endpoints de cron (`/api/cron/*`) | Protegidos por `CRON_SECRET` via `Authorization: Bearer` |

---

## Resumo em uma frase

Monólito modular **Next.js 16 + TypeScript strict + Prisma 6 + PostgreSQL 17**,
integrado ao WhatsApp pela **Evolution API** com padrão **outbox transacional**,
armazenamento **S3/MinIO**, transcrição **Whisper**, autenticação **Better Auth**
e arquitetura em camadas verificada automaticamente por **dependency-cruiser**.

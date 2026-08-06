# Fase 1 — Fundação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estabelecer a base do monólito modular da AllSet — projeto Next.js
rodável, PostgreSQL com Prisma e migrations, autenticação de administrador,
auditoria, entidades principais do domínio, a máquina de estados do pedido
(`Booking`), providers mock (pagamento/storage/erro) e guardrails de CI —
sem nenhuma linha de integração com WhatsApp/Evolution ainda.

**Architecture:** Monólito modular em camadas (`domain` → `application` →
`infrastructure`/`presentation`), com Next.js App Router hospedando tanto a
API (Route Handlers) quanto o dashboard admin. `domain` é puro TypeScript
sem dependência de Prisma/Next.js. `infrastructure` implementa as
interfaces (`ports`) que `domain`/`application` definem. dependency-cruiser
aplica essas fronteiras no CI.

**Tech Stack:** Node 24 (LTS), pnpm, TypeScript `strict`, Next.js 16 (App
Router), PostgreSQL, Prisma ORM, Zod, Better Auth (+ adapter Prisma),
Tailwind CSS, Vitest, Testcontainers, Playwright, dependency-cruiser, Knip,
Pino.

## Global Constraints

- Node fixado em `24.x` via `.nvmrc` e campo `engines` no `package.json`.
- pnpm é o único package manager; lockfile (`pnpm-lock.yaml`) versionado e
  instalado com `--frozen-lockfile` no CI.
- TypeScript em modo `strict`; nenhum `any` sem comentário `// justificado:
  <motivo>` acima da linha.
- Valores monetários: sempre inteiros em centavos (`Money`), nunca `number`
  fracionário nem `float` no schema do banco.
- Datas persistidas em UTC; conversão de fuso só na apresentação.
- `domain/` nunca importa `next`, `@prisma/client`, `better-auth` ou
  qualquer pacote de `infrastructure/`. Verificado por dependency-cruiser
  no CI (Task 9).
- Nenhuma regra de negócio em Route Handlers, Server Actions ou páginas —
  essas camadas só chamam casos de uso de `application/`.
- Toda mudança de status de `Booking` passa pelo serviço de transição de
  `application/booking/` — nenhum código escreve `status` diretamente via
  Prisma fora desse serviço.
- Segredos apenas em variáveis de ambiente, validadas por Zod em
  `src/env.ts`; nunca hardcoded, nunca logados.
- Cada tarefa termina com working tree limpa e um commit isolado.
- Este plano cobre só a Fase 1. Não implementar mensageria, pagamento real,
  Evolution API, distribuição de profissionais ou dashboard além do shell
  de login — isso é escopo das Fases 2–8 (`docs/product/allset-mvp-roadmap.md`).

---

## File Structure

```
allset/
├── .nvmrc
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── .prettierrc.json
├── vitest.config.ts
├── playwright.config.ts
├── .dependency-cruiser.cjs
├── knip.json
├── docker-compose.yml
├── Dockerfile
├── .github/workflows/ci.yml
├── prisma/
│   └── schema.prisma
├── src/
│   ├── env.ts
│   ├── domain/
│   │   ├── shared/
│   │   │   ├── money.ts
│   │   │   ├── money.test.ts
│   │   │   ├── result.ts
│   │   │   └── domain-error.ts
│   │   ├── booking/
│   │   │   ├── booking-status.ts
│   │   │   ├── booking-state-machine.ts
│   │   │   └── booking-state-machine.test.ts
│   │   └── ports/
│   │       ├── payment-provider.ts
│   │       ├── storage-provider.ts
│   │       └── error-reporter.ts
│   ├── application/
│   │   ├── booking/
│   │   │   ├── transition-booking-status.usecase.ts
│   │   │   └── transition-booking-status.usecase.integration.test.ts
│   │   └── audit/
│   │       └── record-audit-log.usecase.ts
│   ├── infrastructure/
│   │   ├── db/
│   │   │   └── prisma-client.ts
│   │   ├── payment/
│   │   │   ├── mock-payment-provider.ts
│   │   │   └── mock-payment-provider.test.ts
│   │   ├── storage/
│   │   │   ├── local-storage-provider.ts
│   │   │   ├── in-memory-storage-provider.ts
│   │   │   └── local-storage-provider.test.ts
│   │   ├── observability/
│   │   │   ├── logger.ts
│   │   │   └── console-error-reporter.ts
│   │   └── auth/
│   │       └── auth.ts
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── login/page.tsx
│       ├── admin/
│       │   ├── layout.tsx
│       │   └── page.tsx
│       └── api/auth/[...all]/route.ts
├── tests/
│   ├── integration/
│   │   └── test-db.ts
│   └── e2e/
│       └── admin-login.spec.ts
└── docs/
    └── adr/
        └── 0001-arquitetura-monolito-modular.md
```

---

### Task 1: Scaffolding do projeto (Next.js + TypeScript strict + pnpm)

**Files:**
- Create: `.nvmrc`, `package.json`, `tsconfig.json`, `next.config.ts`,
  `eslint.config.mjs`, `.prettierrc.json`, `tailwind.config.ts`,
  `postcss.config.mjs`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `docs/adr/0001-arquitetura-monolito-modular.md`

**Interfaces:**
- Produces: comandos `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`
  usados por todas as tarefas seguintes.

- [ ] **Step 1: Criar `.nvmrc` e `package.json` base**

`.nvmrc`:
```
24
```

`package.json`:
```json
{
  "name": "allset",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --exclude '**/*.integration.test.ts'",
    "test:watch": "vitest",
    "test:integration": "vitest run --testTimeout=60000 -t . --dir src --config vitest.config.ts",
    "test:e2e": "playwright test",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "architecture:check": "dependency-cruiser --config .dependency-cruiser.cjs src",
    "dead-code:check": "knip",
    "ci:check": "pnpm lint && pnpm typecheck && pnpm architecture:check && pnpm dead-code:check && pnpm test && pnpm build"
  }
}
```

- [ ] **Step 2: Instalar dependências reais via pnpm (lockfile como fonte de verdade)**

Rodar (não escrever versões chutadas manualmente no `package.json`):
```bash
corepack enable
pnpm add next react react-dom
pnpm add -D typescript @types/node @types/react @types/react-dom \
  eslint eslint-config-next @eslint/eslintrc prettier \
  tailwindcss postcss autoprefixer \
  vitest @vitest/ui
```
Confirmar que `pnpm-lock.yaml` foi criado e commitá-lo.

- [ ] **Step 3: Configurar `tsconfig.json` em modo strict**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Criar app mínimo**

`src/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "AllSet" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function HomePage() {
  return <main>AllSet</main>;
}
```

Criar `src/app/globals.css` com as diretivas padrão do Tailwind
(`@tailwind base; @tailwind components; @tailwind utilities;`).

- [ ] **Step 5: Registrar ADR 0001**

`docs/adr/0001-arquitetura-monolito-modular.md` documentando: monólito
modular em camadas, mensageria agnóstica de provider (WhatsApp via
Evolution é só o primeiro adapter), outbox + pg-boss para assíncrono,
lista de TBDs (pagamento real, comissão, política de cancelamento etc.)
copiada de `docs/product/allset-mvp-roadmap.md`.

- [ ] **Step 6: Verificar que o app builda e roda**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: os três comandos terminam com código de saída 0, sem erros.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(fundacao): scaffolding Next.js + TypeScript strict"
```

---

### Task 2: Ambiente local — Docker Compose + validação de env com Zod

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `src/env.ts`,
  `src/env.test.ts`

**Interfaces:**
- Produces: `import { env } from "@/env"` — objeto tipado e validado,
  usado por toda `infrastructure/` a partir daqui. Lança erro na
  inicialização se uma variável obrigatória faltar ou tiver formato
  inválido.

- [ ] **Step 1: `docker-compose.yml` com Postgres local**

```yaml
services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: allset
      POSTGRES_PASSWORD: allset
      POSTGRES_DB: allset
    ports:
      - "5432:5432"
    volumes:
      - allset_db_data:/var/lib/postgresql/data
volumes:
  allset_db_data:
```

- [ ] **Step 2: `.env.example`**

```
DATABASE_URL="postgresql://allset:allset@localhost:5432/allset"
BETTER_AUTH_SECRET="replace-with-32+-char-random-secret"
BETTER_AUTH_URL="http://localhost:3000"
NODE_ENV="development"
```

- [ ] **Step 3: Escrever o teste do schema de env primeiro**

`src/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

describe("parseEnv", () => {
  it("aceita um conjunto válido de variáveis", () => {
    const result = parseEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      NODE_ENV: "test",
    });
    expect(result.DATABASE_URL).toContain("postgresql://");
  });

  it("rejeita quando DATABASE_URL está ausente", () => {
    expect(() =>
      parseEnv({
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejeita BETTER_AUTH_SECRET curto demais", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        BETTER_AUTH_SECRET: "curto",
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm vitest run src/env.test.ts`
Expected: FAIL — `parseEnv` não existe ainda.

- [ ] **Step 3: Implementar `src/env.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Variáveis de ambiente inválidas: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm add zod && pnpm vitest run src/env.test.ts`
Expected: 3 testes passando.

- [ ] **Step 5: Subir o banco local e confirmar conexão**

Run:
```bash
cp .env.example .env
docker compose up -d db
docker compose ps
```
Expected: container `db` com status `healthy`/`running`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(fundacao): docker compose local e validacao de env com zod"
```

---

### Task 3: Prisma + schema inicial + harness de Testcontainers

**Files:**
- Create: `prisma/schema.prisma`, `src/infrastructure/db/prisma-client.ts`,
  `tests/integration/test-db.ts`,
  `src/infrastructure/db/prisma-client.integration.test.ts`

**Interfaces:**
- Produces: `import { prisma } from "@/infrastructure/db/prisma-client"` —
  singleton do Prisma Client usado por toda `infrastructure/`.
- Produces: `import { startTestDatabase } from "../../tests/integration/test-db"`
  — sobe um Postgres efêmero via Testcontainers, roda `prisma migrate deploy`
  e devolve uma `DATABASE_URL` isolada para o teste.

- [ ] **Step 1: Schema Prisma com as entidades principais da Fase 1**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  ADMIN
  CUSTOMER
  PROFESSIONAL
}

model User {
  id                String             @id @default(uuid())
  role              UserRole
  fullName          String
  phoneE164         String             @unique
  email             String?            @unique
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  customerProfile   CustomerProfile?
  professionalProfile ProfessionalProfile?
  adminProfile      AdminProfile?

  @@index([role])
}

model CustomerProfile {
  id        String   @id @default(uuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  blockedAt DateTime?
  createdAt DateTime @default(now())
}

model ProfessionalProfile {
  id             String   @id @default(uuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id])
  reviewStatus   String   @default("PENDING_REVIEW")
  pixKey         String?
  createdAt      DateTime @default(now())
}

model AdminProfile {
  id        String   @id @default(uuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
}

model Address {
  id           String  @id @default(uuid())
  neighborhood String
  street       String
  number       String
  complement   String?
  city         String  @default("Fortaleza")
  state        String  @default("CE")
  postalCode   String?

  @@index([neighborhood])
}

model ServiceArea {
  id           String   @id @default(uuid())
  neighborhood String   @unique
  isActive     Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model ServiceDefinition {
  id          String   @id @default(uuid())
  code        String   @unique
  name        String
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
}

enum BookingStatus {
  DRAFT
  COLLECTING_DATA
  REVIEW_REQUIRED
  AWAITING_CUSTOMER_CONFIRMATION
  AWAITING_PAYMENT
  PAYMENT_FAILED
  PAID
  MATCHING
  PROFESSIONAL_ASSIGNED
  SCHEDULED
  PROFESSIONAL_CONFIRMED
  PROFESSIONAL_EN_ROUTE
  IN_PROGRESS
  AWAITING_COMPLETION_CONFIRMATION
  COMPLETED
  ISSUE_OPEN
  CANCELLED
  REFUND_PENDING
  REFUNDED
}

model Booking {
  id          String        @id @default(uuid())
  status      BookingStatus @default(DRAFT)
  version     Int           @default(0)
  customerId  String
  serviceId   String
  totalCents  Int           @default(0)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  history     BookingStatusHistory[]

  @@index([status])
  @@index([customerId])
}

model BookingStatusHistory {
  id          String   @id @default(uuid())
  bookingId   String
  booking     Booking  @relation(fields: [bookingId], references: [id])
  fromStatus  BookingStatus?
  toStatus    BookingStatus
  actor       String
  reason      String?
  createdAt   DateTime @default(now())

  @@index([bookingId])
}

model AuditLog {
  id         String   @id @default(uuid())
  actor      String
  action     String
  entityType String
  entityId   String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
}

model ExternalReference {
  id           String   @id @default(uuid())
  provider     String
  resourceType String
  internalId   String
  externalId   String
  metadata     Json?
  createdAt    DateTime @default(now())

  @@unique([provider, resourceType, externalId])
  @@index([internalId])
}

model FeatureFlag {
  key       String   @id
  enabled   Boolean  @default(false)
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Instalar Prisma e gerar client**

Run:
```bash
pnpm add @prisma/client
pnpm add -D prisma
pnpm prisma:generate
```

- [ ] **Step 3: Criar a migration inicial**

Run: `pnpm exec prisma migrate dev --name init`
Expected: `prisma/migrations/<timestamp>_init/migration.sql` criado; migration
aplica sem erro no Postgres local (Task 2).

- [ ] **Step 4: Singleton do Prisma Client**

`src/infrastructure/db/prisma-client.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 5: Harness de Testcontainers para testes de integração**

Run: `pnpm add -D @testcontainers/postgresql`

`tests/integration/test-db.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export async function startTestDatabase(): Promise<{
  container: StartedPostgreSqlContainer;
  prisma: PrismaClient;
  stop: () => Promise<void>;
}> {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = container.getConnectionUri();

  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  return {
    container,
    prisma,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
```

- [ ] **Step 6: Escrever o teste de integração que prova o harness**

`src/infrastructure/db/prisma-client.integration.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import type { PrismaClient } from "@prisma/client";

describe("prisma migrations", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => {
    await stop();
  });

  it("cria e lê um User depois de aplicar as migrations", async () => {
    const user = await prisma.user.create({
      data: { role: "ADMIN", fullName: "Admin Teste", phoneE164: "+5585999990000" },
    });
    const found = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(found.role).toBe("ADMIN");
  });
});
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `pnpm test:integration -- src/infrastructure/db/prisma-client.integration.test.ts`
Expected: PASS (requer Docker rodando localmente para o Testcontainers).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(fundacao): schema prisma inicial e harness de testcontainers"
```

---

### Task 4: Shared kernel do domínio — `Money` e `Result`

**Files:**
- Create: `src/domain/shared/money.ts`, `src/domain/shared/money.test.ts`
- Create: `src/domain/shared/result.ts`
- Create: `src/domain/shared/domain-error.ts`

**Interfaces:**
- Produces: `Money.fromCents(n)`, `money.add(other)`, `money.formatBRL()` —
  usado por `Booking` (Task 5/6) e por toda regra de preço futura (Fase 4).
- Produces: `Result<T, E>` (`ok`/`err`) — usado pela máquina de estados
  (Task 5) para retornar falhas de transição sem lançar exceção.

- [ ] **Step 1: Escrever os testes de `Money` primeiro**

`src/domain/shared/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  it("armazena valores em centavos inteiros", () => {
    expect(Money.fromCents(14_500).cents).toBe(14_500);
  });

  it("rejeita valores fracionários", () => {
    expect(() => Money.fromCents(14_500.5)).toThrow(/inteiro/);
  });

  it("rejeita valores negativos", () => {
    expect(() => Money.fromCents(-100)).toThrow(/negativo/);
  });

  it("soma dois valores", () => {
    const total = Money.fromCents(10_000).add(Money.fromCents(4_500));
    expect(total.cents).toBe(14_500);
  });

  it("formata em BRL", () => {
    expect(Money.fromCents(14_500).formatBRL()).toBe("R$ 145,00");
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm vitest run src/domain/shared/money.test.ts`
Expected: FAIL — módulo `./money` não existe.

- [ ] **Step 3: Implementar `Money`**

`src/domain/shared/money.ts`:
```ts
export class Money {
  private constructor(public readonly cents: number) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new Error("Money deve ser um valor inteiro de centavos");
    }
    if (cents < 0) {
      throw new Error("Money não pode ser negativo");
    }
    return new Money(cents);
  }

  add(other: Money): Money {
    return Money.fromCents(this.cents + other.cents);
  }

  formatBRL(): string {
    return (this.cents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm vitest run src/domain/shared/money.test.ts`
Expected: 5 testes passando.

- [ ] **Step 5: Criar `Result` e `DomainError` (sem teste dedicado — tipos puros exercitados pelos consumidores na Task 5)**

`src/domain/shared/result.ts`:
```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

`src/domain/shared/domain-error.ts`:
```ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(fundacao): shared kernel do dominio (Money, Result, DomainError)"
```

---

### Task 5: Máquina de estados do pedido (`Booking`)

**Files:**
- Create: `src/domain/booking/booking-status.ts`
- Create: `src/domain/booking/booking-state-machine.ts`
- Create: `src/domain/booking/booking-state-machine.test.ts`

**Interfaces:**
- Consumes: `Result`, `ok`, `err` de `@/domain/shared/result`; `DomainError`
  de `@/domain/shared/domain-error`.
- Produces: `BookingStatus` (union type), `transitionBookingStatus(current,
  target): Result<BookingStatus, DomainError>` — usado pelo caso de uso da
  Task 6 e por todo caso de uso futuro que mude status de `Booking`.

- [ ] **Step 1: Enum de status como union type**

`src/domain/booking/booking-status.ts`:
```ts
export const BOOKING_STATUSES = [
  "DRAFT",
  "COLLECTING_DATA",
  "REVIEW_REQUIRED",
  "AWAITING_CUSTOMER_CONFIRMATION",
  "AWAITING_PAYMENT",
  "PAYMENT_FAILED",
  "PAID",
  "MATCHING",
  "PROFESSIONAL_ASSIGNED",
  "SCHEDULED",
  "PROFESSIONAL_CONFIRMED",
  "PROFESSIONAL_EN_ROUTE",
  "IN_PROGRESS",
  "AWAITING_COMPLETION_CONFIRMATION",
  "COMPLETED",
  "ISSUE_OPEN",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];
```

- [ ] **Step 2: Escrever os testes da máquina de estados primeiro**

`src/domain/booking/booking-state-machine.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { transitionBookingStatus, ALLOWED_TRANSITIONS } from "./booking-state-machine";
import { BOOKING_STATUSES, type BookingStatus } from "./booking-status";

describe("transitionBookingStatus", () => {
  it("permite todas as transições declaradas no mapa", () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS) as [
      BookingStatus,
      BookingStatus[],
    ][]) {
      for (const to of targets) {
        const result = transitionBookingStatus(from, to);
        expect(result.ok, `${from} -> ${to} deveria ser permitido`).toBe(true);
      }
    }
  });

  it("rejeita uma transição não declarada (DRAFT -> COMPLETED)", () => {
    const result = transitionBookingStatus("DRAFT", "COMPLETED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BOOKING_TRANSITION");
    }
  });

  it("rejeita transição a partir de um estado terminal (COMPLETED -> IN_PROGRESS)", () => {
    const result = transitionBookingStatus("COMPLETED", "IN_PROGRESS");
    expect(result.ok).toBe(false);
  });

  it("todo status listado em BOOKING_STATUSES aparece no mapa de transições (nem que seja como terminal, com lista vazia)", () => {
    for (const status of BOOKING_STATUSES) {
      expect(Object.hasOwn(ALLOWED_TRANSITIONS, status)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm vitest run src/domain/booking/booking-state-machine.test.ts`
Expected: FAIL — módulo `./booking-state-machine` não existe.

- [ ] **Step 4: Implementar o mapa de transições e a função pura**

`src/domain/booking/booking-state-machine.ts`:
```ts
import { err, ok, type Result } from "../shared/result";
import { DomainError } from "../shared/domain-error";
import type { BookingStatus } from "./booking-status";

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT: ["COLLECTING_DATA", "CANCELLED"],
  COLLECTING_DATA: ["REVIEW_REQUIRED", "AWAITING_CUSTOMER_CONFIRMATION", "CANCELLED"],
  REVIEW_REQUIRED: ["AWAITING_CUSTOMER_CONFIRMATION", "CANCELLED"],
  AWAITING_CUSTOMER_CONFIRMATION: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["AWAITING_PAYMENT", "CANCELLED"],
  PAID: ["MATCHING", "REFUND_PENDING"],
  MATCHING: ["PROFESSIONAL_ASSIGNED", "ISSUE_OPEN", "CANCELLED"],
  PROFESSIONAL_ASSIGNED: ["SCHEDULED", "MATCHING", "CANCELLED"],
  SCHEDULED: ["PROFESSIONAL_CONFIRMED", "ISSUE_OPEN", "CANCELLED"],
  PROFESSIONAL_CONFIRMED: ["PROFESSIONAL_EN_ROUTE", "ISSUE_OPEN", "CANCELLED"],
  PROFESSIONAL_EN_ROUTE: ["IN_PROGRESS", "ISSUE_OPEN"],
  IN_PROGRESS: ["AWAITING_COMPLETION_CONFIRMATION", "ISSUE_OPEN"],
  AWAITING_COMPLETION_CONFIRMATION: ["COMPLETED", "ISSUE_OPEN"],
  COMPLETED: [],
  ISSUE_OPEN: ["CANCELLED", "SCHEDULED", "REFUND_PENDING", "COMPLETED"],
  CANCELLED: [],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
};

export function transitionBookingStatus(
  current: BookingStatus,
  target: BookingStatus,
): Result<BookingStatus, DomainError> {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    return err(
      new DomainError(
        `Transição inválida de ${current} para ${target}`,
        "INVALID_BOOKING_TRANSITION",
      ),
    );
  }
  return ok(target);
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm vitest run src/domain/booking/booking-state-machine.test.ts`
Expected: 4 testes passando (o primeiro teste exercita todas as
transições válidas do mapa).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(fundacao): maquina de estados do pedido (booking state machine)"
```

---

### Task 6: Caso de uso de transição de `Booking` com histórico, auditoria e concorrência

**Files:**
- Create: `src/application/booking/transition-booking-status.usecase.ts`
- Create: `src/application/booking/transition-booking-status.usecase.integration.test.ts`
- Create: `src/application/audit/record-audit-log.usecase.ts`

**Interfaces:**
- Consumes: `transitionBookingStatus` de `@/domain/booking/booking-state-machine`;
  `prisma` de `@/infrastructure/db/prisma-client`; `startTestDatabase` de
  `tests/integration/test-db`.
- Produces: `transitionBookingStatusUseCase(input: { bookingId: string;
  targetStatus: BookingStatus; actor: string; reason?: string }): Promise<Result<Booking, DomainError>>`
  — único ponto do sistema autorizado a escrever `Booking.status`. Casos de
  uso das fases seguintes (pagamento, matching, execução) chamam esta
  função em vez de escrever no Prisma diretamente.

- [ ] **Step 1: Escrever o teste de integração primeiro (caminho feliz + concorrência)**

`src/application/booking/transition-booking-status.usecase.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { transitionBookingStatusUseCase } from "./transition-booking-status.usecase";
import type { PrismaClient } from "@prisma/client";

describe("transitionBookingStatusUseCase", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedBooking() {
    const user = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente Teste", phoneE164: `+5585${Date.now()}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `limpeza-${Date.now()}`, name: "Limpeza comum" },
    });
    return prisma.booking.create({
      data: { customerId: user.id, serviceId: service.id, status: "DRAFT" },
    });
  }

  it("transiciona o status, grava histórico e audit log", async () => {
    const booking = await seedBooking();

    const result = await transitionBookingStatusUseCase(prisma, {
      bookingId: booking.id,
      targetStatus: "COLLECTING_DATA",
      actor: "system:test",
    });

    expect(result.ok).toBe(true);
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("COLLECTING_DATA");

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: "DRAFT", toStatus: "COLLECTING_DATA" });

    const audit = await prisma.auditLog.findMany({ where: { entityId: booking.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "BOOKING_STATUS_TRANSITION" });
  });

  it("rejeita transição inválida sem escrever nada", async () => {
    const booking = await seedBooking();

    const result = await transitionBookingStatusUseCase(prisma, {
      bookingId: booking.id,
      targetStatus: "COMPLETED",
      actor: "system:test",
    });

    expect(result.ok).toBe(false);
    const unchanged = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(unchanged.status).toBe("DRAFT");
    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(0);
  });

  it("sob concorrência, apenas uma de duas transições simultâneas para o mesmo destino vence", async () => {
    const booking = await seedBooking();
    await transitionBookingStatusUseCase(prisma, {
      bookingId: booking.id,
      targetStatus: "COLLECTING_DATA",
      actor: "system:test",
    });

    const [first, second] = await Promise.all([
      transitionBookingStatusUseCase(prisma, {
        bookingId: booking.id,
        targetStatus: "REVIEW_REQUIRED",
        actor: "system:A",
      }),
      transitionBookingStatusUseCase(prisma, {
        bookingId: booking.id,
        targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
        actor: "system:B",
      }),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(2); // DRAFT->COLLECTING_DATA + a única transição concorrente que venceu
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm test:integration -- src/application/booking/transition-booking-status.usecase.integration.test.ts`
Expected: FAIL — módulo `./transition-booking-status.usecase` não existe.

- [ ] **Step 3: Implementar `record-audit-log.usecase.ts`**

`src/application/audit/record-audit-log.usecase.ts`:
```ts
import type { Prisma, PrismaClient } from "@prisma/client";

export interface RecordAuditLogInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function recordAuditLog(
  tx: Prisma.TransactionClient | PrismaClient,
  input: RecordAuditLogInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
```

- [ ] **Step 4: Implementar o caso de uso de transição com lock otimista**

`src/application/booking/transition-booking-status.usecase.ts`:
```ts
import type { Booking, Prisma, PrismaClient } from "@prisma/client";
import { transitionBookingStatus } from "../../domain/booking/booking-state-machine";
import type { BookingStatus } from "../../domain/booking/booking-status";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface TransitionBookingStatusInput {
  bookingId: string;
  targetStatus: BookingStatus;
  actor: string;
  reason?: string;
}

export async function transitionBookingStatusUseCase(
  prisma: PrismaClient,
  input: TransitionBookingStatusInput,
): Promise<Result<Booking, DomainError>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.booking.findUnique({ where: { id: input.bookingId } });
    if (!current) {
      return err(new DomainError(`Booking ${input.bookingId} não encontrado`, "BOOKING_NOT_FOUND"));
    }

    const transition = transitionBookingStatus(
      current.status as BookingStatus,
      input.targetStatus,
    );
    if (!transition.ok) {
      return err(transition.error);
    }

    // Lock otimista: só atualiza se o status ainda for o que lemos.
    // Sob concorrência, a segunda chamada atinge count === 0 e falha.
    const updateResult = await tx.booking.updateMany({
      where: { id: input.bookingId, status: current.status },
      data: { status: input.targetStatus, version: { increment: 1 } },
    });

    if (updateResult.count === 0) {
      return err(
        new DomainError(
          `Booking ${input.bookingId} foi alterado concorrentemente`,
          "BOOKING_CONCURRENT_MODIFICATION",
        ),
      );
    }

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: input.bookingId,
        fromStatus: current.status,
        toStatus: input.targetStatus,
        actor: input.actor,
        reason: input.reason,
      },
    });

    await recordAuditLog(tx, {
      actor: input.actor,
      action: "BOOKING_STATUS_TRANSITION",
      entityType: "Booking",
      entityId: input.bookingId,
      metadata: { from: current.status, to: input.targetStatus, reason: input.reason },
    });

    const updated = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    return ok(updated);
  });
}
```

**Nota de concorrência:** o teste de aceite simultâneo depende de as duas
chamadas caírem em transações Prisma concorrentes reais contra o Postgres
do Testcontainers — por isso este teste é de integração, não unitário
(mockar o Prisma esconderia exatamente o comportamento que estamos
validando).

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm test:integration -- src/application/booking/transition-booking-status.usecase.integration.test.ts`
Expected: 3 testes passando.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(fundacao): caso de uso de transicao de booking com historico, auditoria e lock otimista"
```

---

### Task 7: Ports genéricos — `PaymentProvider`, `StorageProvider`, `ErrorReporter`

**Files:**
- Create: `src/domain/ports/payment-provider.ts`
- Create: `src/domain/ports/storage-provider.ts`
- Create: `src/domain/ports/error-reporter.ts`
- Create: `src/infrastructure/payment/mock-payment-provider.ts`
- Create: `src/infrastructure/payment/mock-payment-provider.test.ts`
- Create: `src/infrastructure/storage/local-storage-provider.ts`
- Create: `src/infrastructure/storage/in-memory-storage-provider.ts`
- Create: `src/infrastructure/storage/local-storage-provider.test.ts`
- Create: `src/infrastructure/observability/console-error-reporter.ts`
- Create: `src/infrastructure/observability/logger.ts`

**Interfaces:**
- Consumes: `Money` de `@/domain/shared/money`.
- Produces: interfaces `PaymentProvider`, `StorageProvider`, `ErrorReporter`
  que a Fase 4 (pagamento) e a Fase 2 (mensageria, para anexos) vão
  implementar com providers reais sem tocar no domínio.

- [ ] **Step 1: Definir os contratos (ports)**

`src/domain/ports/payment-provider.ts`:
```ts
import type { Money } from "../shared/money";

export type ChargeStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUNDED";

export interface ChargeRequest {
  idempotencyKey: string;
  bookingId: string;
  amount: Money;
  description: string;
}

export interface ChargeResult {
  externalId: string;
  status: ChargeStatus;
}

export interface PaymentProvider {
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  getChargeStatus(externalId: string): Promise<ChargeStatus>;
  refund(externalId: string, amount: Money): Promise<void>;
}
```

`src/domain/ports/storage-provider.ts`:
```ts
export interface PutFileInput {
  key: string;
  contentType: string;
  data: Uint8Array;
  ownerId: string;
}

export interface StoredFile {
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface SignedUrlInput {
  key: string;
  expiresInSeconds: number;
}

export interface DeleteFileInput {
  key: string;
}

export interface StorageProvider {
  put(input: PutFileInput): Promise<StoredFile>;
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  delete(input: DeleteFileInput): Promise<void>;
}
```

`src/domain/ports/error-reporter.ts`:
```ts
export interface ErrorReporter {
  report(error: unknown, context?: Record<string, unknown>): void;
}
```

- [ ] **Step 2: Escrever o teste do `MockPaymentProvider` primeiro**

`src/infrastructure/payment/mock-payment-provider.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MockPaymentProvider } from "./mock-payment-provider";
import { Money } from "../../domain/shared/money";

describe("MockPaymentProvider", () => {
  it("cria uma cobrança PENDING e a mesma idempotencyKey retorna a mesma cobrança", async () => {
    const provider = new MockPaymentProvider();
    const request = {
      idempotencyKey: "booking:1:charge:v1",
      bookingId: "1",
      amount: Money.fromCents(14_500),
      description: "Limpeza comum",
    };

    const first = await provider.createCharge(request);
    const second = await provider.createCharge(request);

    expect(first.status).toBe("PENDING");
    expect(second.externalId).toBe(first.externalId);
  });

  it("confirmPayment (helper de teste) move o status para PAID", async () => {
    const provider = new MockPaymentProvider();
    const { externalId } = await provider.createCharge({
      idempotencyKey: "booking:2:charge:v1",
      bookingId: "2",
      amount: Money.fromCents(10_000),
      description: "Limpeza comum",
    });

    provider.simulateConfirmation(externalId);

    expect(await provider.getChargeStatus(externalId)).toBe("PAID");
  });

  it("refund muda o status para REFUNDED", async () => {
    const provider = new MockPaymentProvider();
    const { externalId } = await provider.createCharge({
      idempotencyKey: "booking:3:charge:v1",
      bookingId: "3",
      amount: Money.fromCents(10_000),
      description: "Limpeza comum",
    });
    provider.simulateConfirmation(externalId);

    await provider.refund(externalId, Money.fromCents(10_000));

    expect(await provider.getChargeStatus(externalId)).toBe("REFUNDED");
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm vitest run src/infrastructure/payment/mock-payment-provider.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar `MockPaymentProvider`**

`src/infrastructure/payment/mock-payment-provider.ts`:
```ts
import { randomUUID } from "node:crypto";
import type {
  ChargeRequest,
  ChargeResult,
  ChargeStatus,
  PaymentProvider,
} from "../../domain/ports/payment-provider";
import type { Money } from "../../domain/shared/money";

interface StoredCharge {
  externalId: string;
  status: ChargeStatus;
}

export class MockPaymentProvider implements PaymentProvider {
  private readonly byIdempotencyKey = new Map<string, StoredCharge>();
  private readonly byExternalId = new Map<string, StoredCharge>();

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }
    const charge: StoredCharge = { externalId: randomUUID(), status: "PENDING" };
    this.byIdempotencyKey.set(request.idempotencyKey, charge);
    this.byExternalId.set(charge.externalId, charge);
    return charge;
  }

  async getChargeStatus(externalId: string): Promise<ChargeStatus> {
    const charge = this.byExternalId.get(externalId);
    if (!charge) {
      throw new Error(`Cobrança ${externalId} não encontrada no MockPaymentProvider`);
    }
    return charge.status;
  }

  async refund(externalId: string, _amount: Money): Promise<void> {
    const charge = this.byExternalId.get(externalId);
    if (!charge) {
      throw new Error(`Cobrança ${externalId} não encontrada no MockPaymentProvider`);
    }
    charge.status = "REFUNDED";
  }

  /** Helper exclusivo de teste/homologação: simula o webhook de confirmação. */
  simulateConfirmation(externalId: string): void {
    const charge = this.byExternalId.get(externalId);
    if (!charge) {
      throw new Error(`Cobrança ${externalId} não encontrada no MockPaymentProvider`);
    }
    charge.status = "PAID";
  }
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm vitest run src/infrastructure/payment/mock-payment-provider.test.ts`
Expected: 3 testes passando.

- [ ] **Step 6: Escrever o teste do `LocalStorageProvider` primeiro**

`src/infrastructure/storage/local-storage-provider.test.ts`:
```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local-storage-provider";

describe("LocalStorageProvider", () => {
  let baseDir: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "allset-storage-"));
    provider = new LocalStorageProvider(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("grava um arquivo e devolve metadados", async () => {
    const stored = await provider.put({
      key: "docs/rg.png",
      contentType: "image/png",
      data: new Uint8Array([1, 2, 3]),
      ownerId: "professional-1",
    });

    expect(stored.sizeBytes).toBe(3);
    const raw = await readFile(join(baseDir, "docs/rg.png"));
    expect([...raw]).toEqual([1, 2, 3]);
  });

  it("getSignedUrl devolve uma URL local com expiração embutida", async () => {
    await provider.put({
      key: "docs/rg.png",
      contentType: "image/png",
      data: new Uint8Array([1]),
      ownerId: "professional-1",
    });

    const url = await provider.getSignedUrl({ key: "docs/rg.png", expiresInSeconds: 60 });

    expect(url).toContain("docs/rg.png");
    expect(url).toContain("expires=");
  });

  it("delete remove o arquivo", async () => {
    await provider.put({
      key: "docs/rg.png",
      contentType: "image/png",
      data: new Uint8Array([1]),
      ownerId: "professional-1",
    });

    await provider.delete({ key: "docs/rg.png" });

    await expect(readFile(join(baseDir, "docs/rg.png"))).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Rodar e confirmar falha, depois implementar**

Run: `pnpm vitest run src/infrastructure/storage/local-storage-provider.test.ts`
Expected: FAIL.

`src/infrastructure/storage/local-storage-provider.ts`:
```ts
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DeleteFileInput,
  PutFileInput,
  SignedUrlInput,
  StorageProvider,
  StoredFile,
} from "../../domain/ports/storage-provider";

/** Provider para desenvolvimento local. Produção usa um provider S3-compatível (Fase 8, TBD). */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly baseDir: string) {}

  async put(input: PutFileInput): Promise<StoredFile> {
    const filePath = join(this.baseDir, input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.data);
    const info = await stat(filePath);
    return { key: input.key, sizeBytes: info.size, contentType: input.contentType };
  }

  async getSignedUrl(input: SignedUrlInput): Promise<string> {
    const expires = Date.now() + input.expiresInSeconds * 1000;
    return `local-storage://${input.key}?expires=${expires}`;
  }

  async delete(input: DeleteFileInput): Promise<void> {
    await rm(join(this.baseDir, input.key), { force: true });
  }
}
```

`src/infrastructure/storage/in-memory-storage-provider.ts`:
```ts
import type {
  DeleteFileInput,
  PutFileInput,
  SignedUrlInput,
  StorageProvider,
  StoredFile,
} from "../../domain/ports/storage-provider";

/** Provider para testes unitários rápidos que não precisam tocar o disco. */
export class InMemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, PutFileInput>();

  async put(input: PutFileInput): Promise<StoredFile> {
    this.files.set(input.key, input);
    return { key: input.key, sizeBytes: input.data.byteLength, contentType: input.contentType };
  }

  async getSignedUrl(input: SignedUrlInput): Promise<string> {
    return `memory-storage://${input.key}?expires=${Date.now() + input.expiresInSeconds * 1000}`;
  }

  async delete(input: DeleteFileInput): Promise<void> {
    this.files.delete(input.key);
  }
}
```

- [ ] **Step 8: Rodar e confirmar sucesso**

Run: `pnpm vitest run src/infrastructure/storage/local-storage-provider.test.ts`
Expected: 3 testes passando.

- [ ] **Step 9: `ErrorReporter` e `logger` (sem teste dedicado — wrappers finos verificados por uso nas Tasks 8/10)**

Run: `pnpm add pino`

`src/infrastructure/observability/logger.ts`:
```ts
import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  redact: ["*.password", "*.secret", "*.token", "*.pixKey"],
});
```

`src/infrastructure/observability/console-error-reporter.ts`:
```ts
import type { ErrorReporter } from "../../domain/ports/error-reporter";
import { logger } from "./logger";

export class ConsoleErrorReporter implements ErrorReporter {
  report(error: unknown, context?: Record<string, unknown>): void {
    logger.error({ err: error, ...context }, "Erro reportado");
  }
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(fundacao): ports genericos (payment, storage, error reporter) e mocks"
```

---

### Task 8: Autenticação de administrador com Better Auth

**Files:**
- Modify: `prisma/schema.prisma` (adicionar modelos do Better Auth)
- Create: `src/infrastructure/auth/auth.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/infrastructure/auth/auth.integration.test.ts`

**Interfaces:**
- Produces: `import { auth } from "@/infrastructure/auth/auth"` — instância
  do Better Auth usada pelo Route Handler e pelo layout protegido da
  Task 10.

- [ ] **Step 1: Instalar Better Auth e adapter Prisma**

Run: `pnpm add better-auth @better-auth/prisma-adapter`

- [ ] **Step 2: Gerar e aplicar o schema de auth do Better Auth**

Run (gera os modelos `User`/`Session`/`Account`/`Verification` exigidos
pelo Better Auth num arquivo separado, para não colidir com o `User` de
domínio já criado na Task 3 — o Better Auth usa seu próprio modelo de
autenticação, referenciado pelo domínio via `authUserId`):

Adicionar em `prisma/schema.prisma`:
```prisma
model AuthUser {
  id            String    @id @default(uuid())
  email         String    @unique
  emailVerified Boolean   @default(false)
  passwordHash  String?
  name          String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      AuthSession[]
  accounts      AuthAccount[]
}

model AuthSession {
  id        String   @id @default(uuid())
  userId    String
  user      AuthUser @relation(fields: [userId], references: [id])
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
}

model AuthAccount {
  id                String   @id @default(uuid())
  userId            String
  user              AuthUser @relation(fields: [userId], references: [id])
  providerId        String
  accountId         String
  passwordHash      String?
  createdAt         DateTime @default(now())

  @@unique([providerId, accountId])
}

model AuthVerification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
}
```

Run: `pnpm exec prisma migrate dev --name add_better_auth`

- [ ] **Step 3: Configurar Better Auth (só e-mail/senha, papel ADMIN)**

`src/infrastructure/auth/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "../db/prisma-client";
import { env } from "../../env";
import { logger } from "../observability/logger";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 5,
  },
  hooks: {
    after: [
      {
        matcher: (ctx) => ctx.path === "/sign-in/email",
        handler: async (ctx) => {
          logger.info({ email: ctx.body?.email, ok: ctx.context.returned?.status !== "error" }, "Tentativa de login admin");
          await prisma.auditLog.create({
            data: {
              actor: String(ctx.body?.email ?? "unknown"),
              action: "ADMIN_LOGIN_ATTEMPT",
              entityType: "AuthUser",
              entityId: String(ctx.body?.email ?? "unknown"),
              metadata: { success: ctx.context.returned?.status !== "error" },
            },
          });
        },
      },
    ],
  },
});
```

- [ ] **Step 4: Route Handler do Better Auth**

`src/app/api/auth/[...all]/route.ts`:
```ts
import { auth } from "@/infrastructure/auth/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 5: Página de login mínima**

`src/app/login/page.tsx` (Client Component simples com `authClient.signIn.email`,
formulário controlado, sem lógica de negócio — só chama o SDK do Better
Auth e redireciona para `/admin` em caso de sucesso).

- [ ] **Step 6: Escrever o teste de integração de autenticação**

`src/infrastructure/auth/auth.integration.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";

describe("Better Auth — login de admin", () => {
  let stop: () => Promise<void>;
  let databaseUrl: string;

  beforeAll(async () => {
    const db = await startTestDatabase();
    stop = db.stop;
    databaseUrl = db.container.getConnectionUri();
    process.env.DATABASE_URL = databaseUrl;
  }, 60_000);

  afterAll(async () => stop());

  it("cria conta, faz login com senha correta e rejeita senha errada", async () => {
    const { auth } = await import("./auth");

    const signUp = await auth.api.signUpEmail({
      body: { email: "admin@allset.test", password: "senha-super-segura-1", name: "Admin" },
    });
    expect(signUp.user.email).toBe("admin@allset.test");

    const signIn = await auth.api.signInEmail({
      body: { email: "admin@allset.test", password: "senha-super-segura-1" },
    });
    expect(signIn.user.email).toBe("admin@allset.test");

    await expect(
      auth.api.signInEmail({
        body: { email: "admin@allset.test", password: "senha-errada" },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `pnpm test:integration -- src/infrastructure/auth/auth.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(fundacao): autenticacao de administrador com better auth"
```

---

### Task 9: Guardrails de arquitetura e CI

**Files:**
- Create: `.dependency-cruiser.cjs`, `knip.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `pnpm architecture:check`, `pnpm dead-code:check`, `pnpm
  ci:check` — usados por todas as tarefas seguintes e por todas as fases
  futuras como gate de qualidade.

- [ ] **Step 1: Instalar ferramentas**

Run: `pnpm add -D dependency-cruiser knip`

- [ ] **Step 2: Regras de dependency-cruiser**

`.dependency-cruiser.cjs`:
```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-no-infra",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/infrastructure" },
    },
    {
      name: "domain-no-application",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/application" },
    },
    {
      name: "domain-no-nextjs",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/app" },
    },
    {
      name: "domain-no-frameworks",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "node_modules/(next|@prisma|better-auth|pino)" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "node_modules|\\.test\\.ts$|\\.integration\\.test\\.ts$" },
  },
};
```

- [ ] **Step 3: Verificar que a regra pega uma violação real (teste manual do guardrail)**

Run:
```bash
echo "import { prisma } from '../../infrastructure/db/prisma-client';" >> src/domain/shared/money.ts
pnpm architecture:check
```
Expected: falha reportando `domain-no-infra`.

Depois desfazer:
```bash
git checkout -- src/domain/shared/money.ts
```

- [ ] **Step 4: Rodar contra o código real e confirmar sucesso**

Run: `pnpm architecture:check`
Expected: 0 violações.

- [ ] **Step 5: Configurar Knip**

`knip.json`:
```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": ["src/app/**/{page,layout,route}.tsx", "src/app/**/{page,layout,route}.ts"],
  "project": ["src/**/*.ts", "src/**/*.tsx"],
  "ignore": ["**/*.test.ts", "**/*.integration.test.ts"]
}
```

Run: `pnpm dead-code:check`
Expected: 0 achados (ou achados documentados como exceção explícita no
`knip.json` com comentário do motivo).

- [ ] **Step 6: Pipeline de CI**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: allset
          POSTGRES_PASSWORD: allset
          POSTGRES_DB: allset
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U allset"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://allset:allset@localhost:5432/allset
      BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET_TEST || 'a-32-char-minimum-test-secret!!' }}
      BETTER_AUTH_URL: http://localhost:3000
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma:generate
      - run: pnpm exec prisma migrate deploy
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm architecture:check
      - run: pnpm dead-code:check
      - run: pnpm test
      - run: pnpm test:integration
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: ci-failure-logs
          path: |
            **/*.log
            playwright-report/
          retention-days: 7
```

Nota: o job não acessa Evolution real, WhatsApp real, conta bancária real
ou storage de produção — apenas o Postgres de serviço do próprio runner,
conforme exigido pelo briefing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(fundacao): guardrails de arquitetura (dependency-cruiser, knip) e pipeline de ci"
```

---

### Task 10: Shell do dashboard admin protegido + E2E de login

**Files:**
- Create: `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`
- Create: `playwright.config.ts`, `tests/e2e/admin-login.spec.ts`

**Interfaces:**
- Consumes: `auth` de `@/infrastructure/auth/auth` (Task 8).
- Produces: rota `/admin` protegida — base sobre a qual a Fase 3
  (dashboard) constrói as telas reais.

- [ ] **Step 1: Layout protegido**

`src/app/admin/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { auth } from "@/infrastructure/auth/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return (
    <div>
      <header>
        <span>AllSet Admin</span>
        <form action="/api/auth/sign-out" method="post">
          <button type="submit">Sair</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

`src/app/admin/page.tsx`:
```tsx
export default function AdminHomePage() {
  return <p>Bem-vindo ao painel AllSet. (Fase 3 preenche esta tela.)</p>;
}
```

- [ ] **Step 2: Instalar e configurar Playwright**

Run: `pnpm create playwright@latest --yes --quiet --browser=chromium`
(ajustar `playwright.config.ts` gerado para `baseURL:
"http://localhost:3000"`, `webServer` rodando `pnpm build && pnpm start`, e
`trace`/`screenshot`/`video` apenas `on-first-retry`).

- [ ] **Step 3: Escrever o teste E2E**

`tests/e2e/admin-login.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("admin faz login e acessa o dashboard, depois faz logout", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Bem-vindo ao painel AllSet")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("visitante sem sessão é redirecionado de /admin para /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});
```

Nota: o primeiro teste assume um usuário `admin@allset.test` seedado antes
da suíte (script `tests/e2e/seed.ts` chamado no `globalSetup` do Playwright,
usando `auth.api.signUpEmail` contra o banco local de desenvolvimento) —
implementar esse seed como parte deste step.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run:
```bash
docker compose up -d db
pnpm exec prisma migrate deploy
pnpm test:e2e
```
Expected: 2 testes passando.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(fundacao): shell do dashboard admin protegido e e2e de login"
```

---

## Riscos e limitações conhecidas desta fase

- **Testcontainers exige Docker rodando na máquina/CI** — sem isso, toda a
  suíte `test:integration` (Tasks 3, 6, 8) falha na inicialização, não no
  teste em si. Documentado no `README.md` a criar como pré-requisito.
- **Concorrência do `Booking`** é validada só no nível de update otimista
  (`updateMany` com filtro de status). Ainda não cobre corrida de duas
  *ofertas de profissional* diferentes (isso é `AssignmentOffer`, Fase 5) —
  aqui só garantimos que dois processos não conseguem mover o mesmo pedido
  para dois estados diferentes ao mesmo tempo.
- **Better Auth + Prisma**: o modelo de auth (`AuthUser`) é separado do
  modelo de domínio (`User`/`AdminProfile`) de propósito, para não acoplar
  sessão/senha a papéis de negócio. A Fase 3 precisa decidir e implementar
  como `AuthUser.email` se liga a `AdminProfile` (provavelmente por
  `email` único) — deixado como próximo passo, não decidido aqui.
- **CI sem secret real do Better Auth**: usa um valor de teste fixo via
  fallback do workflow; produção precisa de `BETTER_AUTH_SECRET_TEST` (ou
  equivalente) configurado nos secrets do repositório antes do primeiro
  deploy real — TBD de infraestrutura de produção, fora do escopo desta
  fase.

## Critérios de aceite da Fase 1 (verificação final)

- [ ] `pnpm ci:check` passa localmente (lint, typecheck, architecture,
  dead-code, unit, build).
- [ ] `pnpm test:integration` passa com Docker local rodando.
- [ ] `pnpm test:e2e` passa contra o build de produção local.
- [ ] Nenhum arquivo em `src/domain/` importa `next`, `@prisma/client`,
  `better-auth` ou `pino` (garantido por `pnpm architecture:check`).
- [ ] `Booking.status` só é escrito por
  `transitionBookingStatusUseCase` (verificação manual de grep +
  reforçado pela Task 9 como próxima extensão do dependency-cruiser
  quando outros casos de uso existirem).
- [ ] Login de admin funciona de ponta a ponta (Playwright).
- [ ] Working tree limpa, 10 commits isolados na branch
  `feature/fase1-fundacao`.

## Próximo passo

Após merge desta fase (via PR revisado, não merge direto), iniciar o plano
da Fase 2 (Mensageria genérica) em novo arquivo
`docs/superpowers/plans/<data>-fase2-mensageria.md`.

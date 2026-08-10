# ServiceOpportunityEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Booking enters MATCHING status, eligible professionals (ATIVA/PREFERENCIAL) receive a WhatsApp offer; the first to reply SIM gets the job; all others get a "filled" notification.

**Architecture:** New `src/domain/marketplace/` holds pure matching and message-formatting logic. New `src/application/marketplace/` holds three transactional use cases (notify, respond, expire) following the same outbox + optimistic-lock pattern already used by `ConversationEngine` and `reengageSilentConversations`. The Evolution webhook gains a priority-routing step that intercepts incoming messages from professionals with a pending `OpportunityResponse` before reaching the recruitment flow.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Prisma 6 + PostgreSQL, pnpm, Vitest + Testcontainers for integration tests. Commands: `pnpm test` (unit), `pnpm test:integration` (integration), `pnpm tsc --noEmit` (typecheck), `pnpm architecture:check` (dep-cruiser).

**Spec:** `docs/superpowers/specs/2026-08-07-service-opportunity-engine-design.md`

---

## Progresso

| Task | Status | Commit(s) | Observações |
|---|---|---|---|
| 1 — Schema + state machine | ✅ concluída | `40d8bd0` | Enums, ServiceOpportunity, OpportunityResponse, campos no Booking, relação no RecruitmentLead, migração `20260807194247_add_service_opportunity`, DRAFT→MATCHING e MATCHING→REVIEW_REQUIRED |
| 2 — opportunity-matching-policy | ✅ concluída | `d48d75b` | Pure domain function, 11 testes unitários, parse de dias em PT-BR com range ("segunda a sexta") |
| 3 — opportunity-message | ✅ concluída | `02bb1b3` | Pure domain function, Intl.DateTimeFormat America/Fortaleza, 4 testes unitários |
| 4 — OPPORTUNITY_EXPIRY_HOURS | ✅ concluída | `5aeb0fb` | `positiveIntegerEnv(4)` em env.ts + .env.example |
| 5 — notify-opportunity.usecase | ✅ concluída | `a54db25` + `ab88e68` | 2 testes Testcontainers; fix adicionou guard de state machine antes do updateMany |
| 6 — process-opportunity-response.usecase | ⏳ pendente | — | — |
| 7 — expire-opportunities.usecase | ⏳ pendente | — | — |
| 8 — Webhook routing priority | ⏳ pendente | — | — |
| 9 — POST /api/internal/marketplace/expire | ⏳ pendente | — | — |
| 10 — Admin UI bookings | ⏳ pendente | — | — |

**Retomar:** branch `funil-recrutamento-sub-spec-1`, próxima task é a **6**. Despachar subagent com o texto completo da Task 6 do plano abaixo.

---

## File map

| Action | File |
|---|---|
| MODIFY | `prisma/schema.prisma` |
| NEW migration | `prisma/migrations/<ts>_add_service_opportunity/` |
| MODIFY | `src/domain/booking/booking-state-machine.ts` |
| CREATE | `src/domain/marketplace/opportunity-matching-policy.ts` |
| CREATE | `src/domain/marketplace/opportunity-matching-policy.test.ts` |
| CREATE | `src/domain/marketplace/opportunity-message.ts` |
| CREATE | `src/domain/marketplace/opportunity-message.test.ts` |
| MODIFY | `src/env.ts` |
| MODIFY | `.env.example` |
| CREATE | `src/application/marketplace/notify-opportunity.usecase.ts` |
| CREATE | `src/application/marketplace/notify-opportunity.usecase.integration.test.ts` |
| CREATE | `src/application/marketplace/process-opportunity-response.usecase.ts` |
| CREATE | `src/application/marketplace/process-opportunity-response.usecase.integration.test.ts` |
| CREATE | `src/application/marketplace/expire-opportunities.usecase.ts` |
| CREATE | `src/application/marketplace/expire-opportunities.usecase.integration.test.ts` |
| MODIFY | `src/app/api/messaging/evolution/webhook/route.ts` |
| CREATE | `src/app/api/internal/marketplace/expire/route.ts` |
| CREATE | `src/app/admin/bookings/page.tsx` |
| CREATE | `src/app/admin/bookings/new/page.tsx` |
| CREATE | `src/app/admin/bookings/actions.ts` |
| CREATE | `src/app/admin/bookings/[id]/opportunity/page.tsx` |

---

### Task 1: Schema — novos modelos e migração

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/domain/booking/booking-state-machine.ts`

- [ ] **Step 1: Adicionar enums ao `prisma/schema.prisma`**

Logo após o enum `OutboundMessageStatus`, inserir:

```prisma
enum ServiceOpportunityStatus {
  OPEN
  FILLED
  EXPIRED
  CANCELLED
}

enum OpportunityResponseValue {
  ACCEPTED
  DECLINED
  EXPIRED
}
```

- [ ] **Step 2: Adicionar campos ao model `Booking`**

Substituir o model `Booking` por:

```prisma
model Booking {
  id                       String        @id @default(uuid())
  status                   BookingStatus @default(DRAFT)
  version                  Int           @default(0)
  customerId               String
  customer                 User          @relation(fields: [customerId], references: [id])
  serviceId                String
  service                  ServiceDefinition @relation(fields: [serviceId], references: [id])
  scheduledAt              DateTime?
  neighborhood             String?
  durationMinutes          Int?
  professionalPaymentCents Int?
  totalCents               Int           @default(0)
  createdAt                DateTime      @default(now())
  updatedAt                DateTime      @updatedAt
  history                  BookingStatusHistory[]
  opportunities            ServiceOpportunity[]

  @@index([status])
  @@index([customerId])
  @@index([serviceId])
}
```

- [ ] **Step 3: Adicionar novos models ao final do schema**

```prisma
model ServiceOpportunity {
  id              String                   @id @default(uuid())
  bookingId       String                   @unique
  booking         Booking                  @relation(fields: [bookingId], references: [id])
  neighborhood    String
  scheduledAt     DateTime
  durationMinutes Int                      @default(180)
  paymentCents    Int
  status          ServiceOpportunityStatus @default(OPEN)
  expiresAt       DateTime
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  responses       OpportunityResponse[]

  @@index([status, expiresAt])
}

model OpportunityResponse {
  id            String                    @id @default(uuid())
  opportunityId String
  opportunity   ServiceOpportunity        @relation(fields: [opportunityId], references: [id])
  leadId        String
  lead          RecruitmentLead           @relation(fields: [leadId], references: [id])
  sentAt        DateTime                  @default(now())
  respondedAt   DateTime?
  response      OpportunityResponseValue?

  @@unique([opportunityId, leadId])
  @@index([leadId, response])
}
```

- [ ] **Step 4: Adicionar relação reversa ao `RecruitmentLead`**

No model `RecruitmentLead`, após `validationDecisions ValidationDecision[]`, adicionar:

```prisma
  opportunityResponses    OpportunityResponse[]
```

- [ ] **Step 5: Rodar a migração**

```bash
pnpm prisma migrate dev --name add_service_opportunity
```

Expected: `The following migration(s) have been applied: ..._add_service_opportunity`

- [ ] **Step 6: Atualizar `src/domain/booking/booking-state-machine.ts`**

Conteúdo completo do arquivo (adiciona `"MATCHING"` ao DRAFT e `"REVIEW_REQUIRED"` ao MATCHING):

```typescript
import { err, ok, type Result } from "../shared/result";
import { DomainError } from "../shared/domain-error";
import type { BookingStatus } from "./booking-status";

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT: ["COLLECTING_DATA", "MATCHING", "CANCELLED"],
  COLLECTING_DATA: ["REVIEW_REQUIRED", "AWAITING_CUSTOMER_CONFIRMATION", "CANCELLED"],
  REVIEW_REQUIRED: ["AWAITING_CUSTOMER_CONFIRMATION", "MATCHING", "CANCELLED"],
  AWAITING_CUSTOMER_CONFIRMATION: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["AWAITING_PAYMENT", "CANCELLED"],
  PAID: ["MATCHING", "REFUND_PENDING"],
  MATCHING: ["PROFESSIONAL_ASSIGNED", "REVIEW_REQUIRED", "ISSUE_OPEN", "CANCELLED"],
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

- [ ] **Step 7: Verificar que os testes existentes ainda passam**

```bash
pnpm tsc --noEmit && pnpm test
```

Expected: todos os testes passam, zero erros TypeScript.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/domain/booking/booking-state-machine.ts
git commit -m "feat(marketplace): schema ServiceOpportunity + OpportunityResponse + state machine"
```

---

### Task 2: Domain — `opportunity-matching-policy`

**Files:**
- Create: `src/domain/marketplace/opportunity-matching-policy.ts`
- Create: `src/domain/marketplace/opportunity-matching-policy.test.ts`

- [ ] **Step 1: Escrever o teste (TDD — primeiro)**

`src/domain/marketplace/opportunity-matching-policy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isEligibleForOpportunity } from "./opportunity-matching-policy";

// 2026-08-10 = segunda-feira (DOW=1 em UTC)
const opportunity = {
  neighborhood: "Aldeota",
  scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
  durationMinutes: 180,
};

const baseLead = {
  status: "ATIVA" as const,
  neighborhood: "Aldeota",
  canServeInitialArea: "SIM" as const,
  availabilityDays: ["segunda, quarta, sexta"] as unknown,
  phoneE164: "+5585999990001",
};

describe("isEligibleForOpportunity", () => {
  it("elegível: ATIVA, área SIM, dia disponível", () => {
    expect(isEligibleForOpportunity(baseLead, opportunity, [])).toBe(true);
  });

  it("elegível: status PREFERENCIAL", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, status: "PREFERENCIAL" as const },
      opportunity, [],
    )).toBe(true);
  });

  it("inelegível: status BASE_FUTURA", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, status: "BASE_FUTURA" as unknown as "ATIVA" },
      opportunity, [],
    )).toBe(false);
  });

  it("inelegível: canServeInitialArea NAO", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, canServeInitialArea: "NAO" as const },
      opportunity, [],
    )).toBe(false);
  });

  it("inelegível: canServeInitialArea TALVEZ + bairro diferente", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, canServeInitialArea: "TALVEZ" as const, neighborhood: "Benfica" },
      opportunity, [],
    )).toBe(false);
  });

  it("elegível: canServeInitialArea TALVEZ + mesmo bairro", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, canServeInitialArea: "TALVEZ" as const },
      opportunity, [],
    )).toBe(true);
  });

  it("inelegível: dia não disponível — domingo, profissional só seg/qua/sex", () => {
    // 2026-08-09 = domingo (DOW=0)
    expect(isEligibleForOpportunity(
      baseLead,
      { ...opportunity, scheduledAt: new Date("2026-08-09T13:00:00.000Z") },
      [],
    )).toBe(false);
  });

  it("elegível: range 'segunda a sexta' cobre quarta-feira", () => {
    // 2026-08-12 = quarta (DOW=3)
    expect(isEligibleForOpportunity(
      { ...baseLead, availabilityDays: ["segunda a sexta"] as unknown },
      { ...opportunity, scheduledAt: new Date("2026-08-12T13:00:00.000Z") },
      [],
    )).toBe(true);
  });

  it("inelegível: conflito de slot no mesmo dia calendario", () => {
    const sameDay = new Date("2026-08-10T06:00:00.000Z");
    expect(isEligibleForOpportunity(baseLead, opportunity, [sameDay])).toBe(false);
  });

  it("elegível: conflito em dia diferente não bloqueia", () => {
    const otherDay = new Date("2026-08-11T13:00:00.000Z");
    expect(isEligibleForOpportunity(baseLead, opportunity, [otherDay])).toBe(true);
  });

  it("inelegível: phoneE164 null", () => {
    expect(isEligibleForOpportunity({ ...baseLead, phoneE164: null }, opportunity, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que o teste falha**

```bash
pnpm test src/domain/marketplace/opportunity-matching-policy.test.ts
```

Expected: FAIL — "Cannot find module './opportunity-matching-policy'"

- [ ] **Step 3: Implementar `opportunity-matching-policy.ts`**

`src/domain/marketplace/opportunity-matching-policy.ts`:

```typescript
const ELIGIBLE_STATUSES = new Set(["ATIVA", "PREFERENCIAL"]);

// Mapa normalizado (sem acentos) → dia da semana (0=dom, 1=seg, …, 6=sáb)
const DAY_MAP: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, seg: 1,
  terca: 2, ter: 2,
  quarta: 3, qua: 3,
  quinta: 4, qui: 4,
  sexta: 5, sex: 5,
  sabado: 6, sab: 6,
};

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Retorna Set de dias disponíveis, ou null se não foi possível parsear nenhum dia
// (campo não preenchido → não filtra por dia).
function parseDays(raw: unknown): Set<number> | null {
  if (!Array.isArray(raw)) return null;
  const days = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const n = normalizeText(entry);
    // Detecta range "X a Y" (ex: "segunda a sexta")
    const rangeMatch = n.match(/(\w+)\s+a\s+(\w+)/);
    if (rangeMatch) {
      const start = DAY_MAP[rangeMatch[1]];
      const end = DAY_MAP[rangeMatch[2]];
      if (start !== undefined && end !== undefined) {
        for (let d = Math.min(start, end); d <= Math.max(start, end); d++) days.add(d);
        continue;
      }
    }
    // Extrai palavras individuais
    for (const word of n.split(/[\s,/;-]+/)) {
      if (DAY_MAP[word] !== undefined) days.add(DAY_MAP[word]);
    }
  }
  return days.size > 0 ? days : null;
}

function sameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export interface OpportunityInfo {
  neighborhood: string;
  scheduledAt: Date;
  durationMinutes: number;
}

export interface LeadInfo {
  status: string;
  neighborhood: string | null;
  canServeInitialArea: "SIM" | "TALVEZ" | "NAO" | null;
  availabilityDays: unknown;
  phoneE164: string | null;
}

export function isEligibleForOpportunity(
  lead: LeadInfo,
  opportunity: OpportunityInfo,
  acceptedSlotDates: Date[],
): boolean {
  if (!ELIGIBLE_STATUSES.has(lead.status)) return false;
  if (!lead.phoneE164) return false;

  const area = lead.canServeInitialArea;
  if (!area || area === "NAO") return false;
  if (area === "TALVEZ" && lead.neighborhood !== opportunity.neighborhood) return false;

  const days = parseDays(lead.availabilityDays);
  if (days !== null && !days.has(opportunity.scheduledAt.getUTCDay())) return false;

  for (const slot of acceptedSlotDates) {
    if (sameUTCDay(slot, opportunity.scheduledAt)) return false;
  }

  return true;
}
```

- [ ] **Step 4: Verificar que os testes passam**

```bash
pnpm test src/domain/marketplace/opportunity-matching-policy.test.ts
```

Expected: 11 tests PASS

- [ ] **Step 5: Typecheck + architecture**

```bash
pnpm tsc --noEmit && pnpm architecture:check
```

Expected: zero erros, zero violações.

- [ ] **Step 6: Commit**

```bash
git add src/domain/marketplace/opportunity-matching-policy.ts src/domain/marketplace/opportunity-matching-policy.test.ts
git commit -m "feat(marketplace): opportunity-matching-policy — pure eligibility check"
```

---

### Task 3: Domain — `opportunity-message`

**Files:**
- Create: `src/domain/marketplace/opportunity-message.ts`
- Create: `src/domain/marketplace/opportunity-message.test.ts`

- [ ] **Step 1: Escrever o teste**

`src/domain/marketplace/opportunity-message.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatOpportunityMessage } from "./opportunity-message";

describe("formatOpportunityMessage", () => {
  const opportunity = {
    neighborhood: "Aldeota",
    // 10:00 BRT = 13:00 UTC (Fortaleza = UTC-3)
    scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
    durationMinutes: 180,
    paymentCents: 15000,
    expiresAt: new Date("2026-08-10T17:00:00.000Z"),
  };

  it("contém o bairro", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("Aldeota");
  });

  it("contém valor em reais com vírgula decimal", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("150,00");
  });

  it("contém duração em horas", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("3h");
  });

  it("contém SIM e NAO em negrito WhatsApp", () => {
    const msg = formatOpportunityMessage(opportunity);
    expect(msg).toContain("*SIM*");
    expect(msg).toContain("*NAO*");
  });
});
```

- [ ] **Step 2: Verificar que o teste falha**

```bash
pnpm test src/domain/marketplace/opportunity-message.test.ts
```

Expected: FAIL — "Cannot find module './opportunity-message'"

- [ ] **Step 3: Implementar `opportunity-message.ts`**

`src/domain/marketplace/opportunity-message.ts`:

```typescript
const TZ = "America/Fortaleza";

export interface OpportunityMessageInput {
  neighborhood: string;
  scheduledAt: Date;
  durationMinutes: number;
  paymentCents: number;
  expiresAt: Date;
}

export function formatOpportunityMessage(input: OpportunityMessageInput): string {
  const dateStr = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  }).format(input.scheduledAt);

  const timeStr = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(input.scheduledAt);

  const expiresStr = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(input.expiresAt);

  const hours = Math.round(input.durationMinutes / 60);
  const payment = (input.paymentCents / 100).toFixed(2).replace(".", ",");

  return [
    "Ola! Temos uma oportunidade de servico para voce.",
    "",
    `Bairro: ${input.neighborhood}`,
    `Data: ${dateStr}`,
    `Horario: ${timeStr}`,
    `Duracao estimada: ${hours}h`,
    `Pagamento: R$ ${payment}`,
    "",
    "Responda *SIM* para aceitar ou *NAO* para recusar.",
    `Voce tem ate ${expiresStr} para responder.`,
  ].join("\n");
}
```

- [ ] **Step 4: Verificar que os testes passam**

```bash
pnpm test src/domain/marketplace/opportunity-message.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/marketplace/opportunity-message.ts src/domain/marketplace/opportunity-message.test.ts
git commit -m "feat(marketplace): opportunity-message — formata oferta WhatsApp"
```

---

### Task 4: env.ts — `OPPORTUNITY_EXPIRY_HOURS`

**Files:**
- Modify: `src/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Adicionar a variável em `src/env.ts`**

Na seção `envSchema`, após `RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS`, adicionar:

```typescript
  OPPORTUNITY_EXPIRY_HOURS: positiveIntegerEnv(4),
```

- [ ] **Step 2: Adicionar ao `.env.example`**

Após a seção de reengajamento, adicionar:

```
# Horas até expiração de uma oportunidade não respondida (padrão: 4).
OPPORTUNITY_EXPIRY_HOURS=""
```

- [ ] **Step 3: Verificar typecheck e testes**

```bash
pnpm tsc --noEmit && pnpm test
```

Expected: todos os testes passam.

- [ ] **Step 4: Commit**

```bash
git add src/env.ts .env.example
git commit -m "feat(marketplace): OPPORTUNITY_EXPIRY_HOURS env var"
```

---

### Task 5: Application — `notify-opportunity.usecase`

**Files:**
- Create: `src/application/marketplace/notify-opportunity.usecase.ts`
- Create: `src/application/marketplace/notify-opportunity.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste de integração**

`src/application/marketplace/notify-opportunity.usecase.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { notifyOpportunity } from "./notify-opportunity.usecase";

describe("notifyOpportunity", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedBooking(opts?: { neighborhood?: string; scheduledAt?: Date }) {
    const ts = Date.now();
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente", phoneE164: `+5585100${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `svc-${ts}`, name: "Limpeza" },
    });
    return prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        status: "DRAFT",
        neighborhood: opts?.neighborhood ?? "Aldeota",
        scheduledAt: opts?.scheduledAt ?? new Date("2026-08-10T13:00:00.000Z"),
        durationMinutes: 180,
        professionalPaymentCents: 15000,
      },
    });
  }

  async function seedLead(opts: {
    status: string;
    neighborhood: string;
    canServe: "SIM" | "TALVEZ" | "NAO";
    availability: string[];
    suffix: string;
  }) {
    const ts = Date.now();
    return prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP",
        status: opts.status as never,
        phoneE164: `+5585200${ts}${opts.suffix}`,
        fullName: `Prof ${opts.suffix}`,
        neighborhood: opts.neighborhood,
        canServeInitialArea: opts.canServe,
        availabilityDays: opts.availability,
      },
    });
  }

  it("cria ServiceOpportunity, OpportunityResponses e OutboxMessages apenas para leads elegíveis", async () => {
    const booking = await seedBooking(); // segunda-feira, Aldeota
    const lead1 = await seedLead({ status: "ATIVA", neighborhood: "Aldeota", canServe: "SIM", availability: ["segunda, quarta, sexta"], suffix: "A" });
    const lead2 = await seedLead({ status: "PREFERENCIAL", neighborhood: "Aldeota", canServe: "TALVEZ", availability: ["segunda a sexta"], suffix: "B" });
    // Inelegível: BASE_FUTURA
    await seedLead({ status: "BASE_FUTURA", neighborhood: "Aldeota", canServe: "SIM", availability: ["segunda a sexta"], suffix: "C" });

    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    expect(result.notified).toBe(2);

    const opportunity = await prisma.serviceOpportunity.findUniqueOrThrow({
      where: { bookingId: booking.id },
      include: { responses: true },
    });
    expect(opportunity.status).toBe("OPEN");
    expect(opportunity.responses).toHaveLength(2);
    expect(opportunity.responses.map((r) => r.leadId).sort()).toEqual([lead1.id, lead2.id].sort());

    const outbox = await prisma.outboxMessage.findMany({ where: { correlationId: opportunity.id } });
    expect(outbox).toHaveLength(2);

    const updatedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updatedBooking.status).toBe("MATCHING");
  });

  it("retorna notified=0 quando nenhum profissional elegível existe", async () => {
    // domingo — nenhum profissional com domingo na disponibilidade
    const booking = await seedBooking({ scheduledAt: new Date("2026-08-09T13:00:00.000Z") });
    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    expect(result.notified).toBe(0);
    const opportunity = await prisma.serviceOpportunity.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(opportunity.status).toBe("OPEN");
    const updatedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updatedBooking.status).toBe("MATCHING");
  });
});
```

- [ ] **Step 2: Verificar que o teste falha**

```bash
pnpm exec vitest run --testTimeout=60000 src/application/marketplace/notify-opportunity.usecase.integration.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module './notify-opportunity.usecase'"

- [ ] **Step 3: Implementar `notify-opportunity.usecase.ts`**

`src/application/marketplace/notify-opportunity.usecase.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { isEligibleForOpportunity } from "../../domain/marketplace/opportunity-matching-policy";
import { formatOpportunityMessage } from "../../domain/marketplace/opportunity-message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export async function notifyOpportunity(
  prisma: PrismaClient,
  input: { bookingId: string; now?: Date },
): Promise<{ notified: number }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + env.OPPORTUNITY_EXPIRY_HOURS * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
    if (!booking) throw new Error(`Booking ${input.bookingId} não encontrado`);
    if (!booking.scheduledAt || !booking.neighborhood || booking.professionalPaymentCents == null) {
      throw new Error("Booking precisa de scheduledAt, neighborhood e professionalPaymentCents");
    }

    const opportunityInfo = {
      neighborhood: booking.neighborhood,
      scheduledAt: booking.scheduledAt,
      durationMinutes: booking.durationMinutes ?? 180,
    };

    const candidates = await tx.recruitmentLead.findMany({
      where: { status: { in: ["ATIVA", "PREFERENCIAL"] }, phoneE164: { not: null } },
      select: {
        id: true,
        status: true,
        neighborhood: true,
        canServeInitialArea: true,
        availabilityDays: true,
        phoneE164: true,
        opportunityResponses: {
          where: { response: "ACCEPTED" },
          include: { opportunity: { select: { scheduledAt: true } } },
        },
      },
    });

    const eligible = candidates.filter((lead) => {
      const acceptedSlotDates = lead.opportunityResponses.map((r) => r.opportunity.scheduledAt);
      return isEligibleForOpportunity(lead, opportunityInfo, acceptedSlotDates);
    });

    const opportunity = await tx.serviceOpportunity.create({
      data: {
        bookingId: booking.id,
        neighborhood: booking.neighborhood,
        scheduledAt: booking.scheduledAt,
        durationMinutes: booking.durationMinutes ?? 180,
        paymentCents: booking.professionalPaymentCents,
        expiresAt,
        status: "OPEN",
      },
    });

    const messageText = formatOpportunityMessage({
      neighborhood: opportunity.neighborhood,
      scheduledAt: opportunity.scheduledAt,
      durationMinutes: opportunity.durationMinutes,
      paymentCents: opportunity.paymentCents,
      expiresAt: opportunity.expiresAt,
    });

    for (const lead of eligible) {
      await tx.opportunityResponse.create({
        data: { opportunityId: opportunity.id, leadId: lead.id },
      });
      await enqueueOutboundMessage(tx, {
        provider: "evolution",
        recipient: lead.phoneE164!,
        payload: { version: 1, type: "TEXT", text: messageText },
        idempotencyKey: `opportunity:${opportunity.id}:${lead.id}:offer`,
        correlationId: opportunity.id,
        actor: "system:marketplace",
      });
    }

    const updated = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { status: "MATCHING", version: { increment: 1 } },
    });
    if (!updated.count) throw new Error("Booking alterado concorrentemente");

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "MATCHING",
        actor: "system:marketplace",
      },
    });

    await recordAuditLog(tx, {
      actor: "system:marketplace",
      action: "OPPORTUNITY_DISPATCHED",
      entityType: "ServiceOpportunity",
      entityId: opportunity.id,
      metadata: { bookingId: booking.id, eligible: eligible.length },
    });

    return { notified: eligible.length };
  });
}
```

- [ ] **Step 4: Verificar que os testes passam**

```bash
pnpm exec vitest run --testTimeout=60000 src/application/marketplace/notify-opportunity.usecase.integration.test.ts 2>&1 | tail -15
```

Expected: 2 tests PASS

- [ ] **Step 5: Typecheck + architecture**

```bash
pnpm tsc --noEmit && pnpm architecture:check
```

Expected: zero erros, zero violações.

- [ ] **Step 6: Commit**

```bash
git add src/application/marketplace/
git commit -m "feat(marketplace): notify-opportunity — despacha oportunidade para elegíveis"
```

---

### Task 6: Application — `process-opportunity-response.usecase`

**Files:**
- Create: `src/application/marketplace/process-opportunity-response.usecase.ts`
- Create: `src/application/marketplace/process-opportunity-response.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste de integração**

`src/application/marketplace/process-opportunity-response.usecase.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { processOpportunityResponse } from "./process-opportunity-response.usecase";

describe("processOpportunityResponse", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedScene() {
    const ts = Date.now();
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente", phoneE164: `+5585300${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `s-${ts}`, name: "Limpeza" },
    });
    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id, serviceId: service.id,
        status: "MATCHING",
        neighborhood: "Aldeota", scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
        durationMinutes: 180, professionalPaymentCents: 15000,
      },
    });
    const opportunity = await prisma.serviceOpportunity.create({
      data: {
        bookingId: booking.id, neighborhood: "Aldeota",
        scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
        durationMinutes: 180, paymentCents: 15000,
        expiresAt: new Date(Date.now() + 4 * 3600 * 1000), status: "OPEN",
      },
    });
    const lead1 = await prisma.recruitmentLead.create({
      data: { origin: "WHATSAPP", status: "ATIVA", phoneE164: `+5585310${ts}`, fullName: "Ana" },
    });
    const lead2 = await prisma.recruitmentLead.create({
      data: { origin: "WHATSAPP", status: "ATIVA", phoneE164: `+5585320${ts}`, fullName: "Bia" },
    });
    const resp1 = await prisma.opportunityResponse.create({
      data: { opportunityId: opportunity.id, leadId: lead1.id },
    });
    const resp2 = await prisma.opportunityResponse.create({
      data: { opportunityId: opportunity.id, leadId: lead2.id },
    });
    const makeInbound = async (phone: string, text: string, suffix: string) =>
      prisma.inboundMessage.create({
        data: {
          provider: "evolution", externalId: `e-${ts}-${suffix}`,
          sender: phone, recipient: "+5585000000000",
          type: "TEXT", payload: { version: 1, type: "TEXT", text },
        },
      });
    return { booking, opportunity, lead1, lead2, resp1, resp2, makeInbound };
  }

  it("SIM — opportunity FILLED, booking PROFESSIONAL_ASSIGNED", async () => {
    const { booking, opportunity, lead1, resp1, makeInbound } = await seedScene();
    const inbound = await makeInbound(lead1.phoneE164!, "sim", "1");

    const result = await processOpportunityResponse(prisma, {
      responseId: resp1.id, text: "sim", inboundMessageId: inbound.id,
    });

    expect(result.outcome).toBe("ACCEPTED");

    const opp = await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(opp.status).toBe("FILLED");

    const bk = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bk.status).toBe("PROFESSIONAL_ASSIGNED");

    const r1 = await prisma.opportunityResponse.findUniqueOrThrow({ where: { id: resp1.id } });
    expect(r1.response).toBe("ACCEPTED");

    const outbox = await prisma.outboxMessage.findMany({ where: { correlationId: opportunity.id } });
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  });

  it("SIM depois de já preenchida — ALREADY_FILLED, booking inalterado", async () => {
    const { booking, lead1, lead2, resp1, resp2, makeInbound } = await seedScene();
    const inbound1 = await makeInbound(lead1.phoneE164!, "sim", "2a");
    await processOpportunityResponse(prisma, {
      responseId: resp1.id, text: "sim", inboundMessageId: inbound1.id,
    });

    const inbound2 = await makeInbound(lead2.phoneE164!, "sim", "2b");
    const result2 = await processOpportunityResponse(prisma, {
      responseId: resp2.id, text: "sim", inboundMessageId: inbound2.id,
    });

    expect(result2.outcome).toBe("ALREADY_FILLED");
    const bk = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bk.status).toBe("PROFESSIONAL_ASSIGNED");
  });

  it("NAO — DECLINED, booking permanece MATCHING", async () => {
    const { booking, resp1, lead1, makeInbound } = await seedScene();
    const inbound = await makeInbound(lead1.phoneE164!, "nao", "3");

    const result = await processOpportunityResponse(prisma, {
      responseId: resp1.id, text: "nao", inboundMessageId: inbound.id,
    });

    expect(result.outcome).toBe("DECLINED");
    const bk = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bk.status).toBe("MATCHING");
    const r1 = await prisma.opportunityResponse.findUniqueOrThrow({ where: { id: resp1.id } });
    expect(r1.response).toBe("DECLINED");
  });
});
```

- [ ] **Step 2: Verificar que o teste falha**

```bash
pnpm exec vitest run --testTimeout=60000 src/application/marketplace/process-opportunity-response.usecase.integration.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module './process-opportunity-response.usecase'"

- [ ] **Step 3: Implementar `process-opportunity-response.usecase.ts`**

`src/application/marketplace/process-opportunity-response.usecase.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

type Outcome = "ACCEPTED" | "DECLINED" | "ALREADY_FILLED" | "INVALID_RESPONSE" | "NOT_FOUND";

function parseResponse(text: string): "ACCEPTED" | "DECLINED" | null {
  const n = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (n === "sim" || n === "s") return "ACCEPTED";
  if (n === "nao" || n === "n") return "DECLINED";
  return null;
}

export async function processOpportunityResponse(
  prisma: PrismaClient,
  input: { responseId: string; text: string; inboundMessageId: string },
): Promise<{ outcome: Outcome }> {
  return prisma.$transaction(async (tx) => {
    const oppResp = await tx.opportunityResponse.findUnique({
      where: { id: input.responseId },
      include: {
        opportunity: true,
        lead: { select: { phoneE164: true, fullName: true } },
      },
    });
    if (!oppResp) return { outcome: "NOT_FOUND" };
    if (oppResp.opportunity.status !== "OPEN") return { outcome: "ALREADY_FILLED" };

    const parsed = parseResponse(input.text);
    if (!parsed) return { outcome: "INVALID_RESPONSE" };

    const now = new Date();
    const { opportunityId } = oppResp;
    const phoneE164 = oppResp.lead.phoneE164;
    const name = oppResp.lead.fullName ?? "Profissional";

    if (parsed === "DECLINED") {
      await tx.opportunityResponse.update({
        where: { id: input.responseId },
        data: { response: "DECLINED", respondedAt: now },
      });
      if (phoneE164) {
        await enqueueOutboundMessage(tx, {
          provider: "evolution", recipient: phoneE164,
          payload: { version: 1, type: "TEXT", text: "Tudo bem, obrigado! Avisaremos quando surgir uma nova oportunidade." },
          idempotencyKey: `opportunity:${opportunityId}:${input.responseId}:declined`,
          correlationId: opportunityId, actor: "system:marketplace",
        });
      }
      await recordAuditLog(tx, {
        actor: "system:marketplace", action: "OPPORTUNITY_DECLINED",
        entityType: "OpportunityResponse", entityId: input.responseId,
        metadata: { opportunityId },
      });
      return { outcome: "DECLINED" };
    }

    // ACCEPTED: lock via updateMany no ServiceOpportunity (OPEN → FILLED).
    // Apenas uma transação concorrente consegue mudar de OPEN. A que perder (count=0)
    // retorna ALREADY_FILLED sem modificar o booking.
    const claimed = await tx.serviceOpportunity.updateMany({
      where: { id: opportunityId, status: "OPEN" },
      data: { status: "FILLED" },
    });

    if (!claimed.count) {
      if (phoneE164) {
        await enqueueOutboundMessage(tx, {
          provider: "evolution", recipient: phoneE164,
          payload: { version: 1, type: "TEXT", text: "Que pena! Esta vaga ja foi preenchida. Avisaremos em novas oportunidades." },
          idempotencyKey: `opportunity:${opportunityId}:${input.responseId}:too-late`,
          correlationId: opportunityId, actor: "system:marketplace",
        });
      }
      return { outcome: "ALREADY_FILLED" };
    }

    // Ganhou o lock
    await tx.opportunityResponse.update({
      where: { id: input.responseId },
      data: { response: "ACCEPTED", respondedAt: now },
    });

    const opp = oppResp.opportunity;
    await tx.booking.updateMany({
      where: { id: opp.bookingId, status: "MATCHING" },
      data: { status: "PROFESSIONAL_ASSIGNED", version: { increment: 1 } },
    });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: opp.bookingId, fromStatus: "MATCHING",
        toStatus: "PROFESSIONAL_ASSIGNED",
        actor: "system:marketplace",
        reason: `Aceito por ${name}`,
      },
    });

    if (phoneE164) {
      const scheduledStr = new Intl.DateTimeFormat("pt-BR", {
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
        timeZone: "America/Fortaleza",
      }).format(opp.scheduledAt);
      await enqueueOutboundMessage(tx, {
        provider: "evolution", recipient: phoneE164,
        payload: { version: 1, type: "TEXT", text: `Otimo, ${name}! Confirmado para: ${scheduledStr} em ${opp.neighborhood}.` },
        idempotencyKey: `opportunity:${opportunityId}:${input.responseId}:confirmed`,
        correlationId: opportunityId, actor: "system:marketplace",
      });
    }

    // Notifica e encerra responses pendentes
    const pending = await tx.opportunityResponse.findMany({
      where: { opportunityId, response: null },
      include: { lead: { select: { phoneE164: true } } },
    });
    for (const p of pending) {
      await tx.opportunityResponse.update({
        where: { id: p.id },
        data: { response: "DECLINED", respondedAt: now },
      });
      if (p.lead.phoneE164) {
        await enqueueOutboundMessage(tx, {
          provider: "evolution", recipient: p.lead.phoneE164,
          payload: { version: 1, type: "TEXT", text: "Obrigado pelo interesse! Esta vaga acabou de ser preenchida. Avisaremos em novas oportunidades." },
          idempotencyKey: `opportunity:${opportunityId}:${p.id}:filled`,
          correlationId: opportunityId, actor: "system:marketplace",
        });
      }
    }

    await recordAuditLog(tx, {
      actor: "system:marketplace", action: "OPPORTUNITY_ACCEPTED",
      entityType: "OpportunityResponse", entityId: input.responseId,
      metadata: { opportunityId, bookingId: opp.bookingId, leadId: oppResp.leadId },
    });

    return { outcome: "ACCEPTED" };
  });
}
```

- [ ] **Step 4: Verificar que os testes passam**

```bash
pnpm exec vitest run --testTimeout=60000 src/application/marketplace/process-opportunity-response.usecase.integration.test.ts 2>&1 | tail -15
```

Expected: 3 tests PASS

- [ ] **Step 5: Typecheck + architecture**

```bash
pnpm tsc --noEmit && pnpm architecture:check
```

Expected: zero erros, zero violações.

- [ ] **Step 6: Commit**

```bash
git add src/application/marketplace/process-opportunity-response.usecase.ts src/application/marketplace/process-opportunity-response.usecase.integration.test.ts
git commit -m "feat(marketplace): process-opportunity-response — SIM/NAO com lock de primeiro a aceitar"
```

---

### Task 7: Application — `expire-opportunities.usecase`

**Files:**
- Create: `src/application/marketplace/expire-opportunities.usecase.ts`
- Create: `src/application/marketplace/expire-opportunities.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste de integração**

`src/application/marketplace/expire-opportunities.usecase.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { expireOpportunities } from "./expire-opportunities.usecase";

describe("expireOpportunities", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedExpiredOpportunity() {
    const ts = Date.now();
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "C", phoneE164: `+5585400${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `se-${ts}`, name: "Limpeza" },
    });
    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id, serviceId: service.id,
        status: "MATCHING",
        neighborhood: "Aldeota", scheduledAt: new Date(),
        durationMinutes: 180, professionalPaymentCents: 10000,
      },
    });
    const lead = await prisma.recruitmentLead.create({
      data: { origin: "WHATSAPP", status: "ATIVA", phoneE164: `+5585410${ts}`, fullName: "Prof" },
    });
    const opportunity = await prisma.serviceOpportunity.create({
      data: {
        bookingId: booking.id, neighborhood: "Aldeota",
        scheduledAt: new Date(), durationMinutes: 180, paymentCents: 10000,
        expiresAt: new Date(Date.now() - 1000), // já expirou
        status: "OPEN",
      },
    });
    await prisma.opportunityResponse.create({
      data: { opportunityId: opportunity.id, leadId: lead.id },
    });
    return { booking, opportunity };
  }

  it("marca oportunidade expirada como EXPIRED, booking vai para REVIEW_REQUIRED, responses ficam EXPIRED", async () => {
    const { booking, opportunity } = await seedExpiredOpportunity();

    const result = await expireOpportunities(prisma);

    expect(result.expired).toBeGreaterThanOrEqual(1);

    const opp = await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(opp.status).toBe("EXPIRED");

    const bk = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bk.status).toBe("REVIEW_REQUIRED");

    const responses = await prisma.opportunityResponse.findMany({ where: { opportunityId: opportunity.id } });
    for (const r of responses) expect(r.response).toBe("EXPIRED");
  });

  it("não toca oportunidades com expiresAt no futuro", async () => {
    const ts = Date.now();
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "C2", phoneE164: `+5585420${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `sf-${ts}`, name: "Limpeza2" },
    });
    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id, serviceId: service.id,
        status: "MATCHING", neighborhood: "Aldeota", scheduledAt: new Date(),
        durationMinutes: 180, professionalPaymentCents: 10000,
      },
    });
    const futureOpp = await prisma.serviceOpportunity.create({
      data: {
        bookingId: booking.id, neighborhood: "Aldeota", scheduledAt: new Date(),
        durationMinutes: 180, paymentCents: 10000,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        status: "OPEN",
      },
    });

    await expireOpportunities(prisma);

    const opp = await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: futureOpp.id } });
    expect(opp.status).toBe("OPEN");
  });
});
```

- [ ] **Step 2: Verificar que o teste falha**

```bash
pnpm exec vitest run --testTimeout=60000 src/application/marketplace/expire-opportunities.usecase.integration.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module './expire-opportunities.usecase'"

- [ ] **Step 3: Implementar `expire-opportunities.usecase.ts`**

`src/application/marketplace/expire-opportunities.usecase.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export async function expireOpportunities(
  prisma: PrismaClient,
  input?: { now?: Date },
): Promise<{ scanned: number; expired: number }> {
  const now = input?.now ?? new Date();

  const candidates = await prisma.serviceOpportunity.findMany({
    where: { status: "OPEN", expiresAt: { lt: now } },
    select: { id: true, bookingId: true },
  });

  let expired = 0;
  for (const candidate of candidates) {
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.serviceOpportunity.updateMany({
        where: { id: candidate.id, status: "OPEN" },
        data: { status: "EXPIRED" },
      });
      if (!claimed.count) return false;

      await tx.opportunityResponse.updateMany({
        where: { opportunityId: candidate.id, response: null },
        data: { response: "EXPIRED", respondedAt: now },
      });

      await tx.booking.updateMany({
        where: { id: candidate.bookingId, status: "MATCHING" },
        data: { status: "REVIEW_REQUIRED", version: { increment: 1 } },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: candidate.bookingId,
          fromStatus: "MATCHING",
          toStatus: "REVIEW_REQUIRED",
          actor: "system:marketplace",
          reason: "Oportunidade expirou sem aceite",
        },
      });

      await recordAuditLog(tx, {
        actor: "system:marketplace",
        action: "OPPORTUNITY_EXPIRED",
        entityType: "ServiceOpportunity",
        entityId: candidate.id,
        metadata: { bookingId: candidate.bookingId },
      });

      return true;
    });
    if (done) expired += 1;
  }

  return { scanned: candidates.length, expired };
}
```

- [ ] **Step 4: Verificar que os testes passam**

```bash
pnpm exec vitest run --testTimeout=60000 src/application/marketplace/expire-opportunities.usecase.integration.test.ts 2>&1 | tail -15
```

Expected: 2 tests PASS

- [ ] **Step 5: Typecheck + architecture**

```bash
pnpm tsc --noEmit && pnpm architecture:check
```

Expected: zero erros, zero violações.

- [ ] **Step 6: Commit**

```bash
git add src/application/marketplace/expire-opportunities.usecase.ts src/application/marketplace/expire-opportunities.usecase.integration.test.ts
git commit -m "feat(marketplace): expire-opportunities — expira oportunidades sem aceite"
```

---

### Task 8: Webhook — roteamento de oportunidade

**Files:**
- Modify: `src/app/api/messaging/evolution/webhook/route.ts`

A modificação adiciona verificação de `OpportunityResponse` pendente **antes** de chamar `processRecruitmentAnswer`. Se o remetente tem resposta pendente, roteia para `processOpportunityResponse` e retorna imediatamente.

- [ ] **Step 1: Escrever o conteúdo completo do arquivo**

`src/app/api/messaging/evolution/webhook/route.ts`:

```typescript
import { env } from "@/env";
import { processInboundEvent } from "@/application/messaging/process-inbound-event.usecase";
import { processRecruitmentAnswer, startRecruitmentConversation } from "@/application/recruitment/conversation-engine.usecase";
import { processOpportunityResponse } from "@/application/marketplace/process-opportunity-response.usecase";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { isValidEvolutionWebhook, normalizeEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isValidEvolutionWebhook(env.EVOLUTION_WEBHOOK_SECRET, request.headers.get("x-allset-webhook-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const event = normalizeEvolutionWebhook(body);
  if (!event) return Response.json({ ok: true, ignored: true });

  try {
    const received = await processInboundEvent(prisma, {
      ...event, provider: "evolution", actor: "evolution:webhook",
    });
    if (received.duplicate) return Response.json({ ok: true, duplicate: true });
    if (event.payload.type === "AUDIO") {
      return Response.json({ ok: true, needsMediaDownload: true }, { status: 202 });
    }

    // Prioridade: verifica se o remetente aguarda resposta de oportunidade de serviço
    const pendingOpportunityResponse = await prisma.opportunityResponse.findFirst({
      where: {
        lead: { phoneE164: event.sender },
        response: null,
        opportunity: { status: "OPEN" },
      },
    });
    if (pendingOpportunityResponse) {
      const result = await processOpportunityResponse(prisma, {
        responseId: pendingOpportunityResponse.id,
        text: event.payload.text,
        inboundMessageId: received.message.id,
      });
      return Response.json({ ok: true, routed: "opportunity", result });
    }

    // Fluxo de recrutamento
    const lead = await prisma.recruitmentLead.findUnique({
      where: { phoneE164: event.sender },
      include: { conversation: { select: { id: true } } },
    });
    if (!lead) {
      await startRecruitmentConversation(prisma, { phoneE164: event.sender, provider: "evolution" });
      return Response.json({ ok: true, started: true }, { status: 202 });
    }
    if (!lead.conversation) {
      if (lead.status === "LEAD" || lead.status === "PRE_CADASTRO") {
        await startRecruitmentConversation(prisma, { phoneE164: event.sender, provider: "evolution" });
        return Response.json({ ok: true, started: true }, { status: 202 });
      }
      return Response.json({ ok: true, ignored: "NO_RECRUITMENT_CONVERSATION" });
    }

    const result = await processRecruitmentAnswer(prisma, {
      inboundMessageId: received.message.id,
      text: event.payload.text,
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    logger.error(
      { err: error, provider: "evolution", externalId: event.externalId },
      "Falha ao processar webhook da Evolution",
    );
    return Response.json({ ok: false, error: "PROCESSING_FAILED" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 3: Verificar testes unitários existentes**

```bash
pnpm test
```

Expected: todos os testes passam.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/messaging/evolution/webhook/route.ts
git commit -m "feat(marketplace): webhook roteia para opportunity response quando pendente"
```

---

### Task 9: API route — `POST /api/internal/marketplace/expire`

**Files:**
- Create: `src/app/api/internal/marketplace/expire/route.ts`

- [ ] **Step 1: Criar o arquivo**

`src/app/api/internal/marketplace/expire/route.ts`:

```typescript
import { expireOpportunities } from "@/application/marketplace/expire-opportunities.usecase";
import { env } from "@/env";
import { prisma } from "@/infrastructure/db/prisma-client";
import { isValidEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";
import { logger } from "@/infrastructure/observability/logger";

export const runtime = "nodejs";

/** Cron-only: expira oportunidades sem aceite após o prazo configurado. */
export async function POST(request: Request) {
  if (!isValidEvolutionWebhook(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await expireOpportunities(prisma);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error({ err: error }, "Falha ao expirar oportunidades");
    return Response.json({ ok: false, error: "EXPIRE_FAILED" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck + architecture**

```bash
pnpm tsc --noEmit && pnpm architecture:check
```

Expected: zero erros, zero violações.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/internal/marketplace/expire/route.ts
git commit -m "feat(marketplace): POST /api/internal/marketplace/expire — cron de expiração"
```

---

### Task 10: Admin UI — bookings

**Files:**
- Create: `src/app/admin/bookings/actions.ts`
- Create: `src/app/admin/bookings/page.tsx`
- Create: `src/app/admin/bookings/new/page.tsx`
- Create: `src/app/admin/bookings/[id]/opportunity/page.tsx`

- [ ] **Step 1: Criar `src/app/admin/bookings/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { notifyOpportunity } from "@/application/marketplace/notify-opportunity.usecase";

async function currentActor(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.email ?? null;
}

const r = (ok: boolean, error?: string) =>
  (error === undefined ? { ok } : { ok, error });

export async function createBookingAction(input: {
  serviceId: string;
  neighborhood: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  professionalPaymentCents: number;
  customerPhone: string;
}) {
  const actor = await currentActor();
  if (!actor) return r(false, "Sessão expirada.");
  try {
    let customer = await prisma.user.findUnique({ where: { phoneE164: input.customerPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: { role: "CUSTOMER", fullName: input.customerPhone, phoneE164: input.customerPhone },
      });
    }
    const scheduledAt = new Date(`${input.scheduledDate}T${input.scheduledTime}:00-03:00`);
    await prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: input.serviceId,
        status: "DRAFT",
        neighborhood: input.neighborhood,
        scheduledAt,
        durationMinutes: input.durationMinutes,
        professionalPaymentCents: input.professionalPaymentCents,
      },
    });
    revalidatePath("/admin/bookings");
    return r(true);
  } catch (error) {
    return r(false, error instanceof Error ? error.message : "Erro ao criar booking.");
  }
}

export async function dispatchOpportunityAction(bookingId: string) {
  const actor = await currentActor();
  if (!actor) return r(false, "Sessão expirada.");
  try {
    const result = await notifyOpportunity(prisma, { bookingId });
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}/opportunity`);
    return { ok: true, notified: result.notified };
  } catch (error) {
    return r(false, error instanceof Error ? error.message : "Erro ao despachar oportunidade.");
  }
}
```

- [ ] **Step 2: Criar `src/app/admin/bookings/page.tsx`**

```typescript
import { prisma } from "@/infrastructure/db/prisma-client";
import { dispatchOpportunityAction } from "./actions";
import Link from "next/link";

export default async function BookingsPage() {
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      service: { select: { name: true } },
      customer: { select: { fullName: true, phoneE164: true } },
      opportunities: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Agendamentos</h1>
        <Link href="/admin/bookings/new">+ Novo agendamento</Link>
      </div>
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Serviço</th>
            <th>Bairro</th>
            <th>Data/Hora</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const opp = b.opportunities[0];
            const fmt = (d: Date) =>
              new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Fortaleza",
              }).format(d);
            return (
              <tr key={b.id}>
                <td>{b.customer.fullName} {b.customer.phoneE164}</td>
                <td>{b.service.name}</td>
                <td>{b.neighborhood ?? "—"}</td>
                <td>{b.scheduledAt ? fmt(b.scheduledAt) : "—"}</td>
                <td>{b.status}</td>
                <td>
                  {b.status === "DRAFT" && (
                    <form action={dispatchOpportunityAction.bind(null, b.id)}>
                      <button type="submit">Enviar para Matching</button>
                    </form>
                  )}
                  {opp && (
                    <Link href={`/admin/bookings/${b.id}/opportunity`}>
                      Oportunidade ({opp.status})
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: Criar `src/app/admin/bookings/new/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBookingAction } from "../actions";

export default function NewBookingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    serviceId: "",
    neighborhood: "",
    scheduledDate: "",
    scheduledTime: "",
    durationMinutes: "180",
    professionalPaymentCents: "15000",
    customerPhone: "",
  });

  const set = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await createBookingAction({
      ...form,
      durationMinutes: Number(form.durationMinutes),
      professionalPaymentCents: Number(form.professionalPaymentCents),
    });
    setLoading(false);
    if (!res.ok) return setError(res.error ?? "Erro ao criar.");
    router.push("/admin/bookings");
  }

  return (
    <section>
      <h1>Novo agendamento</h1>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label>ID do Serviço<input required value={form.serviceId} onChange={set("serviceId")} /></label>
        <label>Bairro<input required value={form.neighborhood} onChange={set("neighborhood")} /></label>
        <label>Data<input required type="date" value={form.scheduledDate} onChange={set("scheduledDate")} /></label>
        <label>Horário<input required type="time" value={form.scheduledTime} onChange={set("scheduledTime")} /></label>
        <label>Duração (min)<input required type="number" value={form.durationMinutes} onChange={set("durationMinutes")} /></label>
        <label>Pagamento ao profissional (centavos)<input required type="number" value={form.professionalPaymentCents} onChange={set("professionalPaymentCents")} /></label>
        <label>Telefone do cliente<input required value={form.customerPhone} onChange={set("customerPhone")} /></label>
        {error && <p role="alert" style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Criando…" : "Criar agendamento"}</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Criar `src/app/admin/bookings/[id]/opportunity/page.tsx`**

```typescript
import { prisma } from "@/infrastructure/db/prisma-client";
import { notFound } from "next/navigation";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(d);

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(d);

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      opportunities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          responses: {
            orderBy: { sentAt: "asc" },
            include: {
              lead: { select: { fullName: true, phoneE164: true, neighborhood: true } },
            },
          },
        },
      },
    },
  });

  if (!booking) notFound();

  const opportunity = booking.opportunities[0];

  return (
    <section>
      <h1>Oportunidade — Booking {id.slice(0, 8)}</h1>
      <p>Status do booking: <strong>{booking.status}</strong></p>
      {!opportunity && <p>Nenhuma oportunidade despachada ainda.</p>}
      {opportunity && (
        <>
          <p>Status: <strong>{opportunity.status}</strong></p>
          <p>Bairro: {opportunity.neighborhood} | Expira: {fmt(opportunity.expiresAt)}</p>
          <table>
            <thead>
              <tr>
                <th>Profissional</th>
                <th>Bairro</th>
                <th>Enviado</th>
                <th>Resposta</th>
                <th>Respondeu</th>
              </tr>
            </thead>
            <tbody>
              {opportunity.responses.map((r) => (
                <tr key={r.id}>
                  <td>{r.lead.fullName ?? "—"} ({r.lead.phoneE164})</td>
                  <td>{r.lead.neighborhood ?? "—"}</td>
                  <td>{fmtTime(r.sentAt)}</td>
                  <td>{r.response ?? "Aguardando"}</td>
                  <td>{r.respondedAt ? fmtTime(r.respondedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero erros TypeScript.

- [ ] **Step 6: Rodar todos os testes unitários**

```bash
pnpm test
```

Expected: todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/bookings/
git commit -m "feat(marketplace): admin UI — bookings CRUD + despacho de oportunidade"
```

---

## Verificação final

- [ ] **CI check completo**

```bash
pnpm ci:check
```

Expected: lint + typecheck + arquitetura + dead-code + testes unitários + build — tudo verde.

- [ ] **Todos os testes de integração**

```bash
pnpm test:integration
```

Expected: todos os testes existentes + os 3 novos suites (notify, process-response, expire) passam.

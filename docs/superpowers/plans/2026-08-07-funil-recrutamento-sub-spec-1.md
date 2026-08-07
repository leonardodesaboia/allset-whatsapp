# Funil de Recrutamento — Sub-spec 1 (Domínio + Kanban + Notas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o funil de recrutamento de profissionais como domínio puro + dashboard (máquina de estados, Kanban com drag-and-drop, notas internas, próxima-ação/lembretes, cadastro manual e linha do tempo), sem dependência de mensageria.

**Architecture:** Segue o ADR 0001 (monólito modular em camadas). Nova entidade `RecruitmentLead` independente de `User`/`ProfessionalProfile`, que "gradua" para `ProfessionalProfile` na ativação. Máquina de estados é domínio puro (molde de `booking-state-machine.ts`); casos de uso orquestram transação + concorrência otimista + histórico + auditoria (molde de `transition-booking-status.usecase.ts`); Kanban em `app/admin/recruitment` (Server Components + Server Actions).

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Prisma 6, PostgreSQL, Vitest + Testcontainers (integração), Playwright (E2E), `@dnd-kit/core` + `@dnd-kit/sortable` (drag-and-drop novo).

**Spec:** `docs/superpowers/specs/2026-08-07-funil-recrutamento-sub-spec-1-dominio-kanban-design.md`

**Paralelização (preferência do usuário):** após a Task 2 estar mergeada, as Tasks 4, 5, 6 e 7 (casos de uso independentes) podem ser executadas em paralelo por subagentes distintos — não compartilham arquivos. As Tasks de UI (9–12) dependem de 3–8. Ver nota em cada task.

---

## File Structure

```
prisma/schema.prisma                                   # + enums e models (Task 1)
prisma/migrations/<ts>_add_recruitment_funnel/         # migration (Task 1)

src/domain/recruitment/
  recruitment-status.ts                                # RECRUITMENT_STATUSES + type (Task 2)
  recruitment-state-machine.ts                         # ALLOWED_TRANSITIONS + transição (Task 2)
  recruitment-state-machine.test.ts                    # (Task 2)

src/application/recruitment/
  create-lead.usecase.ts                               # (Task 3)
  create-lead.usecase.integration.test.ts
  transition-lead-status.usecase.ts                    # override + promoção (Task 4)
  transition-lead-status.usecase.integration.test.ts
  lead-notes.usecase.ts                                # add/edit/delete + revisões (Task 5)
  lead-notes.usecase.integration.test.ts
  lead-next-action.usecase.ts                          # next-action + lembretes (Task 6)
  lead-next-action.usecase.integration.test.ts
  record-lead-event.usecase.ts                         # timeline operacional (Task 7)
  kanban-read-model.ts                                 # agrupamento + "precisa de mim" + busca (Task 8)
  kanban-read-model.integration.test.ts

src/app/admin/recruitment/
  page.tsx                                             # board (Server Component) (Task 9)
  actions.ts                                           # Server Actions (Task 9)
  kanban-board.tsx                                     # client, dnd-kit (Task 9)
  lead-card.tsx                                        # client (Task 9)
  quick-note-modal.tsx                                 # client (Task 10)
  new-lead-form.tsx                                    # cadastro manual (Task 11)
  [leadId]/page.tsx                                    # perfil + timeline (Task 12)

tests/e2e/recruitment-kanban.spec.ts                   # (Task 13)
tests/e2e/seed.ts                                       # + seed de leads (Task 13, modify)
```

---

### Task 1: Schema Prisma + migration do funil

**Files:**
- Modify: `prisma/schema.prisma` (append no fim)
- Create: `prisma/migrations/<timestamp>_add_recruitment_funnel/migration.sql` (gerado)

- [ ] **Step 1: Adicionar enums e models ao schema**

Anexar ao final de `prisma/schema.prisma`:

```prisma
enum RecruitmentStatus {
  LEAD
  PRE_CADASTRO
  TRIAGEM
  CONVERSA_PENDENTE
  ENTREVISTA
  REFERENCIA
  PRE_APROVADA
  DOCUMENTACAO
  ONBOARDING
  TESTE_OPERACIONAL
  EM_VALIDACAO
  ATIVA
  PREFERENCIAL
  PRECISA_DE_AJUDA
  LIGACAO_SOLICITADA
  BASE_FUTURA
  AGUARDANDO_COMPLEMENTACAO
  REPROVADA
  DESISTIU
  PAUSADA
  SUSPENSA
}

enum LeadOrigin {
  META_ADS
  INSTAGRAM
  FACEBOOK
  INDICACAO_PROFISSIONAL
  INDICACAO_CLIENTE
  IDT
  PARCEIRO
  ORGANICO
  WHATSAPP
  CADASTRO_MANUAL
  OUTRO
}

enum CommunicationMode {
  TEXT
  AUDIO
  PHONE
  MIXED
}

enum InitialChannelPreference {
  WHATSAPP
  PHONE
}

enum WhatsappAutonomy {
  INDEPENDENT
  OCCASIONAL_SUPPORT
  UNKNOWN
}

enum ExperienceDuration {
  LT_1Y
  Y1_3
  GT_3Y
  BY_AUDIO
}

enum AreaCompatibility {
  SIM
  TALVEZ
  NAO
}

enum LeadNoteType {
  GERAL
  ENTREVISTA
  REFERENCIA
  DOCUMENTACAO
  OPERACIONAL
  PAGAMENTO
  INCIDENTE
  FOLLOW_UP
}

model RecruitmentLead {
  id                        String                    @id @default(uuid())
  status                    RecruitmentStatus         @default(LEAD)
  version                   Int                       @default(0)
  phoneE164                 String?
  fullName                  String?
  neighborhood              String?
  origin                    LeadOrigin
  campaign                  String?
  referralCode              String?
  partnerName               String?
  referredByProfessionalId  String?
  originNote                String?
  preferredCommunicationMode CommunicationMode?
  initialChannelPreference  InitialChannelPreference?
  whatsappAutonomy          WhatsappAutonomy?         @default(UNKNOWN)
  hasProfessionalExperience Boolean?
  hasInformalExperience     Boolean?
  experienceDuration        ExperienceDuration?
  canServeInitialArea       AreaCompatibility?
  availabilityDays          Json?
  nextAction                String?
  nextActionAt              DateTime?
  professionalProfileId     String?                   @unique
  professionalProfile       ProfessionalProfile?      @relation(fields: [professionalProfileId], references: [id])
  lastInteractionAt         DateTime?
  createdAt                 DateTime                  @default(now())
  updatedAt                 DateTime                  @updatedAt
  history                   RecruitmentStatusHistory[]
  notes                     LeadNote[]
  reminders                 LeadReminder[]
  events                    LeadEvent[]

  @@index([status])
  @@index([neighborhood])
  @@index([origin])
  @@index([nextActionAt])
}

model RecruitmentStatusHistory {
  id         String            @id @default(uuid())
  leadId     String
  lead       RecruitmentLead   @relation(fields: [leadId], references: [id])
  fromStatus RecruitmentStatus?
  toStatus   RecruitmentStatus
  actor      String
  reason     String?
  override   Boolean           @default(false)
  createdAt  DateTime          @default(now())

  @@index([leadId])
}

model LeadNote {
  id        String              @id @default(uuid())
  leadId    String
  lead      RecruitmentLead     @relation(fields: [leadId], references: [id])
  author    String
  type      LeadNoteType        @default(GERAL)
  content   String
  pinned    Boolean             @default(false)
  createdAt DateTime            @default(now())
  editedAt  DateTime?
  deletedAt DateTime?
  revisions LeadNoteRevision[]

  @@index([leadId])
}

model LeadNoteRevision {
  id              String   @id @default(uuid())
  noteId          String
  note            LeadNote @relation(fields: [noteId], references: [id])
  previousContent String
  editedBy        String
  editedAt        DateTime @default(now())

  @@index([noteId])
}

model LeadReminder {
  id        String          @id @default(uuid())
  leadId    String
  lead      RecruitmentLead @relation(fields: [leadId], references: [id])
  text      String
  dueAt     DateTime
  doneAt    DateTime?
  createdBy String
  createdAt DateTime        @default(now())

  @@index([leadId])
  @@index([dueAt])
}

model LeadEvent {
  id          String          @id @default(uuid())
  leadId      String
  lead        RecruitmentLead @relation(fields: [leadId], references: [id])
  type        String
  description String
  actor       String
  occurredAt  DateTime        @default(now())
  metadata    Json?

  @@index([leadId])
}
```

Também adicionar a relação inversa em `ProfessionalProfile` (linha ~40 do schema). Localizar o model `ProfessionalProfile` e adicionar dentro dele:

```prisma
  recruitmentLead RecruitmentLead?
```

- [ ] **Step 2: Gerar a migration**

Run: `pnpm exec prisma migrate dev --name add_recruitment_funnel`
Expected: cria `prisma/migrations/<ts>_add_recruitment_funnel/migration.sql`, aplica no banco local, e regenera o client sem erro.

- [ ] **Step 3: Verificar typecheck do client gerado**

Run: `pnpm typecheck`
Expected: PASS (sem erros — os novos tipos `RecruitmentLead` etc. existem em `@prisma/client`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(recrutamento): schema e migration do funil (RecruitmentLead + agregados)"
```

---

### Task 2: Máquina de estados do funil (domínio puro)

**Files:**
- Create: `src/domain/recruitment/recruitment-status.ts`
- Create: `src/domain/recruitment/recruitment-state-machine.ts`
- Test: `src/domain/recruitment/recruitment-state-machine.test.ts`

- [ ] **Step 1: Criar o tipo de status**

Create `src/domain/recruitment/recruitment-status.ts`:

```ts
export const RECRUITMENT_STATUSES = [
  "LEAD",
  "PRE_CADASTRO",
  "TRIAGEM",
  "CONVERSA_PENDENTE",
  "ENTREVISTA",
  "REFERENCIA",
  "PRE_APROVADA",
  "DOCUMENTACAO",
  "ONBOARDING",
  "TESTE_OPERACIONAL",
  "EM_VALIDACAO",
  "ATIVA",
  "PREFERENCIAL",
  "PRECISA_DE_AJUDA",
  "LIGACAO_SOLICITADA",
  "BASE_FUTURA",
  "AGUARDANDO_COMPLEMENTACAO",
  "REPROVADA",
  "DESISTIU",
  "PAUSADA",
  "SUSPENSA",
] as const;

export type RecruitmentStatus = (typeof RECRUITMENT_STATUSES)[number];
```

- [ ] **Step 2: Escrever o teste que falha**

Create `src/domain/recruitment/recruitment-state-machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { transitionRecruitmentStatus, ALLOWED_TRANSITIONS } from "./recruitment-state-machine";
import { RECRUITMENT_STATUSES, type RecruitmentStatus } from "./recruitment-status";

describe("transitionRecruitmentStatus", () => {
  it("permite todas as transições declaradas no mapa", () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS) as [
      RecruitmentStatus,
      RecruitmentStatus[],
    ][]) {
      for (const to of targets) {
        const result = transitionRecruitmentStatus(from, to);
        expect(result.ok, `${from} -> ${to} deveria ser permitido`).toBe(true);
      }
    }
  });

  it("segue o caminho principal do funil (LEAD -> ... -> ATIVA)", () => {
    const path: RecruitmentStatus[] = [
      "LEAD", "PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "ENTREVISTA",
      "REFERENCIA", "PRE_APROVADA", "DOCUMENTACAO", "ONBOARDING",
      "TESTE_OPERACIONAL", "EM_VALIDACAO", "ATIVA",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(transitionRecruitmentStatus(path[i], path[i + 1]).ok).toBe(true);
    }
  });

  it("rejeita pular etapas obrigatórias (PRE_CADASTRO -> ATIVA)", () => {
    const result = transitionRecruitmentStatus("PRE_CADASTRO", "ATIVA");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_RECRUITMENT_TRANSITION");
    }
  });

  it("permite pedir ligação a partir de qualquer estágio ativo", () => {
    expect(transitionRecruitmentStatus("PRE_CADASTRO", "LIGACAO_SOLICITADA").ok).toBe(true);
    expect(transitionRecruitmentStatus("ENTREVISTA", "LIGACAO_SOLICITADA").ok).toBe(true);
  });

  it("retoma o funil a partir de LIGACAO_SOLICITADA sem reiniciar", () => {
    expect(transitionRecruitmentStatus("LIGACAO_SOLICITADA", "ENTREVISTA").ok).toBe(true);
  });

  it("estados terminais não têm saída (DESISTIU, REPROVADA)", () => {
    expect(transitionRecruitmentStatus("DESISTIU", "PRE_CADASTRO").ok).toBe(false);
    expect(transitionRecruitmentStatus("REPROVADA", "PRE_CADASTRO").ok).toBe(false);
  });

  it("todo status em RECRUITMENT_STATUSES aparece no mapa de transições", () => {
    for (const status of RECRUITMENT_STATUSES) {
      expect(Object.hasOwn(ALLOWED_TRANSITIONS, status)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Rodar o teste para vê-lo falhar**

Run: `pnpm exec vitest run src/domain/recruitment/recruitment-state-machine.test.ts`
Expected: FAIL — `Cannot find module './recruitment-state-machine'`.

- [ ] **Step 4: Implementar a máquina de estados**

Create `src/domain/recruitment/recruitment-state-machine.ts`:

```ts
import { err, ok, type Result } from "../shared/result";
import { DomainError } from "../shared/domain-error";
import type { RecruitmentStatus } from "./recruitment-status";

// Estágios principais do funil (destinos válidos ao retomar de um estado de recuperação).
const MAIN_STAGES: RecruitmentStatus[] = [
  "PRE_CADASTRO",
  "TRIAGEM",
  "CONVERSA_PENDENTE",
  "ENTREVISTA",
  "REFERENCIA",
  "PRE_APROVADA",
  "DOCUMENTACAO",
  "ONBOARDING",
  "TESTE_OPERACIONAL",
  "EM_VALIDACAO",
  "ATIVA",
  "PREFERENCIAL",
];

// Saídas disponíveis em praticamente todo estágio ativo do funil.
const COMMON_EXITS: RecruitmentStatus[] = [
  "LIGACAO_SOLICITADA",
  "PRECISA_DE_AJUDA",
  "AGUARDANDO_COMPLEMENTACAO",
  "BASE_FUTURA",
  "DESISTIU",
  "PAUSADA",
  "REPROVADA",
];

// Combina os destinos "para frente" de um estágio com as saídas comuns, sem duplicar.
function stage(forward: RecruitmentStatus[]): RecruitmentStatus[] {
  return Array.from(new Set([...forward, ...COMMON_EXITS]));
}

export const ALLOWED_TRANSITIONS: Record<RecruitmentStatus, RecruitmentStatus[]> = {
  LEAD: stage(["PRE_CADASTRO"]),
  PRE_CADASTRO: stage(["TRIAGEM"]),
  TRIAGEM: stage(["CONVERSA_PENDENTE"]),
  CONVERSA_PENDENTE: stage(["ENTREVISTA"]),
  ENTREVISTA: stage(["REFERENCIA"]),
  REFERENCIA: stage(["PRE_APROVADA"]),
  PRE_APROVADA: stage(["DOCUMENTACAO"]),
  DOCUMENTACAO: stage(["ONBOARDING"]),
  ONBOARDING: stage(["TESTE_OPERACIONAL"]),
  TESTE_OPERACIONAL: stage(["EM_VALIDACAO"]),
  EM_VALIDACAO: stage(["ATIVA"]),
  ATIVA: ["PREFERENCIAL", "PAUSADA", "SUSPENSA"],
  PREFERENCIAL: ["ATIVA", "PAUSADA", "SUSPENSA"],
  // Estados de recuperação: retomam para qualquer estágio principal, sem reiniciar.
  LIGACAO_SOLICITADA: [...MAIN_STAGES, "DESISTIU", "BASE_FUTURA", "REPROVADA"],
  PRECISA_DE_AJUDA: [...MAIN_STAGES, "DESISTIU", "BASE_FUTURA", "LIGACAO_SOLICITADA"],
  AGUARDANDO_COMPLEMENTACAO: [
    ...MAIN_STAGES,
    "DESISTIU",
    "BASE_FUTURA",
    "LIGACAO_SOLICITADA",
    "REPROVADA",
  ],
  PAUSADA: [...MAIN_STAGES, "SUSPENSA", "DESISTIU"],
  SUSPENSA: ["ATIVA", "PREFERENCIAL", "DESISTIU"],
  BASE_FUTURA: ["PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "DESISTIU"],
  DESISTIU: [],
  REPROVADA: [],
};

export function transitionRecruitmentStatus(
  current: RecruitmentStatus,
  target: RecruitmentStatus,
): Result<RecruitmentStatus, DomainError> {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    return err(
      new DomainError(
        `Transição inválida de ${current} para ${target}`,
        "INVALID_RECRUITMENT_TRANSITION",
      ),
    );
  }
  return ok(target);
}
```

- [ ] **Step 5: Rodar o teste para vê-lo passar**

Run: `pnpm exec vitest run src/domain/recruitment/recruitment-state-machine.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 6: Verificar guardrail de arquitetura (domínio não importa infra)**

Run: `pnpm architecture:check`
Expected: PASS — o novo módulo só importa de `../shared`.

- [ ] **Step 7: Commit**

```bash
git add src/domain/recruitment
git commit -m "feat(recrutamento): maquina de estados do funil (dominio puro)"
```

---

### Task 3: Caso de uso `create-lead` (cadastro manual / lead cru)

**Files:**
- Create: `src/application/recruitment/create-lead.usecase.ts`
- Test: `src/application/recruitment/create-lead.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/application/recruitment/create-lead.usecase.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";
import type { PrismaClient } from "@prisma/client";

describe("createLeadUseCase", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  it("cria um lead com pré-cadastro preenchido pelo admin e grava evento + audit", async () => {
    const result = await createLeadUseCase(prisma, {
      actor: "admin:leo",
      origin: "CADASTRO_MANUAL",
      fullName: "Maria de Sousa",
      phoneE164: `+5585${Date.now()}`,
      neighborhood: "Parangaba",
      hasProfessionalExperience: true,
      experienceDuration: "GT_3Y",
      canServeInitialArea: "SIM",
      availabilityDays: ["TER", "QUI"],
      preferredCommunicationMode: "AUDIO",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lead = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: result.value.id } });
    expect(lead.status).toBe("LEAD");
    expect(lead.fullName).toBe("Maria de Sousa");

    const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("LEAD_CREATED");

    const audit = await prisma.auditLog.findMany({ where: { entityId: lead.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("LEAD_CREATED");
  });

  it("cria um lead cru só com origem (sem nome/telefone ainda)", async () => {
    const result = await createLeadUseCase(prisma, { actor: "admin:leo", origin: "WHATSAPP" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lead = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: result.value.id } });
    expect(lead.fullName).toBeNull();
    expect(lead.status).toBe("LEAD");
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/create-lead.usecase.integration.test.ts`
Expected: FAIL — `Cannot find module './create-lead.usecase'`.

- [ ] **Step 3: Implementar o caso de uso**

Create `src/application/recruitment/create-lead.usecase.ts`:

```ts
import type {
  AreaCompatibility,
  CommunicationMode,
  ExperienceDuration,
  InitialChannelPreference,
  LeadOrigin,
  Prisma,
  PrismaClient,
  RecruitmentLead,
  WhatsappAutonomy,
} from "@prisma/client";
import { ok, type Result } from "../../domain/shared/result";
import { DomainError } from "../../domain/shared/domain-error";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface CreateLeadInput {
  actor: string;
  origin: LeadOrigin;
  phoneE164?: string;
  fullName?: string;
  neighborhood?: string;
  campaign?: string;
  referralCode?: string;
  partnerName?: string;
  referredByProfessionalId?: string;
  originNote?: string;
  preferredCommunicationMode?: CommunicationMode;
  initialChannelPreference?: InitialChannelPreference;
  whatsappAutonomy?: WhatsappAutonomy;
  hasProfessionalExperience?: boolean;
  hasInformalExperience?: boolean;
  experienceDuration?: ExperienceDuration;
  canServeInitialArea?: AreaCompatibility;
  availabilityDays?: string[];
}

// Copia apenas as chaves opcionais definidas, respeitando exactOptionalPropertyTypes.
function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export async function createLeadUseCase(
  prisma: PrismaClient,
  input: CreateLeadInput,
): Promise<Result<RecruitmentLead, DomainError>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const { actor, availabilityDays, ...rest } = input;

    const lead = await tx.recruitmentLead.create({
      data: {
        origin: rest.origin,
        lastInteractionAt: new Date(),
        ...definedOnly({
          phoneE164: rest.phoneE164,
          fullName: rest.fullName,
          neighborhood: rest.neighborhood,
          campaign: rest.campaign,
          referralCode: rest.referralCode,
          partnerName: rest.partnerName,
          referredByProfessionalId: rest.referredByProfessionalId,
          originNote: rest.originNote,
          preferredCommunicationMode: rest.preferredCommunicationMode,
          initialChannelPreference: rest.initialChannelPreference,
          whatsappAutonomy: rest.whatsappAutonomy,
          hasProfessionalExperience: rest.hasProfessionalExperience,
          hasInformalExperience: rest.hasInformalExperience,
          experienceDuration: rest.experienceDuration,
          canServeInitialArea: rest.canServeInitialArea,
        }),
        ...(availabilityDays !== undefined
          ? { availabilityDays: availabilityDays as Prisma.InputJsonValue }
          : {}),
      },
    });

    await tx.leadEvent.create({
      data: {
        leadId: lead.id,
        type: "LEAD_CREATED",
        description: "Lead criado",
        actor,
      },
    });

    await recordAuditLog(tx, {
      actor,
      action: "LEAD_CREATED",
      entityType: "RecruitmentLead",
      entityId: lead.id,
      metadata: { origin: lead.origin },
    });

    return ok(lead);
  });
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/create-lead.usecase.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/recruitment/create-lead.usecase.ts src/application/recruitment/create-lead.usecase.integration.test.ts
git commit -m "feat(recrutamento): caso de uso create-lead com evento e auditoria"
```

---

### Task 4: Caso de uso `transition-lead-status` (override + promoção)

> Paralelizável com Tasks 5, 6, 7 (arquivos distintos). Depende de Tasks 1–3.

**Files:**
- Create: `src/application/recruitment/transition-lead-status.usecase.ts`
- Test: `src/application/recruitment/transition-lead-status.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/application/recruitment/transition-lead-status.usecase.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";
import { transitionLeadStatusUseCase } from "./transition-lead-status.usecase";
import type { PrismaClient, RecruitmentStatus } from "@prisma/client";

describe("transitionLeadStatusUseCase", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedLead(status: RecruitmentStatus = "LEAD") {
    const res = await createLeadUseCase(prisma, {
      actor: "system:test",
      origin: "WHATSAPP",
      fullName: "Maria",
      phoneE164: `+5585${Date.now()}${Math.floor(Math.random() * 1000)}`,
    });
    if (!res.ok) throw res.error;
    if (status !== "LEAD") {
      await prisma.recruitmentLead.update({ where: { id: res.value.id }, data: { status } });
    }
    return prisma.recruitmentLead.findUniqueOrThrow({ where: { id: res.value.id } });
  }

  it("transiciona, grava histórico, evento e audit", async () => {
    const lead = await seedLead("LEAD");
    const result = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "PRE_CADASTRO",
      actor: "admin:leo",
    });
    expect(result.ok).toBe(true);

    const updated = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("PRE_CADASTRO");
    expect(updated.version).toBe(1);

    const history = await prisma.recruitmentStatusHistory.findMany({ where: { leadId: lead.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: "LEAD", toStatus: "PRE_CADASTRO", override: false });

    const audit = await prisma.auditLog.findMany({
      where: { entityId: lead.id, action: "LEAD_STATUS_TRANSITION" },
    });
    expect(audit).toHaveLength(1);
  });

  it("rejeita transição inválida sem escrever nada", async () => {
    const lead = await seedLead("PRE_CADASTRO");
    const result = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "ATIVA",
      actor: "admin:leo",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RECRUITMENT_TRANSITION");
    const unchanged = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(unchanged.status).toBe("PRE_CADASTRO");
  });

  it("override permite transição fora do fluxo, exige motivo e é auditado", async () => {
    const lead = await seedLead("PRE_CADASTRO");
    const result = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "ATIVA",
      actor: "admin:leo",
      override: { reason: "Profissional já conhecida e validada offline" },
    });
    // ATIVA exige contato; sem promoção falharia — este lead tem nome+telefone.
    expect(result.ok).toBe(true);
    const history = await prisma.recruitmentStatusHistory.findMany({ where: { leadId: lead.id } });
    expect(history[0]).toMatchObject({ toStatus: "ATIVA", override: true });
    expect(history[0].reason).toBe("Profissional já conhecida e validada offline");
  });

  it("override sem motivo é rejeitado", async () => {
    const lead = await seedLead("PRE_CADASTRO");
    const result = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "REFERENCIA",
      actor: "admin:leo",
      override: { reason: "  " },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OVERRIDE_REASON_REQUIRED");
  });

  it("ao ativar, promove: cria User PROFESSIONAL + ProfessionalProfile vinculado", async () => {
    const lead = await seedLead("EM_VALIDACAO");
    const result = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "ATIVA",
      actor: "admin:leo",
    });
    expect(result.ok).toBe(true);
    const updated = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.professionalProfileId).not.toBeNull();
    const profile = await prisma.professionalProfile.findUniqueOrThrow({
      where: { id: updated.professionalProfileId! },
      include: { user: true },
    });
    expect(profile.user.role).toBe("PROFESSIONAL");
    expect(profile.user.fullName).toBe("Maria");
  });

  it("ativar sem nome/telefone falha na promoção", async () => {
    const res = await createLeadUseCase(prisma, { actor: "system:test", origin: "WHATSAPP" });
    if (!res.ok) throw res.error;
    await prisma.recruitmentLead.update({ where: { id: res.value.id }, data: { status: "EM_VALIDACAO" } });
    const result = await transitionLeadStatusUseCase(prisma, {
      leadId: res.value.id,
      targetStatus: "ATIVA",
      actor: "admin:leo",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROMOTION_REQUIRES_CONTACT");
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/transition-lead-status.usecase.integration.test.ts`
Expected: FAIL — `Cannot find module './transition-lead-status.usecase'`.

- [ ] **Step 3: Implementar o caso de uso**

Create `src/application/recruitment/transition-lead-status.usecase.ts`:

```ts
import type { Prisma, PrismaClient, RecruitmentLead } from "@prisma/client";
import { transitionRecruitmentStatus } from "../../domain/recruitment/recruitment-state-machine";
import type { RecruitmentStatus } from "../../domain/recruitment/recruitment-status";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface TransitionLeadStatusInput {
  leadId: string;
  targetStatus: RecruitmentStatus;
  actor: string;
  reason?: string;
  override?: { reason: string };
}

const TERMINAL_EVENT_DESCRIPTIONS: Partial<Record<RecruitmentStatus, string>> = {
  ATIVA: "Ativada",
  PAUSADA: "Pausada",
  SUSPENSA: "Suspensa",
  ENTREVISTA: "Entrevista iniciada",
  LIGACAO_SOLICITADA: "Ligação solicitada",
};

async function promoteToProfessional(
  tx: Prisma.TransactionClient,
  lead: RecruitmentLead,
): Promise<Result<string, DomainError>> {
  if (lead.professionalProfileId) return ok(lead.professionalProfileId);
  if (!lead.fullName || !lead.phoneE164) {
    return err(
      new DomainError(
        `Lead ${lead.id} não pode ser ativado sem nome e telefone`,
        "PROMOTION_REQUIRES_CONTACT",
      ),
    );
  }
  const user = await tx.user.create({
    data: { role: "PROFESSIONAL", fullName: lead.fullName, phoneE164: lead.phoneE164 },
  });
  const profile = await tx.professionalProfile.create({ data: { userId: user.id } });
  return ok(profile.id);
}

export async function transitionLeadStatusUseCase(
  prisma: PrismaClient,
  input: TransitionLeadStatusInput,
): Promise<Result<RecruitmentLead, DomainError>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.recruitmentLead.findUnique({ where: { id: input.leadId } });
    if (!current) {
      return err(new DomainError(`Lead ${input.leadId} não encontrado`, "LEAD_NOT_FOUND"));
    }

    const isOverride = input.override !== undefined;
    if (isOverride && input.override!.reason.trim() === "") {
      return err(
        new DomainError("Override exige motivo não vazio", "OVERRIDE_REASON_REQUIRED"),
      );
    }

    if (!isOverride) {
      const transition = transitionRecruitmentStatus(
        current.status as RecruitmentStatus,
        input.targetStatus,
      );
      if (!transition.ok) return err(transition.error);
    }

    // Promoção acontece antes do update de status para que ambos façam parte da mesma transação.
    let professionalProfileId = current.professionalProfileId;
    if (input.targetStatus === "ATIVA") {
      const promotion = await promoteToProfessional(tx, current);
      if (!promotion.ok) return err(promotion.error);
      professionalProfileId = promotion.value;
    }

    const updateResult = await tx.recruitmentLead.updateMany({
      where: { id: input.leadId, status: current.status },
      data: {
        status: input.targetStatus,
        version: { increment: 1 },
        lastInteractionAt: new Date(),
        ...(professionalProfileId !== current.professionalProfileId ? { professionalProfileId } : {}),
      },
    });
    if (updateResult.count === 0) {
      return err(
        new DomainError(
          `Lead ${input.leadId} foi alterado concorrentemente`,
          "LEAD_CONCURRENT_MODIFICATION",
        ),
      );
    }

    const reason = input.override?.reason ?? input.reason;
    await tx.recruitmentStatusHistory.create({
      data: {
        leadId: input.leadId,
        fromStatus: current.status,
        toStatus: input.targetStatus,
        actor: input.actor,
        override: isOverride,
        ...(reason !== undefined ? { reason } : {}),
      },
    });

    await tx.leadEvent.create({
      data: {
        leadId: input.leadId,
        type: `STATUS_${input.targetStatus}`,
        description: TERMINAL_EVENT_DESCRIPTIONS[input.targetStatus] ?? `Etapa: ${input.targetStatus}`,
        actor: input.actor,
      },
    });

    await recordAuditLog(tx, {
      actor: input.actor,
      action: "LEAD_STATUS_TRANSITION",
      entityType: "RecruitmentLead",
      entityId: input.leadId,
      metadata: { from: current.status, to: input.targetStatus, override: isOverride, reason },
    });

    const updated = await tx.recruitmentLead.findUniqueOrThrow({ where: { id: input.leadId } });
    return ok(updated);
  });
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/transition-lead-status.usecase.integration.test.ts`
Expected: PASS (todos os casos, incluindo promoção e override).

- [ ] **Step 5: Commit**

```bash
git add src/application/recruitment/transition-lead-status.usecase.ts src/application/recruitment/transition-lead-status.usecase.integration.test.ts
git commit -m "feat(recrutamento): transicao de status com override auditado e promocao a profissional"
```

---

### Task 5: Casos de uso de notas internas (add/edit/delete + revisões)

> Paralelizável com Tasks 4, 6, 7. Depende de Tasks 1–3.

**Files:**
- Create: `src/application/recruitment/lead-notes.usecase.ts`
- Test: `src/application/recruitment/lead-notes.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/application/recruitment/lead-notes.usecase.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";
import { addLeadNote, editLeadNote, deleteLeadNote, setLeadNotePinned } from "./lead-notes.usecase";
import type { PrismaClient } from "@prisma/client";

describe("lead notes", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedLead() {
    const res = await createLeadUseCase(prisma, { actor: "system:test", origin: "WHATSAPP" });
    if (!res.ok) throw res.error;
    return res.value;
  }

  it("adiciona nota com autor, tipo e evento na timeline", async () => {
    const lead = await seedLead();
    const res = await addLeadNote(prisma, {
      leadId: lead.id,
      author: "admin:leo",
      type: "ENTREVISTA",
      content: "Trabalha há 6 anos, Aldeota.",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const note = await prisma.leadNote.findUniqueOrThrow({ where: { id: res.value.id } });
    expect(note.type).toBe("ENTREVISTA");
    expect(note.author).toBe("admin:leo");
    const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id, type: "NOTE_ADDED" } });
    expect(events).toHaveLength(1);
  });

  it("editar cria uma revisão com o conteúdo anterior e marca editedAt", async () => {
    const lead = await seedLead();
    const created = await addLeadNote(prisma, { leadId: lead.id, author: "admin:leo", content: "v1" });
    if (!created.ok) throw created.error;
    const edited = await editLeadNote(prisma, {
      noteId: created.value.id,
      editedBy: "admin:leo",
      content: "v2",
    });
    expect(edited.ok).toBe(true);
    const note = await prisma.leadNote.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(note.content).toBe("v2");
    expect(note.editedAt).not.toBeNull();
    const revisions = await prisma.leadNoteRevision.findMany({ where: { noteId: created.value.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].previousContent).toBe("v1");
  });

  it("excluir é lógico (deletedAt) e auditado", async () => {
    const lead = await seedLead();
    const created = await addLeadNote(prisma, { leadId: lead.id, author: "admin:leo", content: "x" });
    if (!created.ok) throw created.error;
    const res = await deleteLeadNote(prisma, { noteId: created.value.id, actor: "admin:leo" });
    expect(res.ok).toBe(true);
    const note = await prisma.leadNote.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(note.deletedAt).not.toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { entityId: created.value.id, action: "LEAD_NOTE_DELETED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("fixar e desfixar alterna pinned", async () => {
    const lead = await seedLead();
    const created = await addLeadNote(prisma, { leadId: lead.id, author: "admin:leo", content: "y" });
    if (!created.ok) throw created.error;
    await setLeadNotePinned(prisma, { noteId: created.value.id, pinned: true, actor: "admin:leo" });
    const note = await prisma.leadNote.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(note.pinned).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/lead-notes.usecase.integration.test.ts`
Expected: FAIL — `Cannot find module './lead-notes.usecase'`.

- [ ] **Step 3: Implementar os casos de uso**

Create `src/application/recruitment/lead-notes.usecase.ts`:

```ts
import type { LeadNote, LeadNoteType, Prisma, PrismaClient } from "@prisma/client";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface AddLeadNoteInput {
  leadId: string;
  author: string;
  content: string;
  type?: LeadNoteType;
  pinned?: boolean;
}

export async function addLeadNote(
  prisma: PrismaClient,
  input: AddLeadNoteInput,
): Promise<Result<LeadNote, DomainError>> {
  if (input.content.trim() === "") {
    return err(new DomainError("Nota não pode ser vazia", "NOTE_CONTENT_REQUIRED"));
  }
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const note = await tx.leadNote.create({
      data: {
        leadId: input.leadId,
        author: input.author,
        content: input.content,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      },
    });
    await tx.leadEvent.create({
      data: { leadId: input.leadId, type: "NOTE_ADDED", description: "Nota adicionada", actor: input.author },
    });
    return ok(note);
  });
}

export interface EditLeadNoteInput {
  noteId: string;
  editedBy: string;
  content: string;
}

export async function editLeadNote(
  prisma: PrismaClient,
  input: EditLeadNoteInput,
): Promise<Result<LeadNote, DomainError>> {
  if (input.content.trim() === "") {
    return err(new DomainError("Nota não pode ser vazia", "NOTE_CONTENT_REQUIRED"));
  }
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.leadNote.findUnique({ where: { id: input.noteId } });
    if (!current) return err(new DomainError(`Nota ${input.noteId} não encontrada`, "NOTE_NOT_FOUND"));

    await tx.leadNoteRevision.create({
      data: { noteId: current.id, previousContent: current.content, editedBy: input.editedBy },
    });
    const updated = await tx.leadNote.update({
      where: { id: input.noteId },
      data: { content: input.content, editedAt: new Date() },
    });
    return ok(updated);
  });
}

export interface DeleteLeadNoteInput {
  noteId: string;
  actor: string;
}

export async function deleteLeadNote(
  prisma: PrismaClient,
  input: DeleteLeadNoteInput,
): Promise<Result<LeadNote, DomainError>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const note = await tx.leadNote.update({
      where: { id: input.noteId },
      data: { deletedAt: new Date() },
    });
    await recordAuditLog(tx, {
      actor: input.actor,
      action: "LEAD_NOTE_DELETED",
      entityType: "LeadNote",
      entityId: input.noteId,
    });
    return ok(note);
  });
}

export interface SetLeadNotePinnedInput {
  noteId: string;
  pinned: boolean;
  actor: string;
}

export async function setLeadNotePinned(
  prisma: PrismaClient,
  input: SetLeadNotePinnedInput,
): Promise<Result<LeadNote, DomainError>> {
  const note = await prisma.leadNote.update({
    where: { id: input.noteId },
    data: { pinned: input.pinned },
  });
  return ok(note);
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/lead-notes.usecase.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/recruitment/lead-notes.usecase.ts src/application/recruitment/lead-notes.usecase.integration.test.ts
git commit -m "feat(recrutamento): notas internas com revisoes, exclusao logica e fixar"
```

---

### Task 6: Casos de uso de próxima-ação e lembretes

> Paralelizável com Tasks 4, 5, 7. Depende de Tasks 1–3.

**Files:**
- Create: `src/application/recruitment/lead-next-action.usecase.ts`
- Test: `src/application/recruitment/lead-next-action.usecase.integration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/application/recruitment/lead-next-action.usecase.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";
import { setNextAction, createReminder, completeReminder } from "./lead-next-action.usecase";
import type { PrismaClient } from "@prisma/client";

describe("lead next-action e lembretes", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedLead() {
    const res = await createLeadUseCase(prisma, { actor: "system:test", origin: "WHATSAPP" });
    if (!res.ok) throw res.error;
    return res.value;
  }

  it("define próxima ação e prazo", async () => {
    const lead = await seedLead();
    const when = new Date(Date.now() + 3600_000);
    const res = await setNextAction(prisma, {
      leadId: lead.id,
      actor: "admin:leo",
      nextAction: "Ligar para profissional",
      nextActionAt: when,
    });
    expect(res.ok).toBe(true);
    const updated = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.nextAction).toBe("Ligar para profissional");
    expect(updated.nextActionAt?.getTime()).toBe(when.getTime());
  });

  it("cria e conclui um lembrete", async () => {
    const lead = await seedLead();
    const res = await createReminder(prisma, {
      leadId: lead.id,
      createdBy: "admin:leo",
      text: "Retornar ligação para Maria",
      dueAt: new Date(Date.now() + 7200_000),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const done = await completeReminder(prisma, { reminderId: res.value.id });
    expect(done.ok).toBe(true);
    const reminder = await prisma.leadReminder.findUniqueOrThrow({ where: { id: res.value.id } });
    expect(reminder.doneAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/lead-next-action.usecase.integration.test.ts`
Expected: FAIL — `Cannot find module './lead-next-action.usecase'`.

- [ ] **Step 3: Implementar os casos de uso**

Create `src/application/recruitment/lead-next-action.usecase.ts`:

```ts
import type { LeadReminder, Prisma, PrismaClient, RecruitmentLead } from "@prisma/client";
import { ok, type Result } from "../../domain/shared/result";
import { DomainError } from "../../domain/shared/domain-error";

export interface SetNextActionInput {
  leadId: string;
  actor: string;
  nextAction: string | null;
  nextActionAt?: Date | null;
}

export async function setNextAction(
  prisma: PrismaClient,
  input: SetNextActionInput,
): Promise<Result<RecruitmentLead, DomainError>> {
  const lead = await prisma.recruitmentLead.update({
    where: { id: input.leadId },
    data: {
      nextAction: input.nextAction,
      ...(input.nextActionAt !== undefined ? { nextActionAt: input.nextActionAt } : {}),
    },
  });
  return ok(lead);
}

export interface CreateReminderInput {
  leadId: string;
  createdBy: string;
  text: string;
  dueAt: Date;
}

export async function createReminder(
  prisma: PrismaClient,
  input: CreateReminderInput,
): Promise<Result<LeadReminder, DomainError>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const reminder = await tx.leadReminder.create({
      data: { leadId: input.leadId, createdBy: input.createdBy, text: input.text, dueAt: input.dueAt },
    });
    await tx.leadEvent.create({
      data: { leadId: input.leadId, type: "REMINDER_CREATED", description: `Lembrete: ${input.text}`, actor: input.createdBy },
    });
    return ok(reminder);
  });
}

export interface CompleteReminderInput {
  reminderId: string;
}

export async function completeReminder(
  prisma: PrismaClient,
  input: CompleteReminderInput,
): Promise<Result<LeadReminder, DomainError>> {
  const reminder = await prisma.leadReminder.update({
    where: { id: input.reminderId },
    data: { doneAt: new Date() },
  });
  return ok(reminder);
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/lead-next-action.usecase.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/recruitment/lead-next-action.usecase.ts src/application/recruitment/lead-next-action.usecase.integration.test.ts
git commit -m "feat(recrutamento): proxima acao e lembretes internos"
```

---

### Task 7: Read model do Kanban (agrupamento + "precisa de mim" + busca)

> Paralelizável com Tasks 4, 5, 6. Depende de Tasks 1–3.

**Files:**
- Create: `src/application/recruitment/kanban-read-model.ts`
- Test: `src/application/recruitment/kanban-read-model.integration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/application/recruitment/kanban-read-model.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";
import { getKanbanBoard, KANBAN_COLUMNS, searchLeads, getNeedsMeLeads } from "./kanban-read-model";
import type { PrismaClient, RecruitmentStatus } from "@prisma/client";

describe("kanban read model", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedLead(status: RecruitmentStatus, fullName: string) {
    const res = await createLeadUseCase(prisma, {
      actor: "system:test",
      origin: "WHATSAPP",
      fullName,
      phoneE164: `+5585${Date.now()}${Math.floor(Math.random() * 10000)}`,
      neighborhood: "Aldeota",
    });
    if (!res.ok) throw res.error;
    if (status !== "LEAD") {
      await prisma.recruitmentLead.update({ where: { id: res.value.id }, data: { status } });
    }
    return res.value.id;
  }

  it("agrupa leads nas colunas corretas e exclui estados arquivados", async () => {
    await seedLead("CONVERSA_PENDENTE", "Ana");
    await seedLead("REPROVADA", "Bia"); // não deve aparecer em coluna
    const board = await getKanbanBoard(prisma);
    const conversa = board.find((c) => c.status === "CONVERSA_PENDENTE");
    expect(conversa?.leads.some((l) => l.fullName === "Ana")).toBe(true);
    // REPROVADA não é coluna do board
    expect(KANBAN_COLUMNS).not.toContain("REPROVADA");
    expect(board.some((c) => c.leads.some((l) => l.fullName === "Bia"))).toBe(false);
  });

  it("filtro 'precisa de mim' traz ligação solicitada e follow-up vencido", async () => {
    const ligacao = await seedLead("LIGACAO_SOLICITADA", "Carla");
    const overdue = await seedLead("CONVERSA_PENDENTE", "Duda");
    await prisma.recruitmentLead.update({
      where: { id: overdue },
      data: { nextAction: "Ligar", nextActionAt: new Date(Date.now() - 3600_000) },
    });
    const needs = await getNeedsMeLeads(prisma);
    const ids = needs.map((l) => l.id);
    expect(ids).toContain(ligacao);
    expect(ids).toContain(overdue);
  });

  it("busca por nome e por bairro", async () => {
    await seedLead("TRIAGEM", "Fernanda Lima");
    const byName = await searchLeads(prisma, "fernanda");
    expect(byName.some((l) => l.fullName === "Fernanda Lima")).toBe(true);
    const byHood = await searchLeads(prisma, "aldeota");
    expect(byHood.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/kanban-read-model.integration.test.ts`
Expected: FAIL — `Cannot find module './kanban-read-model'`.

- [ ] **Step 3: Implementar o read model**

Create `src/application/recruitment/kanban-read-model.ts`:

```ts
import type { PrismaClient, RecruitmentLead } from "@prisma/client";
import type { RecruitmentStatus } from "../../domain/recruitment/recruitment-status";

// Colunas do Kanban, na ordem do §22. Estados arquivados (REPROVADA/DESISTIU/
// SUSPENSA/PAUSADA/PRECISA_DE_AJUDA/AGUARDANDO_COMPLEMENTACAO/PREFERENCIAL) não
// são colunas — acessíveis por filtro/busca.
export const KANBAN_COLUMNS: RecruitmentStatus[] = [
  "LEAD",
  "PRE_CADASTRO",
  "TRIAGEM",
  "CONVERSA_PENDENTE",
  "LIGACAO_SOLICITADA",
  "REFERENCIA",
  "DOCUMENTACAO",
  "ONBOARDING",
  "TESTE_OPERACIONAL",
  "EM_VALIDACAO",
  "ATIVA",
  "BASE_FUTURA",
];

export const KANBAN_COLUMN_LABELS: Record<string, string> = {
  LEAD: "Novos leads",
  PRE_CADASTRO: "Pré-cadastro",
  TRIAGEM: "Triagem",
  CONVERSA_PENDENTE: "Conversa pendente",
  LIGACAO_SOLICITADA: "Ligação solicitada",
  REFERENCIA: "Referência",
  DOCUMENTACAO: "Documentação",
  ONBOARDING: "Onboarding",
  TESTE_OPERACIONAL: "Teste",
  EM_VALIDACAO: "Em validação",
  ATIVA: "Ativas",
  BASE_FUTURA: "Base futura",
};

export interface KanbanColumn {
  status: RecruitmentStatus;
  label: string;
  leads: RecruitmentLead[];
}

export async function getKanbanBoard(prisma: PrismaClient): Promise<KanbanColumn[]> {
  const leads = await prisma.recruitmentLead.findMany({
    where: { status: { in: KANBAN_COLUMNS } },
    orderBy: { updatedAt: "desc" },
  });
  return KANBAN_COLUMNS.map((status) => ({
    status,
    label: KANBAN_COLUMN_LABELS[status],
    leads: leads.filter((l) => l.status === status),
  }));
}

export async function getNeedsMeLeads(prisma: PrismaClient): Promise<RecruitmentLead[]> {
  const now = new Date();
  return prisma.recruitmentLead.findMany({
    where: {
      OR: [
        { status: "LIGACAO_SOLICITADA" },
        { status: "PRECISA_DE_AJUDA" },
        { status: "AGUARDANDO_COMPLEMENTACAO" },
        { nextActionAt: { lt: now } },
      ],
    },
    orderBy: { nextActionAt: "asc" },
  });
}

export async function searchLeads(prisma: PrismaClient, term: string): Promise<RecruitmentLead[]> {
  const q = term.trim();
  if (q === "") return [];
  return prisma.recruitmentLead.findMany({
    where: {
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { phoneE164: { contains: q, mode: "insensitive" } },
        { neighborhood: { contains: q, mode: "insensitive" } },
        { notes: { some: { content: { contains: q, mode: "insensitive" }, deletedAt: null } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm exec vitest run --testTimeout=60000 src/application/recruitment/kanban-read-model.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/recruitment/kanban-read-model.ts src/application/recruitment/kanban-read-model.integration.test.ts
git commit -m "feat(recrutamento): read model do Kanban com filtro 'precisa de mim' e busca"
```

---

### Task 8: Instalar `@dnd-kit` (dependência nova — ficha §14)

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `docs/adr/0003-dnd-kit-para-kanban.md`

- [ ] **Step 1: Registrar a justificativa (ficha §14 do briefing)**

Create `docs/adr/0003-dnd-kit-para-kanban.md`:

```markdown
# ADR 0003: `@dnd-kit` para drag-and-drop do Kanban de profissionais

**Data:** 2026-08-07
**Status:** Aceito

## Contexto
O Kanban do funil de recrutamento (KAIKAO §22–24) exige drag-and-drop entre
colunas com validação de transição e acessibilidade por teclado. O roadmap
fixou shadcn/ui + TanStack Table, que não cobrem DnD.

## Decisão
Adotar `@dnd-kit/core` + `@dnd-kit/sortable`.

## Alternativas descartadas
- `react-beautiful-dnd`: sem manutenção ativa; incompatibilidades com React 19.
- HTML5 Drag and Drop nativo: acessibilidade fraca, difícil suporte a teclado.

## Consequências
- Nova dependência de UI (camada de apresentação apenas; não entra no domínio).
- Mitigação de acessibilidade: além do DnD, expor mover-via-menu no cartão.
```

- [ ] **Step 2: Instalar as libs**

Run: `pnpm add @dnd-kit/core @dnd-kit/sortable`
Expected: adiciona as duas dependências a `package.json` e atualiza o lockfile.

- [ ] **Step 3: Verificar build/typecheck ainda passam**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml docs/adr/0003-dnd-kit-para-kanban.md
git commit -m "chore(recrutamento): adiciona @dnd-kit para o Kanban (ADR 0003)"
```

---

### Task 9: Kanban board com drag-and-drop + Server Actions

> Depende de Tasks 4, 7, 8. UI — sem TDD unitário; validação por E2E na Task 13.

**Files:**
- Create: `src/app/admin/recruitment/actions.ts`
- Create: `src/app/admin/recruitment/page.tsx`
- Create: `src/app/admin/recruitment/kanban-board.tsx`
- Create: `src/app/admin/recruitment/lead-card.tsx`

- [ ] **Step 1: Criar as Server Actions**

Create `src/app/admin/recruitment/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/infrastructure/db/prisma-client";
import { transitionLeadStatusUseCase } from "@/application/recruitment/transition-lead-status.usecase";
import { addLeadNote } from "@/application/recruitment/lead-notes.usecase";
import { createLeadUseCase } from "@/application/recruitment/create-lead.usecase";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";
import type { LeadOrigin } from "@prisma/client";

const ACTOR = "admin"; // Fase 1 tem papel único ADMIN; refinar com sessão em sub-spec posterior.

export async function moveLeadAction(input: {
  leadId: string;
  targetStatus: RecruitmentStatus;
  overrideReason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await transitionLeadStatusUseCase(prisma, {
    leadId: input.leadId,
    targetStatus: input.targetStatus,
    actor: ACTOR,
    ...(input.overrideReason ? { override: { reason: input.overrideReason } } : {}),
  });
  revalidatePath("/admin/recruitment");
  if (!result.ok) return { ok: false, error: result.error.message };
  return { ok: true };
}

export async function addQuickNoteAction(input: {
  leadId: string;
  content: string;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await addLeadNote(prisma, { leadId: input.leadId, author: ACTOR, content: input.content });
  revalidatePath("/admin/recruitment");
  if (!result.ok) return { ok: false, error: result.error.message };
  return { ok: true };
}

export async function createLeadAction(input: {
  origin: LeadOrigin;
  fullName?: string;
  phoneE164?: string;
  neighborhood?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await createLeadUseCase(prisma, { actor: ACTOR, ...input });
  revalidatePath("/admin/recruitment");
  if (!result.ok) return { ok: false, error: result.error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Criar a página (Server Component)**

Create `src/app/admin/recruitment/page.tsx`:

```tsx
import { prisma } from "@/infrastructure/db/prisma-client";
import { getKanbanBoard } from "@/application/recruitment/kanban-read-model";
import { KanbanBoard } from "./kanban-board";
import { NewLeadForm } from "./new-lead-form";

export default async function RecruitmentPage() {
  const board = await getKanbanBoard(prisma);
  return (
    <section>
      <h1>Profissionais — Funil</h1>
      <NewLeadForm />
      <KanbanBoard
        columns={board.map((c) => ({
          status: c.status,
          label: c.label,
          leads: c.leads.map((l) => ({
            id: l.id,
            fullName: l.fullName,
            neighborhood: l.neighborhood,
            origin: l.origin,
            nextAction: l.nextAction,
            nextActionAt: l.nextActionAt ? l.nextActionAt.toISOString() : null,
            preferredCommunicationMode: l.preferredCommunicationMode,
          })),
        }))}
      />
    </section>
  );
}
```

- [ ] **Step 3: Criar o board client com dnd-kit**

Create `src/app/admin/recruitment/kanban-board.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { LeadCard, type LeadCardData } from "./lead-card";
import { moveLeadAction } from "./actions";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";

export interface KanbanColumnData {
  status: RecruitmentStatus;
  label: string;
  leads: LeadCardData[];
}

export function KanbanBoard({ columns }: { columns: KanbanColumnData[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const leadId = String(event.active.id);
    const targetStatus = event.over?.id as RecruitmentStatus | undefined;
    if (!targetStatus) return;
    setError(null);
    const res = await moveLeadAction({ leadId, targetStatus });
    if (!res.ok) {
      setError(res.error ?? "Movimento não permitido.");
      return;
    }
    router.refresh();
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {error ? <p role="alert" data-testid="kanban-error">{error}</p> : null}
      <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
        {columns.map((col) => (
          <KanbanColumn key={col.status} column={col} />
        ))}
      </div>
    </DndContext>
  );
}

function KanbanColumn({ column }: { column: KanbanColumnData }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <div
      ref={setNodeRef}
      data-testid={`column-${column.status}`}
      style={{ minWidth: 240, background: isOver ? "#eef" : "#f4f4f4", padding: 8, borderRadius: 8 }}
    >
      <h2 style={{ fontSize: 14 }}>
        {column.label} ({column.leads.length})
      </h2>
      {column.leads.map((lead) => (
        <LeadCard key={lead.id} lead={lead} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Criar o cartão**

Create `src/app/admin/recruitment/lead-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { QuickNoteModal } from "./quick-note-modal";

export interface LeadCardData {
  id: string;
  fullName: string | null;
  neighborhood: string | null;
  origin: string;
  nextAction: string | null;
  nextActionAt: string | null;
  preferredCommunicationMode: string | null;
}

export function LeadCard({ lead }: { lead: LeadCardData }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: lead.id });
  const overdue = lead.nextActionAt !== null && new Date(lead.nextActionAt) < new Date();
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, background: "#fff", border: "1px solid #ddd", borderRadius: 6, padding: 8, margin: "6px 0" }}
      data-testid={`card-${lead.id}`}
    >
      <div ref={setNodeRef} {...listeners} {...attributes} style={{ cursor: "grab" }}>
        <strong>{lead.fullName ?? "(sem nome)"}</strong>
        <div>📍 {lead.neighborhood ?? "—"}</div>
        <div>📱 {lead.origin}</div>
        {lead.preferredCommunicationMode === "AUDIO" ? <div>🎤 Prefere áudio</div> : null}
        {lead.nextAction ? (
          <div style={{ color: overdue ? "crimson" : "inherit" }}>
            {overdue ? "🔴 ATRASADO — " : "📞 "}
            {lead.nextAction}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <QuickNoteModal leadId={lead.id} />
        <Link href={`/admin/recruitment/${lead.id}`}>Abrir</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rodar typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/recruitment/actions.ts src/app/admin/recruitment/page.tsx src/app/admin/recruitment/kanban-board.tsx src/app/admin/recruitment/lead-card.tsx
git commit -m "feat(recrutamento): Kanban com drag-and-drop e server actions"
```

---

### Task 10: Modal de nota rápida no cartão

> Depende de Task 9.

**Files:**
- Create: `src/app/admin/recruitment/quick-note-modal.tsx`

- [ ] **Step 1: Criar o modal**

Create `src/app/admin/recruitment/quick-note-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addQuickNoteAction } from "./actions";

export function QuickNoteModal({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (content.trim() === "") return;
    setSaving(true);
    await addQuickNoteAction({ leadId, content });
    setSaving(false);
    setContent("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid={`quick-note-${leadId}`}>
        + Nota
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="Nota interna" style={{ border: "1px solid #ccc", padding: 8 }}>
      <textarea
        aria-label="Escrever nota interna"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/recruitment/quick-note-modal.tsx
git commit -m "feat(recrutamento): nota rapida direto no cartao do Kanban"
```

---

### Task 11: Formulário de cadastro manual

> Depende de Task 9.

**Files:**
- Create: `src/app/admin/recruitment/new-lead-form.tsx`

- [ ] **Step 1: Criar o formulário**

Create `src/app/admin/recruitment/new-lead-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction } from "./actions";

export function NewLeadForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const res = await createLeadAction({
      origin: "CADASTRO_MANUAL",
      fullName: fullName || undefined,
      phoneE164: phoneE164 || undefined,
      neighborhood: neighborhood || undefined,
    });
    if (!res.ok) {
      setError(res.error ?? "Não foi possível criar o lead.");
      return;
    }
    setFullName("");
    setPhoneE164("");
    setNeighborhood("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="new-lead">
        + Cadastro manual
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 8, marginBottom: 12 }}>
      <label>
        Nome
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label>
        Telefone
        <input value={phoneE164} onChange={(e) => setPhoneE164(e.target.value)} />
      </label>
      <label>
        Bairro
        <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={submit}>
        Salvar
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancelar
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/recruitment/new-lead-form.tsx
git commit -m "feat(recrutamento): cadastro manual de lead pelo dashboard"
```

---

### Task 12: Perfil do profissional + linha do tempo

> Depende de Tasks 4–7.

**Files:**
- Create: `src/app/admin/recruitment/[leadId]/page.tsx`

- [ ] **Step 1: Criar a página de perfil**

Create `src/app/admin/recruitment/[leadId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/infrastructure/db/prisma-client";

export default async function LeadProfilePage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const lead = await prisma.recruitmentLead.findUnique({
    where: { id: leadId },
    include: {
      notes: { where: { deletedAt: null }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] },
      events: { orderBy: { occurredAt: "desc" } },
      reminders: { orderBy: { dueAt: "asc" } },
      history: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) notFound();

  return (
    <article>
      <h1>{lead.fullName ?? "(sem nome)"}</h1>
      <section>
        <h2>Resumo</h2>
        <p>📞 {lead.phoneE164 ?? "—"}</p>
        <p>📍 {lead.neighborhood ?? "—"}</p>
        <p>Origem: {lead.origin}</p>
        <p>Status: {lead.status}</p>
        <p>Preferência: {lead.preferredCommunicationMode ?? "—"}</p>
      </section>

      <section>
        <h2>Notas internas</h2>
        <ul>
          {lead.notes.map((n) => (
            <li key={n.id} data-testid="note-item">
              {n.pinned ? "📌 " : ""}
              <strong>{n.type}</strong> — {n.content}
              <em> ({n.author}{n.editedAt ? ", editada" : ""})</em>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Linha do tempo</h2>
        <ul>
          {lead.events.map((e) => (
            <li key={e.id}>
              {e.occurredAt.toISOString().slice(0, 16).replace("T", " ")} — {e.description} ({e.actor})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Etapas seguintes</h2>
        <p>Entrevista, referências, documentos, onboarding e teste — em breve (sub-specs 5–7).</p>
      </section>
    </article>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/recruitment/[leadId]/page.tsx"
git commit -m "feat(recrutamento): perfil do profissional com notas e linha do tempo"
```

---

### Task 13: E2E do Kanban (Playwright)

> Depende de Tasks 9–12.

**Files:**
- Modify: `tests/e2e/seed.ts` (adicionar seed de leads)
- Create: `tests/e2e/recruitment-kanban.spec.ts`

- [ ] **Step 1: Adicionar seed de leads ao globalSetup**

Em `tests/e2e/seed.ts`, dentro do `try` do `globalSetup`, após o bloco que cria o admin (antes do `finally`), inserir:

```ts
    // Seed de leads para o E2E do Kanban (idempotente por telefone conhecido).
    const seedPhone = "+5585990000001";
    const existingLead = await prisma.recruitmentLead.findFirst({ where: { phoneE164: seedPhone } });
    if (!existingLead) {
      await prisma.recruitmentLead.create({
        data: {
          origin: "INDICACAO_PROFISSIONAL",
          status: "PRE_CADASTRO",
          fullName: "Maria de Sousa",
          phoneE164: seedPhone,
          neighborhood: "Parangaba",
          preferredCommunicationMode: "AUDIO",
        },
      });
    }
```

- [ ] **Step 2: Escrever o teste E2E**

Create `tests/e2e/recruitment-kanban.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("Kanban mostra o lead na coluna correta e permite nota rápida", async ({ page }) => {
  await page.goto("/admin/recruitment");
  await expect(page.getByText("Profissionais — Funil")).toBeVisible();

  const preCadastro = page.getByTestId("column-PRE_CADASTRO");
  await expect(preCadastro.getByText("Maria de Sousa")).toBeVisible();

  // Nota rápida: abre modal, salva.
  await preCadastro.getByText("Maria de Sousa").locator("..").getByText("+ Nota").first().click();
  await page.getByLabel("Escrever nota interna").fill("Retornar após 14h");
  await page.getByRole("button", { name: "Salvar" }).click();
});

test("cadastro manual cria um novo lead na coluna Novos leads", async ({ page }) => {
  await page.goto("/admin/recruitment");
  await page.getByTestId("new-lead").click();
  await page.getByLabel("Nome").fill("Joana Teste");
  await page.getByLabel("Bairro").fill("Meireles");
  await page.getByRole("button", { name: "Salvar" }).click();

  const novos = page.getByTestId("column-LEAD");
  await expect(novos.getByText("Joana Teste")).toBeVisible();
});
```

- [ ] **Step 3: Rodar os E2E**

Run: `pnpm test:e2e`
Expected: PASS (os testes de login existentes + os dois novos). Requer banco local rodando (`docker compose up -d`) e migrations aplicadas (`pnpm prisma:deploy`).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/recruitment-kanban.spec.ts tests/e2e/seed.ts
git commit -m "test(recrutamento): E2E do Kanban (colunas, nota rapida, cadastro manual)"
```

---

### Task 14: Verificação final (CI completo)

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar a suíte de CI completa**

Run: `pnpm ci:check`
Expected: PASS em todas as etapas — `lint`, `typecheck`, `architecture:check`, `dead-code:check` (knip), `test` (unit) e `build`.

Se `knip` acusar export não usado, verifique se todo caso de uso está referenciado por uma Server Action, página ou teste. `KANBAN_COLUMN_LABELS` é usado pela página; `getNeedsMeLeads`/`searchLeads` devem ser referenciados — se ainda não houver UI para eles neste sub-spec, exponha-os via uma pequena UI de filtro/busca na `page.tsx` (input que chama uma Server Action `searchLeadsAction`) OU remova-os deste sub-spec. **Decisão:** manter e ligar um input de busca simples na `page.tsx` que chama uma nova `searchLeadsAction` (mantém o read model coberto e evita dead code).

- [ ] **Step 2: Rodar a suíte de integração**

Run: `docker compose up -d && pnpm test:integration`
Expected: PASS (todos os `*.integration.test.ts` de recrutamento, via Testcontainers).

- [ ] **Step 3: Commit final (se houve ajuste de busca)**

```bash
git add -A
git commit -m "chore(recrutamento): liga busca na page e fecha verificacao de CI"
```

---

## Self-Review (cobertura do spec)

- **Modelo de dados (Seção A):** Task 1. ✅
- **Máquina de estados + override + promoção (Seção B):** Tasks 2, 4. ✅
- **Kanban/notas/next-action/reminders/perfil/timeline (Seção C):** Tasks 5–7, 9–12. ✅
- **Cadastro manual (§40):** Tasks 3, 11, 13. ✅
- **Testes (Seção D):** Tasks 2 (unit), 3–7 (integração), 13 (E2E). ✅
- **`dnd-kit` + ficha §14:** Task 8. ✅
- **Filtro "Precisa de mim" e busca (§31–32):** Task 7 + ligação de UI na Task 14. ✅
- **Notas nunca enviadas ao profissional (§25):** garantido — não há caminho de saída para mensageria neste sub-spec.

**Fora deste sub-spec (sub-specs seguintes):** automação WhatsApp/ConversationEngine, áudio, entrevista/referência/documentos/onboarding/teste/validação, métricas, configurações — conforme decomposição no spec.
```

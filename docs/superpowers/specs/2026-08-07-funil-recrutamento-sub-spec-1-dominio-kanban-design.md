# Funil de Recrutamento de Profissionais — Sub-spec 1: Domínio + Kanban + Notas

**Data:** 2026-08-07
**Status:** Aprovado para escrever plano de implementação
**Escopo maior (KAIKAO):** funil completo de aquisição → triagem → seleção → onboarding → ativação de profissionais, operável por uma pessoa, com automação WhatsApp. Este documento cobre **apenas o Sub-spec 1**.

## Contexto e diagnóstico

Só a **Fase 1 (Fundação)** do roadmap (`docs/product/allset-mvp-roadmap.md`) está pronta. As Fases 2–7 (mensageria genérica, dashboard, `ConversationEngine`, fluxo do profissional, automações pg-boss, Evolution API) **não existem** (grep = 0 arquivos para `Messaging`, `Conversation`, `Outbox`, `pg-boss`, `ConversationEngine`).

Consequência: o adendo **"Automação Obrigatória do WhatsApp"** do KAIKAO depende da camada de mensageria + motor de conversas, que ainda não foram construídos, e **não faz parte deste sub-spec**. A parte do KAIKAO implementável hoje — e que o próprio §44.7 pede primeiro — é **modelo de estados + Kanban + notas internas + próxima-ação/follow-ups**, que é domínio puro + UI de dashboard, sem dependência de mensageria.

O KAIKAO será decomposto em vários sub-specs (ver "Decomposição do escopo maior" ao final). **Este é o Sub-spec 1.**

### Reutilizável já existente (Fase 1)

- Padrão de **máquina de estados**: `src/domain/booking/booking-state-machine.ts` (`ALLOWED_TRANSITIONS` + `transitionBookingStatus()` → `Result`). Molde direto para o funil.
- Padrão de **caso de uso de transição**: `src/application/booking/transition-booking-status.usecase.ts` (transação atômica + `version` para concorrência otimista + `BookingStatusHistory` + `AuditLog`).
- `AuditLog` (modelo Prisma + `record-audit-log.usecase.ts`).
- `StorageProvider` (port + `local`/`in-memory`) — usado em sub-specs posteriores (áudios/documentos), **não** neste.
- `ProfessionalProfile` (mínimo: `reviewStatus`, `pixKey`) — alvo da promoção.
- Better Auth admin, camadas de domínio, guardrails dependency-cruiser/Knip.

## Decisão de modelagem: Lead separado que "gradua"

Introduzir a entidade **`RecruitmentLead`**, independente de `User`/`ProfessionalProfile`. Quando o lead atinge `ATIVA`, ocorre a **promoção**: cria-se (ou vincula-se) `User(role=PROFESSIONAL)` + `ProfessionalProfile`, e `RecruitmentLead.professionalProfileId` passa a apontar para ele.

**Justificativa (ADR 0001 + KAIKAO §39):**
- `ProfessionalProfile` exige `User` com `phoneE164` único e identidade de domínio; forçar isso para todo contato (inclusive `DESISTIU`, `BASE_FUTURA`, `REPROVADA`) poluiria a tabela operacional de profissionais com não-profissionais e quebraria invariantes.
- O §39 pede não **duplicar o profissional** — e não duplicamos: criamos **um** `ProfessionalProfile` no único momento de promoção. O `RecruitmentLead` é um conceito distinto (candidato num funil), não uma cópia.
- A máquina de estados do funil pertence ao Lead; `ProfessionalProfile.reviewStatus` já existe para outro fim (revisão operacional). Não sobrecarregar.

## Arquitetura (camadas, seguindo ADR 0001)

```
domain/recruitment/
  recruitment-status.ts            # enum RecruitmentStatus (tipo puro)
  recruitment-state-machine.ts     # ALLOWED_TRANSITIONS + transitionRecruitmentStatus() -> Result
  recruitment-state-machine.test.ts
application/recruitment/
  transition-lead-status.usecase.ts            # transação + version + history + audit + override
  transition-lead-status.usecase.integration.test.ts
  create-lead.usecase.ts                        # cadastro manual pelo admin / lead cru
  add-lead-note.usecase.ts / edit-lead-note.usecase.ts / delete-lead-note.usecase.ts
  set-next-action.usecase.ts / create-reminder.usecase.ts
  (+ testes de integração correspondentes)
app/admin/recruitment/            # Kanban + perfil + modais (Server Components + Server Actions)
```

Guardrails: domínio não importa infra/apresentação (dependency-cruiser). Nenhum `if/else` de fluxo em controllers — transições sempre pela máquina de estados (KAIKAO Automação §3).

## Seção A — Modelo de dados (migration nova, aditiva, não-destrutiva)

Enums novos:

- `RecruitmentStatus`: `LEAD`, `PRE_CADASTRO`, `TRIAGEM`, `CONVERSA_PENDENTE`, `ENTREVISTA`, `REFERENCIA`, `PRE_APROVADA`, `DOCUMENTACAO`, `ONBOARDING`, `TESTE_OPERACIONAL`, `EM_VALIDACAO`, `ATIVA`, `PREFERENCIAL`, **+ alternativos** `PRECISA_DE_AJUDA`, `LIGACAO_SOLICITADA`, `BASE_FUTURA`, `AGUARDANDO_COMPLEMENTACAO`, `REPROVADA`, `DESISTIU`, `PAUSADA`, `SUSPENSA`. (Estágios e estados alternativos no mesmo enum, como `Booking` faz com `ISSUE_OPEN`/`CANCELLED`.)
- `LeadOrigin`: `META_ADS`, `INSTAGRAM`, `FACEBOOK`, `INDICACAO_PROFISSIONAL`, `INDICACAO_CLIENTE`, `IDT`, `PARCEIRO`, `ORGANICO`, `WHATSAPP`, `CADASTRO_MANUAL`, `OUTRO`. (Extensibilidade futura via `originNote`; enum + nota cobre o MVP sem tabela de config nesta fase.)
- `CommunicationMode`: `TEXT`, `AUDIO`, `PHONE`, `MIXED`.
- `InitialChannelPreference`: `WHATSAPP`, `PHONE`.
- `WhatsappAutonomy`: `INDEPENDENT`, `OCCASIONAL_SUPPORT`, `UNKNOWN`.
- `ExperienceDuration`: `LT_1Y`, `Y1_3`, `GT_3Y`, `BY_AUDIO`.
- `AreaCompatibility`: `SIM`, `TALVEZ`, `NAO`.
- `LeadNoteType`: `GERAL`, `ENTREVISTA`, `REFERENCIA`, `DOCUMENTACAO`, `OPERACIONAL`, `PAGAMENTO`, `INCIDENTE`, `FOLLOW_UP`.

Modelos novos:

```
RecruitmentLead
  id            String  @id @default(uuid())
  status        RecruitmentStatus @default(LEAD)
  version       Int     @default(0)              -- concorrência otimista (como Booking)
  phoneE164     String?                            -- pode faltar num lead cru
  fullName      String?
  neighborhood  String?
  origin        LeadOrigin
  campaign      String?
  referralCode  String?
  partnerName   String?
  referredByProfessionalId String?                 -- FK ProfessionalProfile (nullable)
  originNote    String?
  preferredCommunicationMode CommunicationMode?
  initialChannelPreference   InitialChannelPreference?
  whatsappAutonomy           WhatsappAutonomy?     @default(UNKNOWN)
  hasProfessionalExperience  Boolean?
  hasInformalExperience      Boolean?
  experienceDuration         ExperienceDuration?
  canServeInitialArea        AreaCompatibility?
  availabilityDays           Json?                 -- dias marcados e/ou "por áudio"
  nextAction                 String?
  nextActionAt               DateTime?
  professionalProfileId      String?  @unique       -- set na promoção p/ ATIVA
  lastInteractionAt          DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  history   RecruitmentStatusHistory[]
  notes     LeadNote[]
  reminders LeadReminder[]
  events    LeadEvent[]
  @@index([status]); @@index([neighborhood]); @@index([origin]); @@index([nextActionAt])

RecruitmentStatusHistory   (espelha BookingStatusHistory)
  id, leadId(FK), fromStatus?, toStatus, actor, reason?, override Boolean @default(false), createdAt
  @@index([leadId])

LeadNote
  id, leadId(FK), author, type LeadNoteType @default(GERAL),
  content, pinned Boolean @default(false),
  createdAt, editedAt?, deletedAt?            -- exclusão lógica com auditoria
  revisions LeadNoteRevision[]
  @@index([leadId])

LeadNoteRevision          (histórico de edição — §25)
  id, noteId(FK), previousContent, editedBy, editedAt

LeadReminder              (§28)
  id, leadId(FK), text, dueAt, doneAt?, createdBy, createdAt
  @@index([leadId]); @@index([dueAt])

LeadEvent                 (timeline operacional — §30; separada do log técnico)
  id, leadId(FK), type String, description String, actor String,
  occurredAt DateTime @default(now()), metadata Json?
  @@index([leadId])
```

Campos de pré-cadastro (nome, bairro, experiência, área, disponibilidade) entram **agora** para viabilizar o **cadastro manual pelo admin** (§40 "cadastro manual"), mesmo antes da automação WhatsApp. Entrevista, referência, documentos, onboarding e teste são **novas tabelas em sub-specs seguintes** — não tocam nestas.

## Seção B — Máquina de estados

`recruitment-state-machine.ts`, molde de `booking-state-machine.ts`:

- `ALLOWED_TRANSITIONS: Record<RecruitmentStatus, RecruitmentStatus[]>` cobrindo o fluxo principal do §2 e as saídas para estados alternativos a partir de cada estágio (ex.: quase todo estágio pode ir para `LIGACAO_SOLICITADA`, `PRECISA_DE_AJUDA`, `DESISTIU`, `PAUSADA`, `BASE_FUTURA`; `LIGACAO_SOLICITADA` retorna ao estágio pendente).
- `transitionRecruitmentStatus(current, target): Result<RecruitmentStatus, DomainError>` — erro `INVALID_RECRUITMENT_TRANSITION` quando não permitido.

Caso de uso `transition-lead-status.usecase.ts` (molde do de Booking):
- Transação atômica; checa `version` (concorrência otimista) e incrementa.
- Grava `RecruitmentStatusHistory` + `AuditLog`.
- Emite `LeadEvent` correspondente (ex.: "Entrevista concluída", "Ativada").
- **Override administrativo (§24):** parâmetro `override: { reason }`. Se `override` presente, pula a checagem de `ALLOWED_TRANSITIONS`, exige `reason` não-vazio, marca `RecruitmentStatusHistory.override=true` e registra auditoria específica. Sem `override`, transição inválida retorna `Result` de erro (o Kanban mostra o motivo — §24).
- **Promoção:** transição para `ATIVA` a partir de `EM_VALIDACAO` dispara criação/vínculo de `ProfessionalProfile` (+ `User` se necessário) na mesma transação; preenche `professionalProfileId`. Regras finais de aprovação permanecem **manuais** (§20 — não automatizar aprovação final no MVP).

## Seção C — Kanban + notas + próxima-ação (dashboard)

Rota `app/admin/recruitment` (Server Components + Server Actions; sem chamadas diretas a adapters a partir de componentes — §11 do adendo).

- **Colunas** (§22): Novos leads, Pré-cadastro, Triagem, Conversa pendente, Ligação solicitada, Referência, Documentação, Onboarding, Teste, Em validação, Ativas, Base futura. `REPROVADA`/`DESISTIU`/`SUSPENSA`/`PAUSADA` **não** são colunas — acessíveis por filtro/visão arquivada.
- **Cartão** (§23): nome, bairro, origem, disponibilidade resumida, experiência resumida, data de entrada, última interação, próxima ação, alerta, preferência de comunicação. Ação rápida **`+ Nota`** (modal pequeno — §26: salvar / fixar / criar lembrete). Próxima ação vencida → destaque `🔴 ATRASADO` (§27).
- **Drag-and-drop** (§24): mover entre colunas dispara `transition-lead-status`. Transição inválida → bloqueada com motivo; **override** só com permissão + `reason` obrigatório + auditoria. Biblioteca: **`dnd-kit`** — dependência nova que aciona a ficha de justificativa do §14 do briefing (drag-and-drop é requisito explícito §24 e critério de aceite §41.16; alternativas descartadas: `react-beautiful-dnd` sem manutenção ativa, HTML5 DnD nativo com acessibilidade fraca). Fallback de mover-via-menu também exposto para acessibilidade/teclado.
- **Filtros** (§31) incluindo o rápido **"Precisa de mim"** (ligações solicitadas, referências pendentes, documentos pendentes, problemas, follow-ups vencidos). **Busca** (§32) por nome/telefone/bairro/notas/origem.
- **Perfil do profissional** (§29/§30): resumo + notas (timeline) + linha do tempo de `LeadEvent`. Seções de entrevista/referência/documentos/onboarding/teste aparecem como **placeholders "em breve"** até seus sub-specs — não bloqueiam este.
- **Notas internas (§25):** criar, editar (com `LeadNoteRevision`), excluir logicamente (auditado), fixar, pesquisar, ordenar. **Nunca enviadas ao profissional** — não há caminho de saída de notas para mensageria (garantido por não haver mensageria neste sub-spec; reforçado por teste em sub-spec de automação).
- **Lembretes (§28):** geram alerta no dashboard e destaque no cartão; **não** enviam mensagem ao profissional.

## Seção D — Testes (Vitest + Testcontainers + Playwright, conforme stack)

- **Máquina de estados (unit):** transição válida; inválida retorna erro; caminhos alternativos (ligação/ajuda/base futura); retorno de `LIGACAO_SOLICITADA` ao estágio pendente.
- **Casos de uso (integration, Postgres real):** transição grava history+audit+event+version; concorrência otimista (version stale falha); override exige reason e marca `override=true`; promoção para `ATIVA` cria/vincula `ProfessionalProfile`.
- **Notas (integration):** criar/editar (gera revision)/excluir lógico auditado/fixar/pesquisar.
- **Cadastro manual (integration):** admin cria lead e preenche pré-cadastro completo; fluxo consistente com o que a automação usará depois (§40).
- **Kanban (E2E Playwright):** cartões na coluna correta; drag válido move e persiste; drag inválido bloqueado com motivo; override auditado; `+ Nota` rápida; próxima ação e follow-up vencido destacados; filtro "Precisa de mim".

## Migrations necessárias

Uma migration aditiva: novos enums + tabelas `RecruitmentLead`, `RecruitmentStatusHistory`, `LeadNote`, `LeadNoteRevision`, `LeadReminder`, `LeadEvent`, e FK nullable `RecruitmentLead.professionalProfileId → ProfessionalProfile`. **Nada destrutivo**; `ProfessionalProfile`/`User` intocados até a promoção (que só grava dados, não altera schema).

## Riscos

- **Explosão do enum de transições:** 21 estados → tabela grande. Mitigar com helper para as saídas comuns (alternativos) e testes cobrindo o fluxo principal + amostras de alternativos.
- **Dependência nova (`dnd-kit`):** ficha §14 documentada acima; fallback via menu garante que DnD não é caminho único.
- **Acoplamento acidental com sub-specs futuros:** manter entrevista/referência/documentos/onboarding/teste como tabelas próprias depois; aqui só placeholders de UI.
- **Promoção parcial:** criar `User`+`ProfessionalProfile` na transição `ATIVA` deve ser atômico com a transição; testar rollback.

## Fora do escopo deste sub-spec (vão para sub-specs seguintes)

Automação WhatsApp / `ConversationEngine` / mensageria (depende das Fases 2 e 4); áudio (assets de pergunta, upload, resposta por áudio — depende de `StorageProvider` já existente mas atrelado à conversa); entrevista, referência, documentos, termos/aceites, onboarding, teste operacional, validação/avaliação pós-serviço, métricas do funil, configurações administrativas do fluxo. Também fora (§42): IA de decisão, transcrição obrigatória, scoring, app do profissional.

## Decomposição do escopo maior (KAIKAO) em sub-specs

1. **(ESTE)** Domínio do funil (state machine) + Kanban + notas + próxima-ação/follow-ups + cadastro manual + timeline.
2. Mensageria genérica (Fase 2 do roadmap): `MessagingGateway`, modelo canônico, `MockMessagingAdapter`, outbox de mensagens, `InboundEventProcessor`.
3. `ConversationEngine` adaptativo (branching) + fluxo de pré-cadastro automatizado + comandos globais + retomada/abandono + triagem automática.
4. Áudio multimodal: `QuestionAsset`/áudio gerenciável, envio texto+áudio, resposta por áudio (`StorageProvider`), `UNSTRUCTURED_RESPONSE`/revisão manual.
5. Entrevista + avaliação interna + referência.
6. Documentos + termos/aceites.
7. Onboarding + teste operacional (automatizados via WhatsApp real).
8. Em validação + avaliação pós-serviço + ativação + preferencial + métricas do funil.
9. Configurações administrativas do fluxo.
10. Evolution API real (Fase 7 do roadmap).

Cada sub-spec: brainstorm → spec → plano → implementação, com commits pequenos e testes.

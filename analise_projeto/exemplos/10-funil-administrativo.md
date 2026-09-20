# Exemplo 10 — Funil administrativo: Kanban, máquina de estados e ativação

**Pergunta que o fluxo responde:** o que a operação faz entre o pré-cadastro
concluído e a profissional apta a receber oportunidades?

Onze etapas, cada uma com registro próprio, todas passando pela mesma máquina de
estados.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/domain/recruitment/recruitment-state-machine.ts` | `ALLOWED_TRANSITIONS` |
| `src/application/recruitment/transition-lead-status.usecase.ts` | Única entrada para mudar status |
| `src/application/recruitment/kanban-read-model.ts` | Colunas, fila "precisa de mim" e busca |
| `src/application/recruitment/interviews-references.usecase.ts` | Entrevista, avaliação e referências |
| `src/application/recruitment/documents-terms.usecase.ts` | Documentos e aceite de termos |
| `src/application/recruitment/onboarding-operational-test.usecase.ts` | Onboarding e teste operacional |
| `src/application/recruitment/validation-activation.usecase.ts` | Validação e ativação |
| `src/app/admin/recruitment/*` | Kanban (dnd-kit) e Server Actions |

---

## O caminho feliz

```
LEAD → PRE_CADASTRO → TRIAGEM → CONVERSA_PENDENTE → ENTREVISTA → REFERENCIA
     → PRE_APROVADA → DOCUMENTACAO → ONBOARDING → TESTE_OPERACIONAL
     → EM_VALIDACAO → ATIVA → PREFERENCIAL
```

De **qualquer** etapa acima, a máquina também permite sete saídas comuns:

```
LIGACAO_SOLICITADA, PRECISA_DE_AJUDA, AGUARDANDO_COMPLEMENTACAO,
BASE_FUTURA, DESISTIU, PAUSADA, REPROVADA
```

Isso é expresso de forma compacta no domínio:

```ts
const stage = (forward) => [...new Set([...forward, ...commonExits])];

ENTREVISTA: stage(["REFERENCIA"]),   // → REFERENCIA + as sete saídas
```

`DESISTIU` e `REPROVADA` são terminais: `[]`. `BASE_FUTURA` tem volta
(`PRE_CADASTRO`, `TRIAGEM`, `CONVERSA_PENDENTE`) para quando a área expandir.

---

## O Kanban

`getKanbanBoard` monta 14 colunas com uma única query, filtrando em memória:

```
Novos leads │ Pré-cadastro │ Triagem │ Conversa pendente │ Ligação solicitada │
Entrevista │ Pré-aprovada │ Referência │ Documentação │ Onboarding │ Teste │
Em validação │ Ativas │ Base futura
```

Arrastar um card entre colunas chama `moveLeadAction`, que chama o caso de uso —
e a máquina de estados rejeita movimentos inválidos com
`INVALID_RECRUITMENT_TRANSITION`, devolvendo a mensagem para a interface.

### Fila "precisa de mim"

`getNeedsMeLeads` responde "o que exige um humano agora":

```ts
OR: [
  { status: "LIGACAO_SOLICITADA" },
  { status: "PRECISA_DE_AJUDA" },
  { status: "AGUARDANDO_COMPLEMENTACAO" },
  { nextActionAt: { lt: new Date() } },   // próxima ação vencida
]
```

### Busca

`searchLeads` procura por nome, telefone, bairro **e conteúdo das notas** (com
`mode: "insensitive"`, ignorando notas apagadas), limitando a 50 resultados.

---

## O que a transição faz por dentro

Chamar `transitionLeadStatusInTransaction` dispara, em uma transação:

| # | Efeito |
|---|---|
| 1 | Valida contra `ALLOWED_TRANSITIONS` (ou pula a validação, se for override com motivo) |
| 2 | Promove a `ProfessionalProfile`, quando o alvo é `ATIVA` |
| 3 | `updateMany` com lock otimista por `version` |
| 4 | `RecruitmentStatusHistory` (de → para, ator, motivo, flag de override) |
| 5 | `LeadEvent` (`STATUS_<ALVO>`) |
| 6 | `AuditLog` (`LEAD_STATUS_TRANSITION`) |

Falhando o lock: `LEAD_CONCURRENT_MODIFICATION` — dois admins mexendo no mesmo
lead não se sobrescrevem silenciosamente.

### Override

```ts
override: { reason: "Aprovação excepcional autorizada pela coordenação" }
```

Pula a validação da máquina de estados, mas **exige motivo não vazio**
(`OVERRIDE_REASON_REQUIRED`) e grava `override: true` no histórico — o pulo fica
permanentemente visível na auditoria.

### Promoção a profissional

```ts
if (!lead.fullName || !lead.phoneE164)
  return err(new DomainError("Ativação exige nome e telefone", "PROMOTION_REQUIRES_CONTACT"));
```

Indo para `ATIVA`, o lead vira um `User` com `role: PROFESSIONAL` e um
`ProfessionalProfile` (reaproveitando os que já existirem para aquele telefone).
Só a partir daí ela aparece como candidata em
[oportunidades](05-oportunidade-marketplace.md).

---

## As etapas, uma a uma

| Etapa | Registros criados | Regra relevante |
|---|---|---|
| **Entrevista** | `LeadInterview`, `LeadAssessment` | Resultado ∈ `REFERENCIA`, `AGUARDANDO_COMPLEMENTACAO`, `BASE_FUTURA`, `REPROVADA` |
| **Referências** | `ProfessionalReference`, `ReferenceVerification` | Status vai de `PENDING` a `CONFIRMED`/`NEGATIVE`/`INCONCLUSIVE`; registra `wouldHireAgain` |
| **Documentação** | `ProfessionalDocument`, `DocumentReview` | Requisitos configuráveis em `DocumentRequirement`; cada revisão é gravada com revisor e motivo |
| **Termos** | `TermsAcceptance` | `consentId` único, canal, telefone e IP — aceite rastreável, `@@unique([leadId, termsVersionId])` |
| **Onboarding** | `LeadOnboardingProgress` | Conteúdos ordenados (`OnboardingContent.position`); `@@unique([leadId, contentId])` impede contagem dupla |
| **Teste operacional** | `OperationalTest`, `OperationalTestEvent` | Resultado ∈ `PASSED`, `PASSED_WITH_SUPPORT`, `FAILED`; `activeKey` único garante um teste ativo por vez |
| **Validação** | `ValidationServiceRecord`, `ValidationDecision` | Ver abaixo |

---

## A regra de ativação

```ts
const eligible =
  records.length >= policy.requiredServices &&
  records.every((record) => record.hadIssue !== true);
```

A `ValidationPolicy` ativa define quantos serviços são necessários (padrão: 3).
Ativar exige que **todos** os serviços registrados estejam sem incidente.

Três consequências desenhadas:

1. `recordValidationService` só aceita lead em `EM_VALIDACAO`
   (`LEAD_NOT_VALIDATING`);
2. cada serviço é único por `externalServiceId` — `upsert` evita contagem dupla,
   e vincular o mesmo serviço a outro lead dá `VALIDATION_SERVICE_CONFLICT`;
3. ativar **sem** elegibilidade é possível, mas exige motivo escrito; `PAUSADA` e
   `REPROVADA` sempre exigem motivo (`VALIDATION_DECISION_REASON_REQUIRED`). A
   `ValidationDecision` grava `eligible: false` — fica registrado que foi uma
   decisão contra o critério.

---

## Autorização em duas camadas

**Camada 1 — Server Action:**

```ts
const session = await auth.api.getSession({ headers: await headers() });
const user = await prisma.user.findFirst({ where: { email, role: "ADMIN" } });
return user?.email ?? null;   // null → a ação retorna "Sessão expirada."
```

Ter sessão do Better Auth não basta: o e-mail precisa corresponder a um `User` de
domínio com `role: ADMIN`.

**Camada 2 — caso de uso:** os casos de uso mais sensíveis repetem a checagem por
conta própria:

```ts
async function requireAdmin(prisma, actor) {
  const user = await prisma.user.findFirst({ where: { email: actor, role: "ADMIN" } });
  if (!user) throw new DomainError("Acesso administrativo necessário", "ADMIN_REQUIRED");
}
```

Assim, chamar o caso de uso de outro ponto de entrada não contorna a autorização.

---

## Criação manual de lead

Nem todo lead vem do WhatsApp. `createLeadAction` aceita 11 origens
(`META_ADS`, `INSTAGRAM`, `FACEBOOK`, `INDICACAO_PROFISSIONAL`,
`INDICACAO_CLIENTE`, `IDT`, `PARCEIRO`, `ORGANICO`, `WHATSAPP`,
`CADASTRO_MANUAL`, `OUTRO`), além de campanha, código de indicação e a
profissional que indicou (`referredByProfessionalId`).

O telefone é único (`@@unique([phoneE164])`), então o cadastro manual e o
WhatsApp convergem para o mesmo lead — desde que o número esteja em E.164, que é
justamente o formato que o normalizador do webhook produz.

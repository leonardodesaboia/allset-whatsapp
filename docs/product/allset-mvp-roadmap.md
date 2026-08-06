# AllSet — Roadmap do MVP WhatsApp-first

> Visão geral de alto nível das 8 fases do MVP. Cada fase tem seu próprio
> plano de implementação detalhado (TDD, task-by-task) salvo em
> `docs/superpowers/plans/`, criado quando a fase é iniciada. Este
> documento **não** é um plano executável — é o mapa que amarra as fases
> entre si e explicita o que fica de fora de cada uma.

## Estado atual

Repositório vazio (greenfield). Nenhuma stack, nenhum código, nenhuma
decisão prévia. Este roadmap fixa as decisões de stack e arquitetura que o
briefing do produto definiu como recomendadas para projetos novos.

## Diagnóstico de conflitos

Nenhum. Não há decisões anteriores para conflitar com o briefing.

## Stack fixada (greenfield → aplica-se a recomendação padrão do briefing)

| Camada | Escolha | Justificativa |
|---|---|---|
| Runtime | Node 24.x (Active LTS, ago/2026) | LTS ativa no momento do início do projeto |
| Package manager | pnpm | exigido pelo briefing; lockfile determinístico |
| Framework | Next.js 16 (App Router) + React | monólito modular, Server Components por padrão |
| Linguagem | TypeScript `strict` | exigido pelo briefing |
| Banco | PostgreSQL + Prisma ORM 7.x | exigido pelo briefing |
| Validação | Zod | contratos de borda (env, webhooks, forms) |
| Auth | Better Auth + adapter Prisma | e-mail/senha, papel único `ADMIN` no MVP |
| UI dashboard | Tailwind CSS + shadcn/ui + TanStack Table + React Hook Form | conforme briefing |
| Jobs/filas | pg-boss sobre o mesmo Postgres | outbox de domínio → relay → pg-boss → worker |
| Testes | Vitest, MSW, Testcontainers (Postgres real), Playwright | conforme briefing |
| Observabilidade | Pino (logs estruturados) + `ErrorReporter` (Console → Sentry opcional) | conforme briefing |
| Guardrails arquiteturais | dependency-cruiser + Knip no CI | domínio não importa infra/apresentação |

Nenhuma dependência da lista de "não adicionar sem justificativa" (Redis,
BullMQ, Kafka, tRPC, GraphQL, XState, Axios, NestJS, Redux/Zustand, SDK não
oficial da Evolution) é usada nesta fase. Caso alguma se torne necessária
mais adiante, a ficha de justificativa da seção 14 do briefing deve ser
preenchida antes de instalar.

## As 8 fases

Cada fase deve resultar em uma aplicação executável e é commitada em passos
pequenos e isolados — nunca tudo em um commit.

1. **Fundação** — estrutura modular, banco, migrations, autenticação admin,
   auditoria, entidades principais, máquina de estados do pedido, providers
   mock (pagamento/storage/erro), Docker, ambiente local, CI.
   → **Plano detalhado:** `docs/superpowers/plans/2026-08-06-fase1-fundacao.md` (em andamento).
2. **Mensageria genérica** — `MessagingGateway`, modelo canônico de
   mensagens, `MessagingCapabilities`, `ProviderRouter`, outbox de
   mensagens, `InboundEventProcessor`, `MockMessagingAdapter`, testes.
   Evolution API **não** entra aqui — só o contrato e o mock.
3. **Dashboard básico** — autenticação já pronta (fase 1); visão geral,
   lista de pedidos, profissionais, clientes, configurações (áreas/preços
   editáveis sem deploy), linha do tempo, alertas.
4. **Fluxo do cliente** — motor de conversas (estados do cliente), coleta
   de dados, validação de área, motor de preços, confirmação,
   `MockPaymentProvider`, criação do pedido — tudo via `MockMessagingAdapter`
   (sem WhatsApp real ainda).
5. **Fluxo do profissional** — cadastro, aprovação humana, disponibilidade,
   distribuição determinística de oportunidades, aceite atômico
   (proteção contra concorrência), execução (saída/chegada/finalização).
6. **Automações** — jobs pg-boss: lembretes, expiração de cobrança,
   confirmação do profissional, avaliação, recontratação, repasse,
   reprocessamento, alertas de exceção.
7. **Evolution API** — `EvolutionMessagingAdapter` real, webhook, QR Code,
   conexão, saúde, homologação com WhatsApp real. Só começa depois que as
   fases 2–6 rodam de ponta a ponta com o mock.
8. **Estabilização** — E2E completos, revisão de segurança, observabilidade,
   documentação (ADRs, runbook, catálogo de eventos), revisão arquitetural.

## Decisões que permanecem TBD (não inventar)

Provider real de pagamento; comissão/política comercial final; prazo de
repasse; política de cancelamento; critérios definitivos de documentos do
profissional; setores exatos da Aldeota; storage/infra de produção; regras
fiscais; momento da migração para Meta Cloud API. Essas aparecem como
configuração ou contrato (feature flag, campo `TBD` documentado), nunca como
valor definitivo assumido silenciosamente.

## Próximo passo

Executar `docs/superpowers/plans/2026-08-06-fase1-fundacao.md`, tarefa por
tarefa, com commits isolados e testes passando a cada tarefa.

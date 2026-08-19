# Auditoria e correções completas — 2026-08-19

## Escopo e método

Foi feita uma rodada de auditoria de engenharia, QA, segurança e UX no MVP AllSet. A análise cobriu os fluxos de autenticação administrativa, recrutamento de profissionais, booking de clientes, marketplace, mensageria Evolution/WhatsApp, áudio, outbox, cron, administração, banco de dados e deploy.

O método usado foi incremental: identificar o risco, corrigir a causa no domínio ou na fronteira adequada, adicionar ou ajustar cobertura e executar as verificações relacionadas. As mudanças preservam as regras de negócio existentes; não há implementação de Mercado Pago nesta rodada.

## Fluxos verificados

| Fluxo | Cobertura e resultado |
| --- | --- |
| Login, sessão e logout administrativo | E2E em artefato standalone; redirecionamento de visitante, login e logout validados. |
| Recrutamento | Funil, Kanban, nota rápida, documentos, termos, onboarding, teste operacional e validação revisados. |
| Cadastro manual de profissional | E2E com dado exclusivo por execução, incluindo atualização visual do Kanban. |
| Booking e matching | Validação de data, cobertura, redispatch e expiração de oportunidade cobertos por testes de integração. |
| Mensageria | Webhook idempotente, resposta de oportunidade por texto/áudio, outbox e processamento de inbound revisados. |
| Operação móvel | Cenário E2E para menu, foco, Escape e ausência de overflow em 375px foi adicionado; execução ainda pendente. |
| Segurança HTTP | E2E verifica headers básicos em rota pública. |

## Problemas encontrados e correções

### Recrutamento

- A tela administrativa não permitia concluir corretamente o teste operacional. O backend agora exige e a UI registra a sequência `STARTED → ACCEPTED → EN_ROUTE → ARRIVED → COMPLETED` antes de aprovar; reprovação retorna o lead para complementação.
- A transição de documentação para onboarding podia prosseguir sem todas as provas necessárias. Agora exige documentos obrigatórios aprovados e aceite de todos os termos ativos.
- Eventos do teste operacional podiam ser duplicados por cliques concorrentes. Foi incluído um índice parcial de banco e tratamento do conflito de concorrência.
- O Kanban tinha ordem incorreta e omitia status operacionais. A ordem foi alinhada ao funil e todos os status relevantes permanecem visíveis.
- Ações de documentos, termos, onboarding, validação, teste e conversa pausada descartavam erros retornados pelo servidor. Elas passaram a mostrar feedback inline para o operador.
- `moveLeadAction` e `addQuickNoteAction` agora validam UUID, status e conteúdo na fronteira da server action; notas vazias ou acima do limite são rejeitadas antes da escrita.
- O executor de ações de recrutamento e o movimento por drag-and-drop agora tratam exceções inesperadas e bloqueiam movimento duplicado enquanto há uma operação pendente.
- Acessibilidade do cartão do Kanban foi corrigida: os atributos de drag ficam na alça de arraste e não englobam as ações de nota/abertura.

### Marketplace e booking

- Matching sem profissionais elegíveis não cria oportunidade nem move o booking indevidamente para matching.
- Redispatch preserva a oportunidade expirada e cria uma nova oferta/tokens de resposta, em vez de sobrescrever o histórico.
- A expiração só move um booking para revisão se não existir outra oportunidade aberta.
- A cobertura negativa encerra o booking de maneira consistente, com histórico/audit, em vez de deixá-lo em estado de revisão indefinida.
- Cadastro administrativo de booking rejeita data/hora no passado.
- Matching considera a data civil em `America/Fortaleza`, evitando disponibilidade e conflitos calculados pelo dia UTC próximo à meia-noite.

### Mensageria e áudio

- Retry de webhook não perde inbound que foi persistido, mas ainda não foi processado: o retry recupera o processamento pendente.
- Respostas de oportunidade enviadas como áudio passam pelo mesmo roteador de texto e podem aceitar/recusar a oferta.
- Comandos de ajuda de uma profissional cuja conversa de pré-cadastro já terminou não são mais ignorados.
- Ramificações terminais de conversa marcam corretamente o inbound como processado, evitando duplicação em retries.
- O webhook Evolution passou a limitar corpo a 1 MiB, inclusive quando o `Content-Length` está ausente, e retorna `400`/`413` previsíveis para JSON inválido ou carga excedente.
- As rotas internas de áudio/transcrição e cron possuem respostas controladas e logs de contexto sem expor detalhes ao cliente.

### Administração, segurança e operação

- A rota pública de bootstrap de admin foi removida. O seed agora exige senha por variável de ambiente, não imprime segredo e cria, de maneira transacional/idempotente, credencial, usuário de domínio e perfil administrativo.
- Health check interno, crons e jobs exigem segredo; em produção, secrets operacionais são validados no ambiente.
- Foram adicionados headers de segurança: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`.
- Ações da outbox agora retornam feedback visível. O reenvio em massa registra audit apenas para mensagens efetivamente reenfileiradas, mesmo com concorrência.
- O build e o E2E usam o output standalone com assets estáticos copiados, como no Docker. O E2E também pode usar porta isolada com `E2E_PORT` e alinha a origem do Better Auth a essa porta.

### UI, UX e acessibilidade

- Foram consolidados `ModalDialog` acessível e `ActionFeedbackForm`, eliminando vários modais/formulários sem foco correto ou sem apresentação de erro.
- Modais possuem Escape, clique fora, foco inicial e retenção de foco; o menu móvel possui retenção/restauração de foco e controles de 44px.
- Login ganhou labels associados, `role="alert"`, tratamento de falha de rede e bloqueio de submissão antes da hidratação. Isso impede o fallback nativo que poderia colocar credenciais na query string.
- Páginas de outbox, documentos, preços, booking, recrutamento e conversas receberam ajustes de padding, quebra/truncamento de texto e rolagem horizontal controlada para tabelas em telas pequenas.
- Formulários assíncronos relevantes possuem estado pendente, prevenção de clique repetido e retorno de erro amigável.

## Banco e migrations

- `20260819120000_allow_opportunity_redispatch`: remove a unicidade que impedia preservar oferta expirada e reenviar uma nova oportunidade.
- `20260819130000_prevent_duplicate_operational_test_events`: remove duplicados legados com segurança e cria índice parcial para impedir eventos operacionais repetidos.
- As migrations foram aplicadas com sucesso na suíte de integração.

## Testes adicionados ou atualizados

- Gates de recrutamento (documentos, termos e teste operacional).
- Concorrência e sequência de evento operacional.
- Redispatch/expiração de marketplace e ausência de candidatas.
- Roteamento de conversa inbound e validação de cobertura.
- Limite e parsing do corpo do webhook.
- Seed administrativo seguro.
- E2E de login/logout, visitante sem sessão, Kanban/nota/cadastro manual e headers HTTP. O cenário de navegação móvel foi adicionado e aguarda execução.

## Evidências de validação

Executados com sucesso nesta rodada:

```text
pnpm lint
pnpm typecheck
pnpm test                         # 25 arquivos, 81 testes
pnpm test:integration             # 10 arquivos, 34 testes
pnpm architecture:check
pnpm dead-code:check              # apenas sugestões de configuração do Knip
pnpm build --webpack
E2E_PORT=3100 pnpm exec playwright test --workers=1 --reporter=list
git diff --check
```

O E2E valida o artefato standalone, não apenas o servidor de desenvolvimento. A suíte então existente terminou com `status: passed`; o novo cenário de navegação móvel, criado depois dessa execução, deve ser incluído na próxima execução completa.

## Checklist de encerramento da auditoria

Este quadro separa evidência já obtida de itens que ainda exigem execução ou homologação. Ele evita considerar a auditoria concluída por uma verificação parcial.

| Critério | Evidência atual | Estado |
| --- | --- | --- |
| Aplicação compila em modo produção | `pnpm build --webpack` passou. | Concluído no ambiente atual |
| Lint e tipos | `pnpm lint` e `pnpm typecheck` passaram. | Concluído no ambiente atual |
| Testes unitários | `pnpm test`: 25 arquivos e 81 testes. | Concluído no ambiente atual |
| Testes de integração | `pnpm test:integration`: 10 arquivos e 34 testes, com migrations aplicadas em bancos descartáveis. | Concluído no ambiente atual |
| Arquitetura e diff | `pnpm architecture:check` e `git diff --check` passaram. | Concluído no ambiente atual |
| E2E desktop | Login/logout, proteção de `/admin`, Kanban, nota, cadastro manual e headers passaram no standalone. | Concluído no ambiente atual |
| E2E mobile | `tests/e2e/admin-mobile-nav.spec.ts` existe, mas a execução que o inclui foi interrompida antes de terminar. | Pendente |
| Viewports restantes | 320, 390, 430, 768, 1024, 1280 e 1440px ainda não têm evidência automatizada/screenshot registrada. | Pendente |
| Fluxos reais de mensageria externa | Código e testes de integração cobrem o roteamento; falta homologação com Evolution, storage e OpenAI configurados. | Pendente de ambiente externo |
| Cron em produção | Rotas, segredo e runbook foram corrigidos; falta confirmar scheduler real e observar execução. | Pendente de ambiente externo |
| Dependências de produção sem alerta alto | Um alerta alto transitivo do Prisma 6 permanece. | Pendente de upgrade planejado |
| Runtime suportado | O repositório exige Node 24, mas a auditoria local foi executada sob Node 22. | Pendente de CI/runtime Node 24 |

### Próximas ações para encerrar o goal

1. Executar `E2E_PORT=3100 pnpm exec playwright test --workers=1 --reporter=list` após o novo cenário móvel, e registrar o resultado.
2. Rodar smoke tests visuais nos viewports listados, com atenção a tabelas, modais, drawer e Kanban.
3. Homologar webhook, download/transcrição de áudio e crons em staging com as integrações externas reais; registrar os jobs no monitoramento.
4. Atualizar Prisma de forma planejada para eliminar o alerta transitivo de `deepmerge-ts`, repetindo migration deploy, build e smoke test.
5. Executar a mesma matriz de testes em Node 24 e registrar essa evidência antes de declarar a auditoria integralmente concluída.

## Pendências e decisões deliberadas

1. `pnpm audit --prod` ainda aponta uma vulnerabilidade alta em `deepmerge-ts`, dependência transitiva de `@prisma/config` via Prisma 6. A versão corrigida requer `deepmerge-ts >= 8`, disponível no caminho de upgrade principal do Prisma 7. Não foi feito override forçado, pois isso pode quebrar o tooling de migration/configuração. Recomendação: planejar upgrade de Prisma 6 para 7 com revisão de migrations e smoke test de deploy.
2. O ambiente local usado na auditoria está em Node 22, enquanto o projeto declara Node 24+. O Dockerfile e `.nvmrc` já apontam para Node 24. Recomendação: executar CI e deploy exclusivamente com Node 24.
3. Áudio e cron dependem de configuração real de Evolution, storage e OpenAI em produção. O código, as rotas protegidas e o runbook foram alinhados, mas a homologação com credenciais externas deve ser feita no ambiente de produção/staging.

## Arquivos de maior impacto

- `src/application/recruitment/*`, `src/app/admin/recruitment/*`
- `src/application/marketplace/*`, `src/domain/marketplace/opportunity-matching-policy.ts`
- `src/application/messaging/*`, `src/app/api/messaging/evolution/webhook/route.ts`
- `src/app/admin/bookings/*`, `src/app/admin/outbox/*`
- `src/components/ui/action-feedback-form.tsx`, `src/components/ui/modal-dialog.tsx`
- `src/app/login/page.tsx`, `src/app/admin/mobile-nav.tsx`
- `playwright.config.ts`, `tests/e2e/*`
- `prisma/seed.ts`, `prisma/migrations/20260819120000_*`, `prisma/migrations/20260819130000_*`

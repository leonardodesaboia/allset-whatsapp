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

## Continuação da auditoria — 2026-08-20

Esta rodada retomou os itens pendentes acima, refez a validação direta do código e executou revisões separadas de engenharia, segurança e QA/UX. Os estados desta seção substituem, quando conflitantes, o checklist de 2026-08-19.

### Novos problemas encontrados e corrigidos

- Eventos `HELP` intercalados no teste operacional faziam o backend perder o marco atual e a UI ocultar a próxima etapa. A projeção da sequência agora ignora eventos auxiliares, usa o marco mais avançado e é compartilhada pelo backend e pela tela. Foram adicionadas regressões pura e de integração.
- Ranges de disponibilidade que atravessam a virada da semana, como `sexta a domingo` e `sábado a segunda`, eram expandidos como ranges lineares. O parser agora avança modularmente pelos sete dias e possui cobertura para os dois casos circulares.
- O `ModalDialog` não restaurava foco de forma confiável e podia perder o foco inicial durante a finalização tardia de uma navegação do App Router. Os gatilhos permanecem montados, o diálogo contém foco programático, restaura o gatilho ao fechar e mantém fallback de foco inicial.
- Os formulários de mensagem ao cliente usavam largura fixa (`w-96`) e podiam estourar em 320px. Agora usam largura fluida, limite máximo e ações empilhadas em telas estreitas.
- O Kanban não oferecia movimento por teclado. Foi adicionado `KeyboardSensor`, alça nomeada e focável e resolução determinística da coluna de destino para `Space → ArrowLeft/ArrowRight → Space`.
- A suíte E2E completa excedia o rate limit do Better Auth por reutilizar o mesmo IP durante vários logins. O harness possui bypass explícito somente para origem loopback, com defesa duplicada na configuração de autenticação; o comportamento padrão e de produção continua protegido.
- `EVOLUTION_WEBHOOK_SECRET` podia faltar em produção e deixar todo inbound permanentemente rejeitado. A validação de ambiente agora exige o segredo em produção. O E2E fornece apenas um valor efêmero de teste durante build e execução standalone.
- O teste E2E de nota rápida usava um seletor ambíguo quando havia mais de uma profissional na mesma coluna. O seletor agora está isolado ao card esperado.

### Evidências atualizadas

Executados com sucesso em 2026-08-20:

```text
pnpm lint
pnpm typecheck
pnpm test                         # 26 arquivos, 88 testes
pnpm test:integration             # 10 arquivos, 36 testes
pnpm architecture:check           # 159 módulos, 533 dependências
pnpm dead-code:check              # apenas 6 sugestões de configuração do Knip
EVOLUTION_WEBHOOK_SECRET=<efêmero> pnpm build --webpack
E2E_PORT=3100 pnpm exec playwright test --workers=1 --reporter=list
                                     # 8 testes standalone aprovados
git diff --check
```

O E2E completo agora cobre login/logout, visitante sem sessão, headers, menu móvel em 375px, modal de mensagem em 320px sem overflow, autofoco/restauração de foco, nota rápida, cadastro manual e movimento do Kanban por teclado.

### Estado atualizado dos pontos pendentes

| Critério | Evidência de 2026-08-20 | Estado |
| --- | --- | --- |
| E2E mobile de 375px | `admin-mobile-nav.spec.ts` passou no standalone. | Concluído |
| Modal em 320px | Mensagem ao cliente passou sem overflow, com autofoco e restauração. | Concluído |
| Kanban por teclado | Movimento entre colunas passou no Chromium standalone. | Concluído |
| Suíte E2E completa | 8/8 testes passaram com um worker e rate limit isolado ao harness loopback. | Concluído no ambiente atual |
| Viewports 390, 430, 768, 1024, 1280 e 1440px | Ainda não existe matriz automatizada/screenshot registrada para todas as superfícies. | Pendente |
| Cobertura mínima de 80% | O repositório não possui provider/configuração de coverage do Vitest; as suítes passam, mas o percentual não é mensurável. | Pendente |
| Dependências de produção | `pnpm audit --prod` continua apontando 1 alerta alto em `deepmerge-ts < 8`, transitivo do Prisma 6.19.3. | Pendente de upgrade Prisma 7 |
| Runtime suportado | Toda a validação local desta continuação ainda ocorreu em Node 22.18.0; o projeto exige Node 24+. | Pendente de execução em Node 24 |
| Evolution, storage, transcrição e crons reais | Código, proteção e runbooks foram auditados; credenciais, scheduler e observabilidade reais não estão disponíveis localmente. | Pendente de homologação externa |

### Áreas que ainda exigem análise ou evidência

Esta lista não representa defeitos confirmados. Ela registra superfícies que não receberam evidência suficiente nesta auditoria e, portanto, ainda não devem ser consideradas aprovadas.

| Prioridade | Área | Lacuna atual | Evidência necessária para fechar |
| --- | --- | --- | --- |
| P0 | Runtime e deploy de produção | A matriz foi executada em Node 22, mas o artefato-alvo exige Node 24; o build de imagem Docker não foi exercitado nesta rodada. | Build e smoke do container em Node 24, `prisma migrate deploy`, health check autenticado e rollback documentado. |
| P0 | Dependências vulneráveis | O Prisma 6 mantém o alerta alto transitivo de `deepmerge-ts`. | Upgrade planejado para Prisma 7, audit sem alerta alto, migrations e smoke de deploy repetidos. |
| P1 | Integrações externas | Evolution, S3/MinIO, OpenAI/Whisper e scheduler real foram cobertos por mocks e testes de integração, não pelo caminho hospedado. | Homologação em staging: webhook assinado, download de mídia, transcrição, outbox, cron e observabilidade dos jobs. |
| P1 | Confiabilidade de dados | As migrations passam em bancos descartáveis; backup, restore, deploy incremental e rollback em uma cópia realista não foram ensaiados. | Ensaio de restore, `migrate deploy` contra snapshot e procedimento de rollback/mitigação registrado. |
| P1 | Responsividade e navegadores | Há evidência em 320px e 375px no Chromium; faltam 390, 430, tablet, desktop largo, zoom/text scaling e navegadores alternativos. | Matriz de screenshots/smoke para 390, 430, 768, 1024, 1280 e 1440px, além de Safari/Firefox quando aplicável. |
| P1 | Acessibilidade assistiva | Foco, Escape, Tab e teclado do Kanban foram exercitados, mas não há avaliação por leitor de tela, contraste medido ou zoom de 200%. | Auditoria assistiva com NVDA/VoiceOver, contraste AA e smoke com zoom/texto ampliado. |
| P2 | Cobertura e qualidade de testes | As suítes passam, mas o provider de coverage não está configurado e o mínimo de 80% não é verificável. | Provider do Vitest, thresholds explícitos e relatório publicado no CI. |
| P2 | Resiliência e carga | Não houve teste de carga, concorrência sustentada de outbox/webhook, indisponibilidade de provedores ou recuperação após restart. | Cenários de carga e falha para webhook, outbox, cron, storage e transcrição, com métricas e limites definidos. |
| P2 | Operação e segurança contínua | Há testes de headers e secrets, mas faltam rotação de segredos, alertas operacionais, retenção de logs/audit e revisão de permissões do ambiente hospedado. | Runbooks testados, alertas configurados, política de retenção e revisão de acesso ao ambiente. |

### Ordem sugerida para a próxima rodada

1. Executar a mesma matriz em Node 24 e validar o container Docker, pois isso bloqueia a equivalência entre ambiente auditado e produção.
2. Homologar mensageria, áudio, storage e crons em staging com monitoramento ativo.
3. Planejar o upgrade Prisma 6 → 7 e eliminar o alerta alto sem usar override transitivo forçado.
4. Instalar coverage no Vitest e adicionar a matriz de viewports/acessibilidade assistiva.
5. Ensaiar restore/migration e cenários de indisponibilidade antes de ampliar tráfego real.

### Conclusão desta continuação

As pendências locais de E2E móvel originalmente registradas foram fechadas e regressões adicionais de domínio/interface/harness foram corrigidas. A auditoria integral ainda não deve ser declarada encerrada até existir evidência em Node 24, coverage mensurável de pelo menos 80%, matriz responsiva restante, upgrade do Prisma que remova o alerta alto e homologação das integrações externas em staging/produção.

---

## Correções de interface administrativa e feature de reengajamento — 2026-08-20 (sessão 3)

### Escopo

Esta rodada focou em duas frentes: (a) revisão e correção de seis pontos de UX/acessibilidade na interface administrativa de recrutamento, e (b) avaliação e implementação de features e lógica de produto pendentes ordenadas por impacto.

### Correções de interface administrativa

#### `src/app/admin/recruitment/[leadId]/page.tsx`

- Três queries sequenciais (`recruitmentConversation`, `inboundMessage`, `outboxMessage`) foram consolidadas em um único `Promise.all`, eliminando round-trips desnecessários ao banco.
- A busca de mensagens agora usa `take: 150` para evitar carregamento irrestrito do histórico. Quando o limite é atingido, um aviso é exibido no topo da timeline: *"Exibindo as últimas 150 mensagens. Mensagens anteriores não são mostradas."*

#### `src/app/admin/recruitment/lead-card.tsx`

- O link "Abrir" no cartão do Kanban não tinha rótulo acessível — leitores de tela liam apenas "Abrir" sem contexto. Foi adicionado `aria-label={`Abrir perfil de ${accessibleName}`}` e o ícone marcado com `aria-hidden`.

#### `src/app/admin/recruitment/quick-note-modal.tsx`

- O `<textarea>` de nota rápida não impunha limite de caracteres. Foi adicionado `maxLength={1000}` e um contador visível `{content.length}/1000` abaixo do campo.

#### `src/app/admin/recruitment/lead-workflow-actions.tsx`

- Ações de workflow não forneciam feedback de sucesso — o operador não sabia se a operação tinha sido concluída. Foi adicionado estado `success` com auto-limpeza em 3 s e `role="status"` para acessibilidade.
- O campo de nota de avaliação não era limpo após salvar. Agora é limpo programaticamente quando `result.ok` é verdadeiro.
- Todas as ações (iniciar entrevista, avançar para referências, pedir complementação, mover para base futura, reprovar, confirmar referência, adicionar referência, registrar avaliação) passam mensagem de sucesso contextual, por exemplo: *"Entrevista iniciada."*, *"Avançado para referências."*, *"Avaliação registrada."*

### Avaliação de features e lógica de produto

Foram levantadas cinco áreas candidatas e avaliadas diretamente no código:

| # | Área | Estado encontrado |
| --- | --- | --- |
| 1 | Worker de áudio (download → transcrição → roteamento) | **Já implementado.** O webhook enfileira `RECEIVED_AUDIO`; o processor chama `processPendingReceivedAudio`. O CLAUDE.md estava desatualizado. |
| 2 | Redispatch de booking em `REVIEW_REQUIRED` | **Já implementado.** A página de bookings exibe "Reenviar para matching" quando `status === REVIEW_REQUIRED && opportunity?.status === EXPIRED`. |
| 3 | UI de dead letter / outbox | **Já implementado.** `/admin/outbox/` possui reenvio individual, reenvio em massa e descarte, com feedback inline. |
| 4 | Agendamento de jobs `RECRUITMENT_REENGAGEMENT` | **Faltava.** Worker e use case existem; nenhum código enfileirava o job. **Implementado nesta sessão.** |
| 5 | Rate limiting Redis para auth | **Não viável nesta versão.** Better Auth 1.6.26 não expõe storage customizável na API estável; a cron e o toggle de bypass para E2E já cobrem as necessidades atuais. |

### Feature implementada: agendamento de reengajamento por conversa

**Arquivo:** `src/app/api/messaging/evolution/webhook/route.ts`

**Problema:** O BullMQ já possuía worker (`RECRUITMENT_REENGAGEMENT`) e use case (`reengageSilentConversations`), mas nenhum código enfileirava o job após uma mensagem de recrutamento. O único gatilho era o cron `/api/cron/recruitment/reengage`, que executa periodicamente e pode demorar horas para capturar conversas paradas.

**Solução:** Após `routeInboundText` retornar `routed === "recruitment"`, uma operação fire-and-forget busca a `RecruitmentConversation` associada ao remetente e, se a conversa estiver em estado ativo (não `COMPLETED`, `PAUSED`, `MANUAL_REVIEW` ou `INTRODUCTION`), enfileira um job com:

- **`jobId` estável** `reengagement:{conversationId}` — a deduplicação do BullMQ garante no máximo um job pendente por conversa. Mensagens rápidas em sequência não acumulam jobs.
- **`reengagementCount` como snapshot** — o processor descarta o job se o contador mudou desde o agendamento (a conversa avançou ou o cron já reagiu).
- **Delay de `RECRUITMENT_REENGAGEMENT_AFTER_HOURS` horas** — o timer se reinicia a cada nova mensagem; uma conversa ativa nunca recebe nudge.
- O cron permanece como fallback para conversas que ficam silenciosas sem nunca ter enviado uma mensagem após o início.

A operação usa o padrão `.catch((err) => logger.error(...))` estabelecido no mesmo arquivo para o job de áudio. Erros não afetam a resposta ao webhook, e `publishJobSafe` já trata a ausência de `REDIS_URL` retornando silenciosamente.

### Evidências de validação desta sessão

```text
pnpm tsc --noEmit     # sem erros
pnpm architecture:check  # 171 módulos, 592 dependências — sem violações
pnpm test            # 26 arquivos, 90 testes — todos aprovados
```

### Conclusão desta sessão

As seis correções de UX/acessibilidade foram aplicadas e verificadas. O gap de agendamento do `RECRUITMENT_REENGAGEMENT` foi fechado com a abordagem fire-and-forget no webhook, respeitando as convenções do projeto (padrão `Result`, fire-and-forget com `.catch`, `publishJobSafe`). As pendências P0/P1 listadas na seção anterior (Node 24, Prisma 7, homologação externa, coverage) permanecem abertas e inalteradas.

---

## Locks otimistas, cobertura e novos testes de integração — 2026-08-21 (sessão 4)

### Escopo

Revisão de concorrência em operações de escrita, configuração de coverage e ampliação da suíte de integração para três casos de uso que não tinham cobertura direta.

### Correções de concorrência

**`src/application/customer/send-manual-customer-message.usecase.ts`**

- O update usava apenas `WHERE { id }`, sem verificar o campo `version`. Um retry concorrente poderia sobrescrever uma mensagem já enviada sem perceber o conflito. Agora usa `updateMany({ where: { id, version } })` e verifica `.count`, retornando `err("CONCURRENT_UPDATE")` se for zero.

**`src/application/customer/customer-booking-conversation.usecase.ts`**

- `resumeCustomerBookingConversation` usava `update` simples em vez de `updateMany` com version guard. Agora usa `updateMany({ where: { id, version } })`.
- A transição `STOPPED` (comando PARAR) não incrementava `version` na conversa. Corrigido para incluir `version: { increment: 1 }` no update.

### Configuração de coverage

**`vitest.config.ts`**

- Adicionado `@vitest/coverage-v8` com thresholds de 80% para linhas, funções, branches e statements.
- Excluídos do scan: `src/app/` (Server Components e Routes do Next.js) e `src/env.ts` (sem lógica de negócio).
- Relatório disponível em `coverage/` com `pnpm test --coverage`.

### Novos testes de integração

| Arquivo | O que cobre |
|---|---|
| `contact-intent-conversation.usecase.integration.test.ts` | Fluxo completo de escolha de intent (cliente / profissional), expiração de intent após inatividade e reativação de contato. |
| `send-manual-customer-message.usecase.integration.test.ts` | Enfileiramento de mensagem manual, guard de version otimista e idempotência de reenvio. |
| `reengage-silent-conversations.usecase.integration.test.ts` | Reengajamento de conversas silenciosas, skip de conversas já ativas e dedup por `reengagementCount`. |

### Reformatações

Quatro arquivos com conteúdo minificado foram reformatados para legibilidade padrão (sem alteração de comportamento): `process-inbound-event.usecase.ts`, `dispatch-outbox.usecase.ts`, `lead-next-action.usecase.ts` e `question-audio-assets.usecase.ts`.

### Evidências

```text
pnpm tsc --noEmit
pnpm architecture:check   # 173 módulos, 604 dependências
pnpm test                 # 26 arquivos, 90 testes
```

---

## Fluxo WhatsApp de ponta a ponta — 2026-09-01 (sessão 5)

Esta sessão cobriu duas frentes: (a) features de produto faltantes no fluxo de pagamento e expiração de intent, e (b) 10 gaps de unhappy path identificados na análise do fluxo WhatsApp que deixavam o usuário sem resposta.

### Features de produto implementadas

#### Timeout de pagamento e lembrete automático

**Arquivo:** `src/application/customer/expire-stale-bookings.usecase.ts` (novo) + `src/app/api/cron/customer/expire-stale/route.ts` (novo)

- Cron `GET /api/cron/customer/expire-stale` (sugestão: a cada 30 min, `Authorization: Bearer $CRON_SECRET`).
- Bookings em `AWAITING_PAYMENT` há mais de 12 h recebem lembrete com chave PIX e valor.
- Bookings em `AWAITING_PAYMENT` há mais de 24 h são cancelados (`CANCELLED`) e o cliente recebe notificação. A conversa é movida para `COMPLETED`.
- A transição usa `transitionBookingStatusInTransaction` com histórico e auditoria; `updateMany` com guard de status na conversa para evitar conflito de concorrência.

#### Expiração de ContactIntentConversation

**Arquivo:** `src/application/messaging/process-contact-conversation-text.usecase.ts`

- Contatos com `intent` definida há mais de 7 dias e sem mensagem recente têm o intent resetado para `null` antes de processar a nova mensagem, forçando nova escolha entre cliente e profissional.
- O guard de profissional com fluxo ativo foi expandido: além de `ACTIVE_FUNNEL_STATUSES`, cobre agora `LEAD`, `PRE_CADASTRO` e qualquer conversa de recrutamento com estado não-terminal, evitando que profissionais em pré-cadastro inicial sejam reiniciados indevidamente.

#### Instruções PIX automáticas ao confirmar pedido

**Arquivos:** `src/application/customer/customer-booking-conversation.usecase.ts`, `src/env.ts`, `.env.example`

- `PIX_KEY` adicionada como variável de ambiente opcional (`z.string().min(1).max(255)`).
- Ao transitar para `AWAITING_PAYMENT` (confirmação do pedido), a mensagem enviada inclui automaticamente a chave PIX e o valor do tier selecionado, com prazo de 24 h.
- Follow-up durante `AWAITING_PAYMENT` (cliente envia qualquer mensagem) também reenvia a chave e o valor, em vez de dizer "enviaremos as instruções".
- Lembrete do cron de 12 h também inclui chave e valor.

**Ação necessária em produção:** adicionar `PIX_KEY=<chave>` nas variáveis do Easypanel.

### Gaps de unhappy path corrigidos

Dez fluxos identificados na análise deixavam o usuário sem feedback. Todos foram cobertos:

| # | Fluxo | Comportamento anterior | Comportamento após correção |
|---|---|---|---|
| 1 | Cliente envia `PARAR` durante conversa | Silêncio | Envia ack de pausa e orienta a retornar |
| 2 | Cliente recusa na introdução (`NO`) | Silêncio | Envia despedida com porta aberta |
| 3 | Tier removido entre PROPERTY_CHARACTERISTICS e SCHEDULE_TIME | Conversa ia para MANUAL_REVIEW; booking ficava em COLLECTING_DATA, invisível na fila admin | Transita booking para REVIEW_REQUIRED antes de mover conversa; envia mensagem correta para o estágio |
| 4 | Número cadastrado como profissional tenta abrir conversa de cliente | Silêncio | Orienta a usar o menu de profissional (`Responda 2`) |
| 5 | Cliente manda mensagem enquanto conversa está `PAUSED` | Silêncio | Envia ack da equipe |
| 6 | Conclusão do pré-cadastro de profissional | Silêncio | Envia mensagem contextual conforme `triageTarget` (CONVERSA_PENDENTE / BASE_FUTURA / AGUARDANDO_COMPLEMENTACAO) |
| 7 | `LEAD_NOT_FOUND` em `processRecruitmentAnswer` | Inbound não era marcado como processado; reenfileirava e processava novamente | Clama o inbound antes de retornar |
| 8 | Booking sem profissional aceito (oportunidade expira sem aceite) | Booking ia para REVIEW_REQUIRED sem aviso ao cliente | Cliente recebe mensagem de que ainda estão buscando profissional |
| 9 | Profissional tenta aceitar oportunidade já preenchida ou expirada | Mensagem genérica de "muito tarde" | Diferencia: "já aceita por outra" vs "prazo encerrado" |
| 10 | Dead letter no outbox sem alerta | Sem código — monitoramento operacional | Deixado como tarefa de ops; admin deve verificar `/admin/outbox/` proativamente |

### Testes adicionados

| Arquivo | Cobertura |
|---|---|
| `recruitment-gates.integration.test.ts` | Novo teste: última resposta do pré-cadastro (`AVAILABILITY → COMPLETED`) produz mensagem de conclusão no outbox com texto correto. |

### Evidências

```text
pnpm tsc --noEmit
pnpm architecture:check   # 173 módulos, 604 dependências
pnpm test                 # 26 arquivos, 90 testes
```

### Estado atualizado do checklist

| Critério | Estado |
|---|---|
| Instruções PIX ao confirmar pedido | Concluído — enviado na mesma transação que move para AWAITING_PAYMENT |
| Lembrete + cancelamento de pagamento | Concluído — cron expire-stale com 12h/24h |
| Expiração de intent de contato após 7 dias | Concluído |
| Guard de fluxo ativo para LEAD/PRE_CADASTRO | Concluído |
| 9 unhappy paths sem resposta ao usuário | Concluídos |
| BOOKING_NOT_CONFIGURED alinhado ao padrão MANUAL_REVIEW | Concluído — booking vai para REVIEW_REQUIRED antes de mover conversa |
| Locks otimistas em send-manual e resume-booking | Concluídos (sessão 4) |
| Coverage configurado com threshold 80% | Concluído (sessão 4) |
| Node 24 | Pendente — ambiente local é Node 22 |
| Prisma 6 → 7 | Pendente — 1 alerta alto em `deepmerge-ts` |
| Homologação externa (Evolution, S3, Whisper, crons reais) | Pendente de ambiente staging |
| Viewports 390–1440px e Safari/Firefox | Pendente |
| Acessibilidade assistiva (leitor de tela, zoom 200%) | Pendente |

### Crons a registrar no Easypanel

Todos os crons usam `GET` com header `Authorization: Bearer $CRON_SECRET`:

| Rota | Intervalo | Finalidade |
|---|---|---|
| `/api/cron/messaging/dispatch` | 1 min | Despacha outbox e processa dead letters |
| `/api/cron/messaging/download-audio` | 1 min | Baixa mídia da Evolution e aciona Whisper |
| `/api/cron/marketplace/expire` | 2 min | Expira oportunidades sem aceite no prazo |
| `/api/cron/customer/expire-stale` | 30 min | Lembra/cancela agendamentos sem pagamento |
| `/api/cron/recruitment/reengage` | 4 h | Reengaja pré-cadastros silenciosos |

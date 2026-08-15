# Relatório de testes locais — 2026-08-15

Execução manual e automatizada do AllSet em ambiente local, sem nenhuma
integração real com o WhatsApp. Todos os resultados abaixo foram observados
diretamente (saída de comando, resposta HTTP ou consulta ao banco); nada foi
inferido a partir de leitura de código.

## Ambiente

| Item | Valor |
|---|---|
| SO | Windows 11, Docker Desktop |
| Node | v24.14.1 |
| pnpm | 10.34.5 (via `corepack`, shims em `%LOCALAPPDATA%\corepack-shims`) |
| Banco | `postgres:17-alpine` em `localhost:5432` (`docker compose up -d db`) |
| Storage | MinIO em `localhost:9000` (`docker compose up -d minio`) |
| App | `pnpm dev` em `http://localhost:3000` |
| Migrations | 20 aplicadas via `pnpm prisma:deploy` |

### Isolamento do WhatsApp

`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE` ficaram vazios
no `.env`. Com isso `createMessagingGatewayRegistry()` devolve um registry vazio
(`src/infrastructure/messaging/messaging-runtime.ts:21`) e nenhuma requisição sai
para a Evolution. As mensagens do bot são gravadas na outbox e depois marcadas
como `FAILED` com `Provider não registrado: evolution` — comportamento esperado
e o que torna o teste seguro.

Mensagens de entrada foram simuladas com `POST` no webhook
(`/api/messaging/evolution/webhook`) usando o mesmo formato de payload da
Evolution (`data.key.id`, `data.key.remoteJid`, `data.message.conversation`).

---

## Fluxos que funcionaram

### 1. Defesas do webhook — 7/7

| Cenário | Resultado |
|---|---|
| Sem header de segredo | `401 UNAUTHORIZED` |
| Segredo errado | `401 UNAUTHORIZED` |
| Mensagem de grupo (`@g.us`) | `200 {"ignored":true}` |
| Eco da própria instância (`fromMe: true`) | `200 {"ignored":true}` |
| Mensagem sem texto nem áudio | `200 {"ignored":true}` |
| Mensagem de áudio | `202 {"needsMediaDownload":true}` |
| **Reenvio do mesmo `key.id`** | `200 {"duplicate":true}` — sem avançar estado |

A idempotência foi verificada com um `key.id` fixo enviado duas vezes: a segunda
chamada não criou `InboundMessage` nem avançou a conversa.

### 2. Roteamento de intenção do contato

Número desconhecido enviando "oi" recebe a pergunta de triagem
(`routed: contact-intent`) antes de entrar em qualquer funil. Escolher `1`
roteia para cliente (`routed: customer`), `2` para recrutamento.

### 3. Funil de recrutamento — completo

Telefone `+5585999990001`, 9 mensagens:

```
oi → 2 (trabalhar) → 1 (WhatsApp) → "Maria de Sousa" → "Parangaba"
   → 1 (já trabalhou) → 3 (mais de 3 anos) → 1 (atende a área) → "segunda a sexta"
```

Resultado no banco:

- `RecruitmentStatusHistory`: `LEAD → PRE_CADASTRO → TRIAGEM → CONVERSA_PENDENTE`
- `RecruitmentConversation.state`: `COMPLETED`
- Lead visível na coluna "Conversa pendente" do Kanban (HTML autenticado conferido)

### 4. Comandos globais

| Comando | Status do lead | Estado da conversa |
|---|---|---|
| `ajuda` | `LIGACAO_SOLICITADA` | `PAUSED` |
| `ligar` | `LIGACAO_SOLICITADA` | `PAUSED` |
| `parar` | `PRE_CADASTRO` (intacto) | `PAUSED` |
| `não entendi` (1ª vez) | `PRE_CADASTRO` | repete a pergunta atual |
| `não entendi` (2ª vez) | `LIGACAO_SOLICITADA` | `PAUSED` — escalou para ligação |

Após `parar`, uma nova mensagem do mesmo número **não** gerou saída na outbox
(contagem 4 → 4): a automação fica de fato silenciada.

### 5. Resposta ambígua em pergunta de opção

Responder "talvez sim" em `PROFESSIONAL_EXPERIENCE` (que aceita apenas 1/2) não
avançou o estado — a conversa permaneceu em `PROFESSIONAL_EXPERIENCE` e a
pergunta foi repetida.

### 6. Funil de cliente (agendamento) — completo

Telefone `+5585941000001`. Foi necessário popular dados de referência que não
existem em nenhum seed: 1 `ServiceDefinition` e 3 `PropertyPricingTier`.

```
oi → 1 (contratar) → 1 (confirma) → "Carlos Andrade"
   → 1 (Apartamento até 2 quartos) → 1 (data) → 1 (horário)
   → 1 (aceita orçamento) → "Rua das Flores, 123 - Aldeota"
   → [validação de cobertura pelo admin] → 1 (confirmar e pagar)
```

Histórico do booking:

```
DRAFT → COLLECTING_DATA → QUOTED → QUOTE_ACCEPTED → REVIEW_REQUIRED
      → AWAITING_CUSTOMER_CONFIRMATION → AWAITING_PAYMENT
```

Orçamento calculado corretamente pela faixa: R$ 150,00 / 180 minutos.

O estado `REVIEW_REQUIRED` **não é falha**: a validação de cobertura do endereço
é uma decisão humana no painel (`validateCustomerBookingCoverage`). Aprovada,
levou a conversa para `FINAL_CONFIRMATION` e o booking para
`AWAITING_CUSTOMER_CONFIRMATION`.

O fluxo termina em `AWAITING_PAYMENT` porque só existe `MockPaymentProvider`.

### 7. Marketplace — seleção de profissionais

Booking em `PAID`, agendado para domingo 16/08 em Aldeota, R$ 90,00 para a
profissional. Foram criados 6 leads:

| Lead | Configuração | Elegível? |
|---|---|---|
| Ana | `ATIVA`, atende área `SIM` | ✅ notificada |
| Bia | `PREFERENCIAL`, atende área `SIM` | ✅ notificada |
| Carla | `ATIVA`, atende área `NAO` | ❌ |
| Dora | `PRE_CADASTRO` (status não ativo) | ❌ |
| Eva | `ATIVA`, `TALVEZ` em bairro diferente | ❌ |
| Fabi | `ATIVA`, disponível só em outro dia da semana | ❌ |

`notifyOpportunity` retornou `notified: 2` e criou exatamente 2
`OpportunityResponse` + 2 mensagens na outbox. A política de matching filtrou os
4 inelegíveis corretamente.

### 8. Marketplace — corrida pela aceitação

Ana e Bia responderam `SIM` com seus respectivos tokens. Resultado:

- Ana (primeira) → `ACCEPTED`
- Bia (segunda) → `DECLINED` automaticamente, com mensagem "Esta oportunidade
  acabou de ser preenchida"
- `ServiceOpportunity.status` → `FILLED`
- `Booking.status` → `PROFESSIONAL_ASSIGNED`, `assignedProfessionalLeadId` = Ana

### 9. Marketplace — token vinculado ao profissional

Enviando o token da Bia pelo telefone da Ana, o sistema recusou com
`AMBIGUOUS_RESPONSE`. Cada `OpportunityResponse` tem seu próprio
`responseToken`, e um profissional não consegue aceitar uma oportunidade usando
o código de outro.

### 10. Reengajamento de conversas silenciosas

Com uma conversa retroagida 30h (limite configurado: 24h):

- `POST /api/internal/recruitment/reengage` → `{"scanned":1,"reengaged":1}`
- A pergunta pendente foi reenviada
- `reengagementCount` incrementado para 1
- **Segunda execução imediata** → `{"scanned":0,"reengaged":0}` (cooldown funcionando)

### 11. Expiração de oportunidades

Com uma oportunidade `OPEN` e `expiresAt` no passado:

- `POST /api/internal/marketplace/expire` → `{"scanned":1,"expired":1}`
- `ServiceOpportunity`: `OPEN → EXPIRED`
- `Booking`: `MATCHING → REVIEW_REQUIRED`
- Respostas pendentes: `NULL → EXPIRED`

### 12. Autenticação dos endpoints de worker e cron

| Endpoint | Sem segredo | Segredo errado | Segredo correto |
|---|---|---|---|
| `POST /api/internal/messaging/dispatch` | 401 | 401 | 200 `dispatched:true` |
| `POST /api/internal/recruitment/reengage` | — | — | 200 |
| `POST /api/internal/marketplace/expire` | — | — | 200 |
| `POST /api/internal/messaging/transcribe` | — | — | 400 (payload inválido, esperado) |
| `POST /api/internal/messaging/download-media` | — | — | 503 `EVOLUTION_NOT_CONFIGURED` |
| `GET /api/cron/messaging/dispatch` | 401 | 401 | 200 `dispatched:50` |
| `GET /api/cron/recruitment/reengage` | — | — | 200 |
| `GET /api/cron/marketplace/expire` | — | — | 200 |
| `GET /api/cron/messaging/download-audio` | — | — | 503 `AUDIO_WORKER_NOT_CONFIGURED` |

Os internos usam `x-allset-job-secret`; os crons usam `Authorization: Bearer`.
Ambos com comparação timing-safe.

`POST /api/setup/admin` respondeu **401 sem segredo** — é protegido por
`INTERNAL_JOB_SECRET`, não é um endpoint aberto.

### 13. Renderização das páginas do admin — 14/14

Todas responderam HTTP 200 com sessão autenticada:

```
/  /login  /admin  /admin/bookings  /admin/bookings/new  /admin/recruitment
/admin/customer-conversations  /admin/documents  /admin/outbox
/admin/settings/evolution  /admin/settings/pricing
/admin/bookings/{id}/opportunity  /admin/recruitment/{leadId}
/admin/customer-conversations/{id}
```

`/admin/bookings/{id}` devolve 404 — essa rota **não existe** (não há
`page.tsx` nesse nível); o detalhe do booking só tem a sub-rota `/opportunity`.

### 14. Seed do admin

Após correção (ver problemas abaixo), `pnpm prisma db seed` cria a credencial e
o `User` de domínio, é idempotente na segunda execução, e o login autenticado
chega em `/admin/recruitment` com HTTP 200 sem redirect.

### 15. Suítes automatizadas

| Suíte | Resultado |
|---|---|
| `pnpm test` | ✅ 67 testes, 21 arquivos, ~1s |
| `pnpm test:integration` | ✅ 25 testes, 9 arquivos, 92s — **só com ajuste de flags**, ver problema #1 |
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm architecture:check` | ✅ 154 módulos, 497 dependências, 0 violações |

---

## Problemas encontrados

### #1 — `pnpm test:integration` falha como está configurado

**Gravidade: média.** Bloqueia a suíte de integração localmente.

Os 9 arquivos de integração sobem um container Postgres cada e executam
`prisma migrate deploy` (20 migrations) dentro do `beforeAll`. O Vitest roda os
arquivos em paralelo, e todos estouram o `hookTimeout` de 60s:

```
Test Files  9 failed (9)
Tests  25 skipped (25)
Error: Hook timed out in 60000ms
```

Rodando sequencialmente e com timeout maior, tudo passa:

```bash
pnpm exec vitest run --testTimeout=120000 --hookTimeout=240000 \
  --no-file-parallelism integration.test.ts
# Test Files  9 passed (9)   Tests  25 passed (25)   92.10s
```

Correção sugerida: ajustar o script `test:integration` no `package.json`, ou
compartilhar um único container entre os arquivos.

### #2 — Seed do admin criava usuário pela metade

**Gravidade: alta. Corrigido neste trabalho.**

`prisma/seed.ts` gravava apenas `AuthUser` + `AuthAccount`. O `AdminLayout`
(`src/app/admin/layout.tsx:16`) autentica pelo Better Auth mas **autoriza**
procurando um `User` de domínio com `role: "ADMIN"` e o mesmo email. Sem esse
registro, o login era aceito e imediatamente redirecionado de volta para
`/login` — sem mensagem de erro.

Agravante: havia um `return` antecipado, então se a credencial já existisse o
seed saía antes de chegar na parte do domínio.

### #3 — Comando de seed apontava para dependência ausente

**Gravidade: baixa. Corrigido neste trabalho.**

`package.json` declarava `"seed": "tsx prisma/seed.ts"`, mas `tsx` não está nas
`devDependencies` — `pnpm prisma db seed` falhava com "command not found".
Trocado para `node prisma/seed.ts`, já que o `engines` exige Node 24+, que
executa TypeScript nativamente.

### #4 — Labels do login sem associação com os campos

**Gravidade: média (acessibilidade). Corrigido neste trabalho.**

Em `src/app/login/page.tsx` os `<label>` de "E-mail" e "Senha" não tinham
`htmlFor` nem envolviam o `<input>`. Consequências:

- Leitores de tela não anunciam o rótulo do campo
- `page.getByLabel(...)` do Playwright não encontra os campos, quebrando 3 specs

Corrigido com `id` + `htmlFor` nos dois campos.

### #5 — Specs de E2E desatualizadas com a UI

**Gravidade: média. Não corrigido.**

- `tests/e2e/admin-login.spec.ts:10` espera o texto "Bem-vindo ao painel AllSet";
  o dashboard atual exibe "Painel" (`src/app/admin/page.tsx:82`).
- `tests/e2e/recruitment-kanban.spec.ts:3-8` — o `beforeEach` clica em "Entrar"
  sem aguardar a navegação e já chama `page.goto("/admin/recruitment")`. O
  snapshot da falha mostra o teste ainda na tela de login, ou seja, corre contra
  o estabelecimento da sessão.

Investigação interrompida a pedido (sem testes de UI).

### #6 — `pnpm dead-code:check` (knip) falha

**Gravidade: baixa. Pré-existente, não corrigido.**

Quebra o `pnpm ci:check`. Confirmado com `git stash` que já falhava antes de
qualquer alteração deste trabalho, com os mesmos achados:

- 1 arquivo não usado: `src/components/ui/separator.tsx`
- 5 dependências não usadas: `@radix-ui/react-avatar`, `react-dialog`,
  `react-dropdown-menu`, `react-separator`, `react-tooltip`
- 5 exports órfãos: `searchLeadsAction`, `getNeedsMeLeadsAction`,
  `badgeVariants`, `buttonVariants`, `CardFooter`
- 3 tipos órfãos: `InputProps`, `CustomerChoice`, `DownloadedInboundMedia`

### #7 — Ausência de seed para dados de referência

**Gravidade: baixa (fricção de setup). Não corrigido.**

Um banco recém-migrado tem zero `PropertyPricingTier`, `ServiceDefinition` e
`ServiceArea`. Sem faixas de preço o funil de cliente vai direto para
`MANUAL_REVIEW` (`customer-booking-conversation.usecase.ts:280`), o que parece
defeito mas é falta de dado. Precisei popular manualmente para testar.

### #8 — Colisão de telefone entre seeds

**Gravidade: baixa. Introduzido e corrigido neste trabalho.**

A primeira versão da correção do seed usava `+5585990000000` como telefone
padrão do admin — o mesmo valor fixo de `tests/e2e/seed.ts:75`. Como
`User.phoneE164` é único, o `globalSetup` do Playwright quebrava. O padrão passou
a ser `+5585990009999` e o seed agora falha com mensagem explícita se o número já
estiver em uso.

---

## Não testado

| Área | Motivo |
|---|---|
| Áudio de ponta a ponta (download + Whisper) | Exige instância real da Evolution para baixar a mídia. Só o webhook foi verificado (`202 needsMediaDownload`) |
| Pagamento | Só existe `MockPaymentProvider`; não há gateway real |
| Interface gráfica | Interrompido a pedido. Só verifiquei que as páginas respondem 200 e contêm os dados esperados no HTML |
| `pnpm prisma migrate reset` | Comando destrutivo, não executado |
| Fluxos de entrevista, referências, documentos, termos, onboarding e teste operacional | Existem casos de uso e tabelas, mas não foram exercitados |

---

## Alterações no repositório

| Arquivo | Mudança |
|---|---|
| `prisma/seed.ts` | Dividido em `seedCredential()` e `seedDomainAdmin()`, ambos idempotentes; cria `User` + `AdminProfile`; valida colisão de telefone; novo `SEED_ADMIN_PHONE` |
| `package.json` | `prisma.seed`: `tsx prisma/seed.ts` → `node prisma/seed.ts` |
| `src/app/login/page.tsx` | `id` + `htmlFor` nos campos de e-mail e senha |
| `.env` | Passou a ser a configuração local; a de produção foi preservada em `.env.prod` (cópia verificada por SHA-256, ambos no `.gitignore`) |

`CLAUDE.md` também aparece modificado — bloco inserido automaticamente pelo
`next dev`, não por este trabalho.

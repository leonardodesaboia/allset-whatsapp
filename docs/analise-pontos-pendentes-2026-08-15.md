# Análise — o que está por trás dos 4 pedidos

Levantamento feito varrendo o repositório inteiro (código, migrations, docs,
configs) para traduzir em pontos concretos os quatro itens pedidos:

> 1. "Corrigir algumas coisas"
> 2. "configurar algumas coisas no MinIO"
> 3. "fzr o resto e dar essa polida no fluxo"
> 4. "estilizar um pouco mais a área de adm"

Cada ponto abaixo tem arquivo e linha. A coluna **Origem** indica como foi
apurado: `verificado` = executei e observei o resultado; `código` = li o código;
`doc` = está registrado em documento do próprio repo.

> ⚠️ Vários documentos do repo estão desatualizados em relação ao código.
> Sinalizo onde isso acontece, porque seguir o doc levaria a refazer coisa
> pronta.

---

## 1. "Corrigir algumas coisas"

### 1.1 `pnpm test:integration` não roda como está configurado
**Origem: verificado** · `package.json:20`

Os 9 arquivos de integração sobem um container Postgres cada e rodam
`prisma migrate deploy` (20 migrations) dentro do `beforeAll`. O Vitest executa
em paralelo e todos estouram o `hookTimeout` de 60s — resultado: 9 arquivos
falham, 25 testes pulados.

Rodando sequencialmente, tudo passa (25/25 em 92s):

```bash
pnpm exec vitest run --testTimeout=120000 --hookTimeout=240000 \
  --no-file-parallelism integration.test.ts
```

**Correção:** ajustar o script, ou compartilhar um container entre os arquivos.

### 1.2 `pnpm dead-code:check` quebra o `ci:check`
**Origem: verificado** · `knip.json`

Impede o pipeline completo de passar. Achados (confirmado com `git stash` que
são anteriores a qualquer alteração recente):

- 1 arquivo órfão: `src/components/ui/separator.tsx`
- 5 dependências não usadas: `@radix-ui/react-avatar`, `react-dialog`,
  `react-dropdown-menu`, `react-separator`, `react-tooltip`
- 5 exports órfãos: `searchLeadsAction`, `getNeedsMeLeadsAction`,
  `badgeVariants`, `buttonVariants`, `CardFooter`
- 3 tipos órfãos: `InputProps`, `CustomerChoice`, `DownloadedInboundMedia`

**Atenção:** `searchLeadsAction` e `getNeedsMeLeadsAction`
(`src/app/admin/recruitment/actions.ts:29-30`) são Server Actions escritas mas
nunca chamadas pela UI — pode ser funcionalidade inacabada, não lixo. Vale
decidir se remove ou se conecta na tela.

### 1.3 Specs de E2E desatualizadas com a UI
**Origem: verificado** · `tests/e2e/`

- `admin-login.spec.ts:10` espera o texto `"Bem-vindo ao painel AllSet"`; o
  dashboard atual exibe `"Painel"` (`src/app/admin/page.tsx:82`).
- `recruitment-kanban.spec.ts:3-8` — o `beforeEach` clica em "Entrar" sem
  aguardar a navegação e já chama `page.goto("/admin/recruitment")`. O snapshot
  da falha mostra o teste ainda na tela de login: corre contra o estabelecimento
  da sessão.

### 1.4 `vercel.json` não agenda o que o runbook afirma
**Origem: verificado** · `vercel.json` vs `docs/runbooks/evolution-messaging.md:144`

O runbook diz que o `vercel.json` agenda, **a cada cinco minutos**,
`/api/cron/marketplace/expire` e `/api/cron/messaging/download-audio`.
O arquivo real agenda **apenas** `/api/cron/recruitment/reengage`, uma vez por
dia:

```json
{ "crons": [ { "path": "/api/cron/recruitment/reengage", "schedule": "0 0 * * *" } ] }
```

Consequência prática: em produção **oportunidades não expiram sozinhas** e
**áudios não são baixados/transcritos**. O commit `88927ba fix: cron job remove`
sugere que isso foi retirado de propósito (plano Hobby da Vercel só permite cron
diário), mas o runbook não foi atualizado — e não há registro de onde os crons
frequentes deveriam rodar.

O `docs/product/implementation-status-2026-08-10.md` menciona **cron-job.org**
como substituto. Isso precisa virar configuração documentada e verificável.

### 1.5 Sem seed de dados de referência
**Origem: verificado**

Um banco recém-migrado tem **zero** `PropertyPricingTier`, `ServiceDefinition` e
`ServiceArea`. Sem faixas de preço, o funil do cliente vai direto para
`MANUAL_REVIEW` (`customer-booking-conversation.usecase.ts:280`) — parece bug,
mas é ausência de dado. Sem `ServiceDefinition`, o mesmo caso de uso responde
`SERVICE_NOT_CONFIGURED` (linha 299).

**Correção:** estender `prisma/seed.ts` com dados mínimos de referência, ou
documentar o cadastro obrigatório em `/admin/settings/pricing`.

### 1.6 `/api/setup/admin` deveria ter sido removido
**Origem: código** · `src/app/api/setup/admin/route.ts:7`

O próprio arquivo diz `DELETE THIS FILE after the admin account is created`, e a
pendência está aberta em `docs/product/implementation-status-2026-08-10.md`.

Não é uma brecha aberta — exige `INTERNAL_JOB_SECRET` com comparação
timing-safe. Mas cria só o `AuthUser`, sem o `User` de domínio com `role: ADMIN`,
então um admin criado por ele **não consegue entrar no painel**
(`src/app/admin/layout.tsx:16`).

### 1.7 Documentação desatualizada
**Origem: verificado**

| Documento | O que afirma | Realidade |
|---|---|---|
| `CLAUDE.md:60` | "Único bloqueador do áudio: o worker que baixa mídia" | O worker **existe**: `EvolutionMediaDownloader` + `/api/internal/messaging/download-media`. Falta só o agendador |
| `implementation-status-2026-08-07.md:118` | "Não entregue: QR Code, conexão e saúde no dashboard" | **Entregue**: `/admin/settings/evolution` já tem QR Code e `connectionState` |
| `runbooks/evolution-messaging.md:144` | crons a cada 5 min no `vercel.json` | Não existem (ver 1.4) |

---

## 2. "Configurar algumas coisas no MinIO"

O MinIO **está funcional em ambiente local**: `docker compose up -d minio` sobe
o serviço e o `minio-init` cria o bucket `allset` automaticamente
(`docker-compose.yml:31-44`). Os pontos abertos são de **produção**.

### 2.1 Credenciais vazias em produção
**Origem: doc** · `docs/product/implementation-status-2026-08-10.md`

`S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` estão **vazios** no ambiente de
produção da Vercel. Com valores vazios, `createRuntimeStorage()`
(`storage-runtime.ts:12`) cai no `LocalStorageProvider` — que não gera URL
HTTPS e é **bloqueado de propósito** para envio de áudio.

### 2.2 O bloqueio de HTTP é a trava real do áudio
**Origem: código** · `evolution-messaging-adapter.ts:41-43`

```ts
const media = await this.storage.getSignedUrl({ key: storageKey, expiresInSeconds: 600 });
if (!media.startsWith("https://")) {
  throw new Error("Evolution exige uma URL HTTPS pública e temporária para enviar áudio");
}
```

Ou seja: **não basta o MinIO responder** — a URL assinada precisa sair em
`https://`. O `.env` de produção tem `S3_PUBLIC_URL="https://<minio>.vn6tpb.easypanel.host"`
ainda como placeholder não preenchido.

**Configuração necessária no MinIO:**

1. Criar as credenciais (access key / secret key) e preenchê-las na Vercel
2. Expor o MinIO em um domínio público **com TLS** no Easypanel
3. Preencher `S3_PUBLIC_URL` com esse domínio — ele é usado para o cliente de
   **assinatura** de URLs, separado do endpoint interno de escrita
   (`s3-storage-provider.ts:34-37`)
4. Manter o bucket **privado**: o acesso é sempre por URL assinada com TTL de
   600s (`evolution-messaging-adapter.ts:41`). O `minio-init` não define policy
   pública, então o default privado já está correto

### 2.3 Endpoint interno vs. público
**Origem: código**

O `S3StorageProvider` mantém dois clientes: um para escrita, no endpoint interno
da rede Docker, e outro para assinar URLs, no `publicUrl`. Se `S3_PUBLIC_URL`
ficar vazio, os dois viram o mesmo — e a Evolution recebe um hostname interno
que não consegue resolver. **É o erro mais provável na primeira homologação.**

### 2.4 Retenção de áudio não implementada
**Origem: doc** · `runbooks/evolution-messaging.md:150-152`

O runbook define que áudio e transcrição são dado pessoal e devem seguir
política de retenção e exclusão. Não encontrei nenhuma rotina de expurgo no
código — nem job, nem lifecycle rule no MinIO.

---

## 3. "Fazer o resto e dar essa polida no fluxo"

### 3.1 O ciclo de vida do pedido para em `PROFESSIONAL_ASSIGNED`
**Origem: verificado** · `src/domain/booking/booking-state-machine.ts`

Esta é, de longe, a maior lacuna. A máquina de estados declara 22 status, mas
**7 deles não têm nenhum código que os acione**:

| Status | Código que transiciona para ele |
|---|---|
| `SCHEDULED` | nenhum |
| `PROFESSIONAL_CONFIRMED` | nenhum |
| `PROFESSIONAL_EN_ROUTE` | nenhum |
| `IN_PROGRESS` | nenhum |
| `AWAITING_COMPLETION_CONFIRMATION` | nenhum |
| `ISSUE_OPEN` | nenhum |
| `REFUND_PENDING` | nenhum |

O fluxo real hoje termina assim:

```
... → AWAITING_PAYMENT → [nada acontece]
... → MATCHING → PROFESSIONAL_ASSIGNED → [nada acontece]
```

Corresponde à **fase 5 do roadmap** ("execução: saída/chegada/finalização"), que
não foi implementada.

### 3.2 Pagamento nunca foi conectado
**Origem: verificado** · `src/infrastructure/payment/mock-payment-provider.ts`

`MockPaymentProvider` e a porta `PaymentProvider` existem, mas **nenhum arquivo
em `src/app` ou `src/application` os importa**. Nada transiciona um booking para
`PAID`. O cliente que confirma o pagamento fica preso em `AWAITING_PAYMENT`
indefinidamente, recebendo "Enviaremos as instruções de pagamento por aqui" —
instruções que nunca chegam.

O provider real é um **TBD explícito** do roadmap ("Decisões que permanecem TBD
— não inventar"), então a decisão comercial precisa vir antes.

### 3.3 Agendador dos jobs frequentes
**Origem: verificado** (ver 1.4)

O código dos workers está pronto e testei todos respondendo corretamente com o
segredo. Falta **quem os chama** em produção: expiração de oportunidade,
download de áudio e drenagem da outbox.

### 3.4 Retomada de conversa abandonada
**Origem: doc** · `implementation-status-2026-08-07.md:98-101`

O reengajamento por cron existe e **funciona** (testei: `scanned 1, reengaged 1`,
com cooldown bloqueando a segunda execução). O que falta é a "retomada por
escolha explícita" — o usuário poder retomar de onde parou.

### 3.5 Etapas finais do funil sem encadeamento automático
**Origem: doc + código** · `implementation-status-2026-08-07.md:189-194`

Entrevista, referências, documentos, termos, onboarding, teste operacional e
validação têm casos de uso completos e telas — mas o avanço entre eles é todo
manual pelo admin. O encadeamento por WhatsApp depende dos mesmos workers.

### 3.6 Recepção de documentos por WhatsApp
**Origem: doc** · `implementation-status-2026-08-07.md:171-173`

Depende do worker de mídia. Hoje o documento só entra pelo painel.

---

## 4. "Estilizar um pouco mais a área de adm"

Já existe um documento inteiro sobre isso no repo:
**`docs/ux-critique-2026-08-10.md`** — score **18/40 (Poor)** em heurísticas de
Nielsen. Ele é a resposta mais direta a este item. Resumo dos priorizados:

### P0 — Ações destrutivas sem confirmação
"Aprovar", "Rejeitar" e "Descartar permanentemente" executam no primeiro clique,
sem modal e sem undo. Aprovar e Rejeitar ficam **lado a lado na mesma linha** —
um clique errado aprova o que deveria rejeitar, de forma irreversível.
→ `admin/outbox/page.tsx`, `admin/documents/page.tsx`, `admin/recruitment/[leadId]/page.tsx`

### P1 — Perfil do lead mostra tudo, sempre
Um lead em TRIAGEM vê cards vazios de Documentação, Onboarding, Teste e
Validação. O operador rola 400–600px até a seção relevante.
→ `admin/recruitment/[leadId]/page.tsx`

### P1 — Server Actions sem feedback
Nenhum loading, nenhum toast. Sob latência o operador clica de novo e gera
double-submit. Sugestão do doc: `useFormStatus` + toast.

### P2 — Conversa do WhatsApp é o último card
Num produto WhatsApp-first, o histórico de mensagens está enterrado após 8+
cards. Sugestão: mover para a segunda posição e rolar para o fim ao carregar.

### P3 — Kanban de 13 colunas exige 2600px
Em 1440px com a sidebar, só ~6 colunas aparecem. Não dá para ver a coluna de
destino ao arrastar.
→ `admin/recruitment/kanban-board.tsx`

### Acessibilidade

- Hierarquia de headings quebrada: `h1` → `h3`, pulando `h2`
- Botão de lixeira só com `title`, sem label acessível
- Kanban sem alternativa de teclado para o drag-and-drop
- Inputs sem `<label>` associado (`RejectDocumentForm` e outros)

> Um caso desses já foi corrigido: os campos do **login** não tinham `htmlFor`
> e agora têm (`src/app/login/page.tsx`). O mesmo padrão precisa ser aplicado
> nos formulários do admin.

### Detalhes menores do doc

- "Dead letters" em inglês numa UI em português, sem explicação
- 9 de 13 estágios usam o mesmo ícone `Clock`
- Badges de referência mostram enums em inglês (`CONFIRMED`, `NEGATIVE`)
- Login em `slate-950` vs. painel em `slate-50` — transição visual abrupta

---

## Sugestão de ordem

Agrupei por dependência e risco, não por esforço:

| # | Item | Por quê primeiro |
|---|---|---|
| 1 | Agendador dos crons (1.4 / 3.3) | Produção está com expiração e áudio parados; o código já existe |
| 2 | MinIO: credenciais + HTTPS + `S3_PUBLIC_URL` (2.1–2.3) | Destrava todo o fluxo de áudio de uma vez |
| 3 | Seed de dados de referência (1.5) | 10 minutos, e destrava o funil do cliente em qualquer ambiente novo |
| 4 | `test:integration` e `dead-code:check` (1.1, 1.2) | Sem isso o `ci:check` não passa, e nada mais é verificável |
| 5 | UX P0 — confirmação em ações destrutivas (§4) | Risco operacional real: aprovação irreversível por misclick |
| 6 | Remover `/api/setup/admin` (1.6) | Rápido, e reduz superfície |
| 7 | Ciclo de vida do pedido (3.1) | O maior bloco; é a fase 5 do roadmap |
| 8 | Pagamento (3.2) | Depende de decisão comercial (TBD do roadmap) |
| 9 | Resto da UX (P1–P3) | Melhora contínua |

---

## O que verifiquei rodando

Para calibrar o que está realmente quebrado vs. o que só está incompleto,
executei o sistema localmente. **O núcleo funciona bem**: funil de recrutamento
completo, funil de cliente até `AWAITING_PAYMENT`, marketplace com matching e
corrida de aceitação, dedupe de webhook, comandos globais, reengajamento,
expiração e autenticação de todos os endpoints internos.

Detalhes em `docs/relatorio-testes-locais-2026-08-15.md`.

Nenhuma das lacunas acima é defeito no que já foi construído — são partes que
não chegaram a ser ligadas.

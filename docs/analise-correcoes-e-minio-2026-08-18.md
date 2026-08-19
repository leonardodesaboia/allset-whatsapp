# Análise do repositório — correções pendentes e configuração do MinIO

Data: 2026-08-18 · Branch analisada: `feat/vps-deploy` (HEAD `4509ce4`)

Este documento cobre dois eixos pedidos:

1. **Correções** — o que está quebrado, inconsistente ou desatualizado hoje.
2. **MinIO** — o que falta configurar para o storage funcionar de ponta a ponta em produção.

Todos os itens abaixo foram verificados executando os comandos do projeto e lendo o
código; cada achado traz a evidência e o arquivo/linha.

---

## Sumário executivo

| # | Item | Eixo | Prioridade | Esforço |
|---|---|---|---|---|
| C1 | `.env` com placeholders inválidos → **o app não sobe** | Correção | 🔴 P0 | 5 min |
| C2 | Segredos reais versionados em `docs/product/implementation-status-2026-08-10.md` | Correção | 🔴 P0 | 30 min |
| C3 | `pnpm ci:check` quebrado — `knip` falha | Correção | 🔴 P0 | 20 min |
| C4 | `tsx` não instalado → `prisma db seed` falha | Correção | 🔴 P0 | 2 min |
| C5 | `package-lock.json` versionado junto com `pnpm-lock.yaml` | Correção | 🟠 P1 | 5 min |
| C6 | `CLAUDE.md` descreve um bloqueador que não existe mais | Correção | 🟠 P1 | 10 min |
| C7 | Cron de download/transcrição de áudio ausente do runbook | Correção | 🟠 P1 | 5 min |
| C8 | `POST /api/setup/admin` ainda no repositório | Correção | 🟠 P1 | 2 min |
| C9 | Runbook aponta para `.env.vps`, arquivo inexistente | Correção | 🟡 P2 | 5 min |
| C10 | Funções de preview de mídia sem nenhum consumidor | Correção | 🟡 P2 | decisão |
| C11 | Fallback silencioso para `LocalStorageProvider` em produção | Correção | 🟠 P1 | 15 min |
| M1 | Bucket `allset` não é criado em produção | MinIO | 🔴 P0 | 5 min |
| M2 | Produção usa as **credenciais root** do MinIO, iguais às de dev | MinIO | 🔴 P0 | 15 min |
| M3 | `S3_PUBLIC_URL` não preenchido → Evolution não busca o áudio | MinIO | 🔴 P0 | 10 min |
| M4 | Bucket precisa ser garantidamente privado | MinIO | 🟠 P1 | 5 min |
| M5 | Região do cliente x região do MinIO (`SignatureDoesNotMatch`) | MinIO | 🟠 P1 | 5 min |
| M6 | Proxy do Easypanel precisa preservar `Host` para a URL assinada | MinIO | 🟠 P1 | 20 min |
| M7 | Sem política de retenção/lifecycle para áudios | MinIO | 🟡 P2 | 10 min |
| M8 | `docker-compose.yml`: imagens sem tag e healthcheck com `curl` | MinIO | 🟡 P2 | 10 min |
| M9 | Janelas de expiração das URLs assinadas não validadas | MinIO | 🟡 P2 | análise |

---

# Parte 1 — Correções

## C1 · 🔴 O `.env` atual impede o app de subir

**Evidência.** `pnpm test` falha:

```
FAIL  src/env.test.ts
Error: Variáveis de ambiente inválidas: BETTER_AUTH_URL: Invalid URL; S3_PUBLIC_URL: Invalid URL
 ❯ parseEnv src/env.ts:92:11
 ❯ src/env.ts:101:25
```

**Causa.** `src/env.ts:101` avalia `parseEnv(...)` no carregamento do módulo. O `.env`
local ainda tem os placeholders literais:

```dotenv
BETTER_AUTH_URL="https://<app>.vn6tpb.easypanel.host"   # .env:14
S3_PUBLIC_URL="https://<minio>.vn6tpb.easypanel.host"   # .env:48
```

Os caracteres `<` e `>` tornam a string uma URL inválida para o `z.string().url()`.
Isso não é só um teste vermelho: **com esse `.env` o container morre no boot**, porque
`src/env.ts` lança antes de qualquer rota ser servida.

**Correção.**
1. Preencher os dois valores com os domínios reais gerados pelo Easypanel.
2. Adicionar ao `vitest.setup.ts` um override para as variáveis opcionais também
   (hoje ele só protege `DATABASE_URL`, `BETTER_AUTH_SECRET` e `BETTER_AUTH_URL`,
   e usa `??=`, que não substitui valores inválidos já presentes). Sugestão: nos
   testes, não carregar o `.env` do desenvolvedor — usar um `.env.test` dedicado
   ou passar um `source` explícito. A suíte unitária não deveria depender de um
   arquivo de produção não versionado.

**Ganho colateral:** hoje qualquer desenvolvedor com um `.env` mal preenchido vê
20 testes passarem e 1 suíte inteira falhar por um motivo que nada tem a ver com
o código.

---

## C2 · 🔴 Segredos reais em arquivo versionado

`docs/product/implementation-status-2026-08-10.md` está commitado e contém:

- Linha 41 — senha do PostgreSQL de produção em texto claro dentro da `DATABASE_URL`,
  junto com o IP público da VPS.
- Linhas 63 e 70 — o hash scrypt do admin **e** a senha em claro (`Allset@admin123`).

O `.env` em si está corretamente ignorado (`.gitignore:22`, verificado com
`git ls-files`), e o `docs/runbooks/vps-deploy.md` usa placeholders (`<DB_PASSWORD>`,
`<VPS_IP>`) — ou seja, o padrão de redação existe, só não foi aplicado neste arquivo.

**Correção.**
1. **Rotacionar** a senha do PostgreSQL e a senha do admin. Estão em histórico Git;
   editar o arquivo não as remove do histórico.
2. Substituir os valores por placeholders no doc, no mesmo estilo do runbook de VPS.
3. `prisma/seed.ts:22` usa `Allset@admin123` como default de `SEED_ADMIN_PASSWORD`.
   Trocar por: exigir a variável e falhar se ausente quando `NODE_ENV=production`.
4. Considerar um scanner de segredos no CI (`gitleaks` ou o secret scanning do GitHub).

> Nota sobre o `.env` local: ele contém uma `OPENAI_API_KEY` real (`sk-proj-…`),
> a `EVOLUTION_API_KEY` e o `EVOLUTION_WEBHOOK_SECRET`. Não estão no Git, mas
> como as demais credenciais vazaram por doc, vale rotacionar o conjunto todo
> de uma vez.

---

## C3 · 🔴 `pnpm ci:check` está quebrado — `knip` falha

O `ci.yml` roda `pnpm dead-code:check` em todo PR e push para `main`. Ele falha hoje
(exit 1):

```
Unused files (1)          src/components/ui/separator.tsx
Unused dependencies (5)   @radix-ui/react-avatar, react-dialog, react-dropdown-menu,
                          react-separator, react-tooltip
Unlisted binaries (1)     tsx
Unused exports (5)        searchLeadsAction, getNeedsMeLeadsAction, badgeVariants,
                          buttonVariants, CardFooter
Unused exported types (3) InputProps, CustomerChoice, DownloadedInboundMedia
```

**Correção sugerida, por categoria:**

| Categoria | Ação |
|---|---|
| 5 deps Radix não usadas | Remover do `package.json` — os componentes shadcn que as consumiam não existem, ou não estão sendo importados. Confirmar antes de remover: `grep -r "@radix-ui/react-dialog" src/`. |
| `separator.tsx` | Remover o arquivo (ou usá-lo). Sai junto com `@radix-ui/react-separator`. |
| `tsx` unlisted | Ver C4 — adicionar como devDependency. |
| `searchLeadsAction` / `getNeedsMeLeadsAction` | Server Actions exportadas sem chamador. Ou ligar na UI de busca do Kanban, ou remover. |
| `badgeVariants` / `buttonVariants` / `CardFooter` / `InputProps` | Padrão shadcn — normalmente se resolve adicionando `src/components/ui/**` a `ignoreExportsUsedInFile` ou ao `ignore` do `knip.json`, com comentário justificando. |
| `CustomerChoice` / `DownloadedInboundMedia` | Tipos de domínio à frente dos consumidores — mesmo tratamento que os outros itens já justificados no `knip.json`. |

---

## C4 · 🔴 `tsx` não está instalado — o seed não roda

`package.json` declara `"prisma": { "seed": "tsx prisma/seed.ts" }`, mas `tsx` não
está em `devDependencies` nem em `node_modules/.bin` (verificado). Ou seja:

```bash
pnpm prisma db seed   # → tsx: command not found
```

Isso explica por que a criação do admin em produção foi feita via `INSERT` manual
(`docs/product/implementation-status-2026-08-10.md:50-68`) em vez do seed — o caminho
"correto" documentado na linha 72 do mesmo arquivo simplesmente não funciona.

**Correção.** `pnpm add -D tsx`. Isso resolve simultaneamente o `Unlisted binaries`
do knip (C3) e destrava o seed. Alternativa sem nova dependência: trocar o comando
por `node --experimental-strip-types prisma/seed.ts` (Node 24 suporta nativamente).

---

## C5 · 🟠 `package-lock.json` versionado quebra o ambiente

O `CLAUDE.md` é explícito: *"Package manager: somente `pnpm`"*. Mas
`package-lock.json` está commitado (`6646fbe`) e aparece como modificado no
`git status` atual.

**Impacto observado nesta análise.** Ao rodar `pnpm tsc --noEmit`, apareceram **~30
erros** do tipo:

```
error TS2305: Module '"@prisma/client"' has no exported member 'RecruitmentLead'
error TS7006: Parameter 'tx' implicitly has an 'any' type
```

Não é bug de código: era o Prisma Client desatualizado, resultado de um
`npm install` ter reescrito a árvore que o pnpm gerencia. Após `pnpm prisma generate`,
o typecheck passa **limpo**. O mesmo padrão de sintoma vai reaparecer sempre que
alguém rodar `npm install` por engano.

**Correção.**
1. `git rm --cached package-lock.json`
2. Adicionar `package-lock.json` e `yarn.lock` ao `.gitignore`.
3. Opcional, mas eficaz: `.npmrc` com `engine-strict=true` + o campo
   `"packageManager": "pnpm@10.34.5"` (já existe) fazem o Corepack barrar npm/yarn.
4. Vale um `preinstall` guard (`npx only-allow pnpm`).

O `Dockerfile:7-8` copia apenas `pnpm-lock.yaml`, então o build de produção está
correto — o risco é só no ambiente local, mas foi o que produziu o falso alarme acima.

---

## C6 · 🟠 `CLAUDE.md` descreve um bloqueador que já foi resolvido

O `CLAUDE.md` afirma, na seção "Estado de produção":

> Único bloqueador para o fluxo de **áudio**: o worker que baixa mídia da Evolution
> API, chama `recordReceivedAudio` e aciona `POST /api/internal/messaging/transcribe`.
> Sem ele, áudios chegam no webhook mas não chegam ao Whisper.

**Esse worker existe.** Está implementado em três lugares:

| Componente | Arquivo |
|---|---|
| Orquestrador (download → transcrição → conversa) | `src/application/messaging/process-pending-received-audio.usecase.ts` |
| Download da mídia na Evolution | `src/application/messaging/download-received-audio.usecase.ts` + `src/infrastructure/messaging/evolution-media-downloader.ts` |
| Gatilho HTTP por cron | `src/app/api/cron/messaging/download-audio/route.ts` |
| Gatilho HTTP interno | `src/app/api/internal/messaging/download-media/route.ts` |

O `processPendingReceivedAudio` já faz o ciclo inteiro de forma idempotente: busca
`InboundMessage` do tipo `AUDIO` sem `receivedAudio` ou sem `transcription`, baixa,
grava no storage, transcreve e alimenta `processContactConversationText`.

**O bloqueador real é outro** e é operacional, não de código: ver C7 e M1–M3.

**Correção.** Atualizar a seção "Estado de produção" do `CLAUDE.md` para refletir que
o worker existe e que o que falta é (a) agendar o cron e (b) concluir a configuração
do MinIO.

---

## C7 · 🟠 O cron de áudio não está no crontab documentado

`docs/runbooks/vps-deploy.md:296-305` lista três entradas de crontab:

```cron
* * * * * … /api/cron/messaging/dispatch
0 0 * * * … /api/cron/recruitment/reengage
0 * * * * … /api/cron/marketplace/expire
```

Falta a quarta, que é justamente a do áudio:

```cron
# Baixa mídia da Evolution, armazena no MinIO e transcreve — a cada minuto
* * * * * curl -s -H "Authorization: Bearer <CRON_SECRET>" \
  http://localhost:3000/api/cron/messaging/download-audio
```

Sem ela, o fluxo de áudio fica exatamente como o `CLAUDE.md` descreve — mensagens
chegam ao webhook e nunca são processadas — mas a causa é o agendamento ausente,
não código faltando.

**Detalhe importante:** essa rota retorna `503 AUDIO_WORKER_NOT_CONFIGURED` se
qualquer uma de `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` ou
`OPENAI_API_KEY` estiver vazia (`route.ts:14`). Vale checar o retorno na primeira
execução manual, antes de confiar no cron.

---

## C8 · 🟠 `POST /api/setup/admin` continua exposto

`src/app/api/setup/admin/route.ts` é um endpoint one-shot, com comentário explícito
na linha 7: *"DELETE THIS FILE after the admin account is created"*. A pendência já
está listada em `docs/product/implementation-status-2026-08-10.md:81` e continua
aberta.

Ele exige `INTERNAL_JOB_SECRET` com comparação timing-safe (`compareSecret`), então
não é uma porta aberta — mas é superfície de ataque desnecessária: cria contas via
`auth.api.signUpEmail` sem nenhum limite de taxa. Como o admin já foi criado, é só
apagar o arquivo.

---

## C9 · 🟡 Runbook aponta para um arquivo que não existe

`docs/runbooks/vps-deploy.md:278` instrui: *"Variáveis de ambiente: copiar de
`.env.vps` (ver arquivo na raiz do projeto)"*. Esse arquivo não existe na raiz e
está no `.gitignore:28` — nunca vai existir para quem clonar o repo.

**Correção.** Trocar a referência para `.env.example`, que está versionado, completo
e já documenta cada variável com o formato de hostname interno do Easypanel.

---

## C10 · 🟡 Três funções de preview de mídia sem consumidor

```
src/application/messaging/record-received-audio.usecase.ts:20   getReceivedAudioPreview
src/application/recruitment/question-audio-assets.usecase.ts:18 getQuestionAudioPreview
src/application/recruitment/documents-terms.usecase.ts:13       previewProfessionalDocument
```

Nenhuma é importada em lugar algum (`grep` no repositório inteiro). Consequência
prática: **o painel admin não exibe áudio nem documentos** — a única URL assinada
que o sistema realmente gera em runtime é a do envio outbound
(`evolution-messaging-adapter.ts:41`).

Isso muda o escopo do MinIO em produção. Hoje o storage é usado para:

- ✅ `put` — gravar áudio recebido (`record-received-audio.usecase.ts:17`)
- ✅ `get` — ler o áudio para mandar ao Whisper (`transcribe-received-audio.usecase.ts:29`)
- ⚠️ `getSignedUrl` — só no envio de áudio outbound, e **nenhum caso de uso cria
  `QuestionAudioAsset` hoje**, então esse caminho pode nunca ser exercitado ainda
- ❌ nenhuma leitura pela UI

**Decisão a tomar:** ligar essas funções nas telas de conversa/documentos (o que
torna M4/M6 críticos para o navegador também) ou removê-las por ora. Recomendo
ligar `getReceivedAudioPreview` na tela de conversas — ouvir o áudio original
quando a transcrição sai estranha é exatamente o caso de uso que justifica ter
guardado o arquivo.

---

## C11 · 🟠 Fallback silencioso para storage local em produção

`src/infrastructure/storage/storage-runtime.ts:11-29` tem a lógica certa para o caso
"S3 parcialmente configurado" (lança erro explícito), mas se **todas** as cinco
variáveis estiverem vazias ele cai silenciosamente no `LocalStorageProvider` —
inclusive em produção.

O sintoma disso não aparece na hora: o áudio é gravado em disco local (que some no
próximo deploy do container) e só estoura mais tarde, no envio, com
`"Evolution exige uma URL HTTPS pública e temporária para enviar áudio"`
(`evolution-messaging-adapter.ts:43`) — uma mensagem que não aponta para a causa real.

**Correção.** Falhar rápido:

```typescript
if (required.some(Boolean)) throw new Error("Configuração S3 incompleta: …");
if (env.NODE_ENV === "production") {
  throw new Error(
    "S3_* é obrigatório em produção: o LocalStorageProvider não gera URLs HTTPS " +
    "e o storage local não sobrevive a um redeploy do container",
  );
}
return new LocalStorageProvider(process.env.LOCAL_STORAGE_DIR ?? ".data/storage");
```

**Observação menor:** `createRuntimeStorage()` é chamado a cada request nas rotas
(`download-audio/route.ts:15`, `download-media/route.ts:21`), criando um novo
`S3Client` por chamada. Não é grave nesse volume, mas um módulo-singleton
memoizado seria mais adequado — o `S3Client` mantém um pool de conexões que está
sendo descartado a cada requisição.

---

# Parte 2 — MinIO

## Estado atual

**O que já está certo no código:**

- `S3StorageProvider` (`src/infrastructure/storage/s3-storage-provider.ts`) usa
  `forcePathStyle: true` — obrigatório para MinIO (linha 32).
- Separação de clientes: um para escrita no endpoint **interno**, outro só para
  **assinar** URLs no endpoint **público** (linhas 34-38). É exatamente o desenho
  necessário quando a app fala com o MinIO pela rede Docker mas a Evolution precisa
  de um domínio externo.
- A abstração `StorageProvider` (`src/domain/ports/storage-provider.ts`) mantém o
  domínio livre do SDK da AWS — trocar MinIO por S3 real é mudar só o composition root.
- `docker-compose.yml` para desenvolvimento já sobe MinIO com bucket criado
  automaticamente via `minio-init`.

**O que falta:** tudo abaixo é configuração de ambiente, não código.

---

## M1 · 🔴 O bucket `allset` não é criado em produção

O `minio-init` do `docker-compose.yml:33-44` cria o bucket — mas **só roda em
desenvolvimento**. Em produção o MinIO é um serviço do Easypanel, criado pelo painel;
o compose não é executado lá.

Nada no código cria o bucket. O primeiro `storage.put()` vai falhar com
`NoSuchBucket`, e como esse `put` acontece dentro do
`processPendingReceivedAudio`, o erro é engolido no `catch` da linha 36 e vira
apenas uma entrada `{ ok: false, error: "..." }` no retorno do cron — sem alarme.

**Correção.** Criar o bucket manualmente uma vez (ver o passo a passo em
"Configuração recomendada"), e **adicionalmente** considerar um bootstrap idempotente
no boot da app (`HeadBucket` → `CreateBucket` se ausente), para que ambientes futuros
não repitam o problema.

---

## M2 · 🔴 Produção está usando as credenciais root do MinIO

`.env:45-46`:

```dotenv
S3_ACCESS_KEY_ID="allset"
S3_SECRET_ACCESS_KEY="allset1234"
```

São exatamente as `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` do
`docker-compose.yml:19-20` — as credenciais de **desenvolvimento local**, versionadas
no repositório, com privilégio total sobre a instância (todos os buckets, criação de
usuários, políticas, console admin).

Três problemas somados: são root, são fracas (`allset1234`), e são públicas.

**Correção — criar uma service account restrita ao bucket:**

```bash
# Dentro do container do MinIO (terminal do Easypanel)
mc alias set local http://localhost:9000 <ROOT_USER> <ROOT_PASSWORD>

# Política mínima: só o bucket allset, sem admin
cat > /tmp/allset-app.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::allset/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::allset"]
    }
  ]
}
JSON

mc admin policy create local allset-app /tmp/allset-app.json
mc admin user svcacct add local <ROOT_USER> --policy /tmp/allset-app.json
# → guarde o Access Key / Secret Key retornados
```

Depois: trocar a `MINIO_ROOT_PASSWORD` de produção por um valor forte
(`openssl rand -base64 32`) e colocar a service account em `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY`.

> Note que a política acima **não** inclui `s3:CreateBucket` — de propósito. O bucket
> é criado uma vez pelo root (M1); a aplicação não precisa desse poder.

---

## M3 · 🔴 `S3_PUBLIC_URL` não preenchido

Já apontado em C1 como causa de crash no boot, mas o impacto funcional merece
destaque separado, porque é **o** ponto que faz o áudio funcionar ou não:

```typescript
// s3-storage-provider.ts:35-38
this.signingClient =
  config.publicUrl && config.publicUrl !== config.endpoint
    ? new S3Client({ ...base, endpoint: config.publicUrl })
    : this.client;
```

Sem `S3_PUBLIC_URL`, as URLs assinadas apontam para `http://allset_mvp_minio:9000` —
um hostname da rede Docker interna. A Evolution API, mesmo rodando na mesma VPS,
recebe essa URL e, no envio via WhatsApp, o arquivo precisa ser buscável. Pior: o
guard de `evolution-messaging-adapter.ts:42` exige `https://`, então uma URL interna
`http://` é rejeitada com erro antes mesmo da tentativa.

**Correção.** No Easypanel, expor o serviço MinIO com domínio público apontando para
a **porta 9000** (a API S3), não a 9001 (console), e usar esse domínio em
`S3_PUBLIC_URL`.

---

## M4 · 🟠 Garantir que o bucket permanece privado

O desenho do sistema é presigned URL, não bucket público — o que é a escolha correta:
os objetos são áudios de WhatsApp de candidatas e documentos pessoais (RG, CPF).
Dado pessoal sob LGPD.

O default do MinIO já é privado, mas vale verificar e travar explicitamente:

```bash
mc anonymous get local/allset      # deve retornar: "Access permission ... is 'none'"
mc anonymous set none local/allset # força, se necessário
```

**Não** aplicar `mc anonymous set download` — isso tornaria todo o bucket legível por
qualquer pessoa que descubra a URL, anulando o mecanismo de expiração.

---

## M5 · 🟠 Região do cliente x região do MinIO

`.env:44` usa `S3_REGION="us-east-1"`, que é o default aceito pelo MinIO. Funciona —
mas se em algum momento o serviço do MinIO for configurado com `MINIO_REGION` ou
`MINIO_SITE_REGION` diferente, todas as assinaturas SigV4 passam a falhar com
`SignatureDoesNotMatch`, um erro cuja mensagem não sugere em nada a causa.

**Correção.** Verificar e documentar:

```bash
mc admin config get local region
```

Manter `us-east-1` nos dois lados, ou alinhar explicitamente.

---

## M6 · 🟠 O proxy do Easypanel precisa preservar o `Host`

Este é o ponto mais sutil da configuração e o que mais costuma custar horas de debug.

A URL assinada é gerada pelo `signingClient` contra `S3_PUBLIC_URL`. A assinatura
SigV4 **inclui o header `Host`** nos `SignedHeaders`. Quando a Evolution busca a URL:

```
Evolution → https://minio.<...>.easypanel.host/allset/messaging/inbound/...?X-Amz-Signature=...
          → [Traefik/proxy do Easypanel]
          → http://minio:9000/allset/...
```

Para a assinatura validar, o MinIO precisa receber `Host: minio.<...>.easypanel.host`
— o host **público**, o mesmo que foi assinado. Se o proxy reescrever o `Host` para
`minio:9000`, o resultado é `SignatureDoesNotMatch` em 100% das requisições.

**Checklist do proxy:**

- [ ] Preserva o `Host` original (Traefik faz isso por padrão; confirmar que não há
      `passHostHeader: false`).
- [ ] Não reescreve o path (`forcePathStyle` põe o bucket no path: `/allset/<key>`).
- [ ] Não descarta query strings — a assinatura inteira vive na query.
- [ ] Não exige autenticação própria (basic auth do painel) na rota do MinIO.
- [ ] `client_max_body_size` / limite de upload adequado se houver upload via proxy.

**Teste de validação** (roda de qualquer máquina, fora da VPS):

```bash
# 1. Gera uma URL assinada de 5 min para um objeto de teste
mc alias set prod https://minio.<...>.easypanel.host <ACCESS_KEY> <SECRET_KEY>
echo "teste" | mc pipe prod/allset/_healthcheck.txt
mc share download --expire 5m prod/allset/_healthcheck.txt

# 2. Busca a URL retornada — precisa devolver 200 e o conteúdo
curl -v "<URL_ASSINADA>"

# 3. Limpa
mc rm prod/allset/_healthcheck.txt
```

Se o passo 2 retornar 403 com `SignatureDoesNotMatch`, o problema é o `Host`.

---

## M7 · 🟡 Sem política de retenção — os áudios acumulam para sempre

Cada áudio recebido vira um objeto em `messaging/inbound/<inboundMessageId>/<uuid>`
(`record-received-audio.usecase.ts:16`), com até 20 MB
(`maxAudioBytes`, linha 7). Nada apaga esses objetos: não há lifecycle no MinIO nem
job de limpeza no código.

Depois da transcrição, o texto fica no banco e o áudio bruto tem valor decrescente —
mas é o dado mais sensível dos dois (voz é biometria).

**Correção sugerida:**

```bash
mc ilm rule add --expire-days 90 --prefix "messaging/inbound/" local/allset
mc ilm rule ls local/allset
```

90 dias é um ponto de partida; o número certo depende do que o jurídico definir para
retenção de dados de candidatas. Documentos profissionais (`ProfessionalDocument`)
provavelmente exigem retenção **maior** e não devem entrar na mesma regra — por isso
o `--prefix`.

---

## M8 · 🟡 `docker-compose.yml` — reprodutibilidade e healthcheck

Dois ajustes no ambiente de desenvolvimento:

**1. Imagens sem tag** (`docker-compose.yml:15` e `:34`):

```yaml
image: minio/minio     # → minio/minio:RELEASE.2025-xx-xxTxx-xx-xxZ
image: minio/mc        # → minio/mc:RELEASE.2025-xx-xxTxx-xx-xxZ
```

`latest` implícito significa que o ambiente local de duas pessoas pode divergir, e
que um `docker compose pull` pode quebrar o setup sem nenhuma mudança no repositório.

**2. Healthcheck usa `curl`** (`docker-compose.yml:27`):

```yaml
test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
```

As imagens recentes do MinIO não trazem `curl`. Se o binário faltar, o healthcheck
falha sempre, o `minio-init` nunca dispara (`condition: service_healthy`, linha 37)
e o bucket local nunca é criado — o desenvolvedor vê um `NoSuchBucket` sem pista.

Alternativa que não depende de binário externo:

```yaml
healthcheck:
  test: ["CMD", "mc", "ready", "local"]
```

Ou manter o endpoint HTTP usando `wget --spider -q`, se presente na imagem escolhida.

**3. Paridade de credenciais.** O compose usa root (`allset`/`allset1234`) direto.
Como produção vai passar a usar service account (M2), vale criar uma service account
também no `minio-init` local — assim um erro de permissão aparece em desenvolvimento,
não em produção.

---

## M9 · 🟡 Janelas de expiração das URLs assinadas

| Uso | Expiração | Arquivo |
|---|---|---|
| Áudio outbound → Evolution | 600 s | `evolution-messaging-adapter.ts:41` |
| Preview de áudio recebido | 300 s | `record-received-audio.usecase.ts:20` |
| Preview de documento | 300 s | `documents-terms.usecase.ts:13` |
| Preview de áudio de pergunta | 300 s | `question-audio-assets.usecase.ts:18` |

Os 600 s do outbound são o único valor que importa hoje (os previews não têm
consumidor — C10). A pergunta a validar em produção: **a Evolution baixa a mídia
no momento do `POST /message/sendMedia`, ou a repassa para o WhatsApp buscar depois?**

Se for o segundo caso, e a outbox estiver com backlog ou em retry com backoff, a URL
pode expirar antes do download — resultando em áudios que falham de forma
intermitente e difícil de reproduzir. Vale confirmar no primeiro teste real e, se
necessário, subir para 3600 s.

Ponto relacionado, para o runbook: a URL assinada contém a chave do objeto e a
assinatura. **Não logar URLs assinadas** — o `docs/runbooks/evolution-messaging.md`
já orienta a não logar payload nem áudio; incluir explicitamente as URLs assinadas
na mesma regra.

---

# Ordem de execução recomendada

## Bloco A — destravar o ambiente (1 h)

1. `git rm --cached package-lock.json` + `.gitignore` (C5)
2. `pnpm add -D tsx` (C4)
3. `pnpm prisma generate` (revalida o typecheck)
4. Resolver os achados do knip (C3) → `pnpm ci:check` volta ao verde
5. Deletar `src/app/api/setup/admin/route.ts` (C8)

## Bloco B — segurança (1 h, fazer antes de qualquer coisa ir ao ar)

6. Rotacionar senha do Postgres, senha do admin, `OPENAI_API_KEY`,
   `EVOLUTION_API_KEY`, `MINIO_ROOT_PASSWORD` (C2, M2)
7. Redigir `docs/product/implementation-status-2026-08-10.md` (C2)
8. Ajustar o default de senha do `prisma/seed.ts` (C2)

## Bloco C — MinIO em produção (1–2 h)

9. Criar o bucket `allset` no MinIO de produção (M1)
10. Criar a service account com policy restrita ao bucket (M2)
11. Expor o MinIO (porta 9000) com domínio público no Easypanel (M3)
12. Preencher `S3_PUBLIC_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (M3, C1)
13. Preencher `BETTER_AUTH_URL` (C1)
14. Confirmar `mc anonymous get` = `none` (M4)
15. Rodar o teste de URL assinada de ponta a ponta (M6)
16. Aplicar a regra de lifecycle (M7)

## Bloco D — fluxo de áudio no ar (30 min)

17. Adicionar o cron `download-audio` ao crontab (C7)
18. Chamar a rota manualmente uma vez e verificar que **não** retorna
    `503 AUDIO_WORKER_NOT_CONFIGURED` (C7)
19. Enviar um áudio real pelo WhatsApp e acompanhar: webhook → `ReceivedAudio` →
    objeto no MinIO → transcrição → resposta
20. Fail-fast no `storage-runtime.ts` para produção (C11)

## Bloco E — documentação (30 min)

21. Atualizar a seção "Estado de produção" do `CLAUDE.md` (C6)
22. Corrigir a referência ao `.env.vps` no runbook de VPS (C9)
23. Adicionar o cron de áudio ao runbook (C7)
24. Documentar a configuração do MinIO num runbook próprio
    (`docs/runbooks/minio-storage.md`), consolidando M1–M9

## Bloco F — decisão de produto

25. Ligar ou remover as funções de preview de mídia (C10)

---

# Checklist de validação final

```bash
# Ambiente local
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm ci:check                    # lint + typecheck + arch + knip + test + build

# Produção — storage
mc alias set prod https://<minio-publico> <ACCESS_KEY> <SECRET_KEY>
mc ls prod/allset                # bucket existe e a service account enxerga
mc anonymous get prod/allset     # → 'none'
mc ilm rule ls prod/allset       # regra de expiração ativa

# Produção — fluxo de áudio
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<app>/api/cron/messaging/download-audio
# → {"ok":true,"processed":N,"results":[...]}   (não 401, não 503)
```

---

## Anexo — resultado das verificações executadas

| Comando | Resultado |
|---|---|
| `pnpm tsc --noEmit` | ❌ ~30 erros → ✅ limpo após `pnpm prisma generate` |
| `pnpm architecture:check` | ✅ sem violações (155 módulos, 502 dependências) |
| `pnpm lint` | ✅ sem erros |
| `pnpm test` | ❌ 1 suíte falhou (`src/env.test.ts`) · 20 passaram · 58 testes ok |
| `pnpm dead-code:check` | ❌ exit 1 (5 deps + 1 arquivo + 1 binário + 8 exports) |
| `git ls-files \| grep '^\.env'` | ✅ só `.env.example` versionado |
| `git grep` por segredos | ❌ 2 ocorrências em `implementation-status-2026-08-10.md` |

Não foram executados `pnpm test:integration`, `pnpm test:e2e` nem `pnpm build`
(exigem Docker/tempo); o CI cobre os três.

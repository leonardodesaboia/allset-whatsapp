# Evolution API — integração de mensageria

## Limites arquiteturais

O domínio e os casos de uso conhecem somente `MessagingGateway` e mensagens
canônicas. A Evolution é implementada por `EvolutionMessagingAdapter`, dentro
de `src/infrastructure/messaging/`. Trocar para Meta Cloud API requer outro
adapter registrado no composition root, sem alterar o funil ou a outbox.

O fluxo é:

```text
Evolution webhook -> normalização -> InboundMessage idempotente
                   -> ConversationEngine -> OutboxMessage
worker/cron -> endpoint interno -> MessagingGatewayRegistry -> Evolution API
```

## Configuração necessária

Defina no ambiente de produção (não use valores vazios):

```dotenv
EVOLUTION_BASE_URL="https://evolution.exemplo.com"
EVOLUTION_API_KEY="..."
EVOLUTION_INSTANCE="allset"
EVOLUTION_WEBHOOK_SECRET="<ao menos 32 caracteres aleatórios>"
INTERNAL_JOB_SECRET="<ao menos 32 caracteres aleatórios>"
OPENAI_API_KEY="<chave de servidor da OpenAI, se a transcrição estiver ativa>"
CRON_SECRET="<ao menos 32 caracteres aleatórios; usado pelo Vercel Cron>"
```

Na Evolution, configure o webhook de mensagens recebidas para:

```text
POST https://<domínio-allset>/api/messaging/evolution/webhook
x-allset-webhook-secret: <EVOLUTION_WEBHOOK_SECRET>
```

O endpoint aceita eventos `messages.upsert` compatíveis com o formato de
webhook da Evolution. Ecos enviados pela própria instância e JIDs de grupo
são ignorados. Telefones recebidos são normalizados para E.164. O identificador
externo é único por provider, portanto reentregas do webhook não avançam uma
conversa duas vezes.

Não registre essas variáveis, o payload completo do webhook, áudio ou
transcrições. Os logs devem conter apenas identificadores técnicos e status.

## Despacho da outbox

Programe um worker ou cron autenticado para chamar repetidamente:

```text
POST https://<domínio-allset>/api/internal/messaging/dispatch
x-allset-job-secret: <INTERNAL_JOB_SECRET>
```

Cada chamada despacha no máximo uma mensagem elegível. O chamador deve rodar
até a fila ficar vazia e repetir periodicamente; a outbox aplica lease, retry
com backoff e dead letter. A entrega é **at-least-once**: a chave de
idempotência é enviada ao provider, e uma falha de rede ambígua pode exigir
deduplicação pelo provider. O endpoint é interno e não deve ser exposto a
navegadores nem chamado por componentes do dashboard.

## Reengajamento de pré-cadastro silencioso

O cron também deve chamar periodicamente:

```text
POST https://<domínio-allset>/api/internal/recruitment/reengage
x-allset-job-secret: <INTERNAL_JOB_SECRET>
{ "limit": 25 }
```

O caso de uso seleciona apenas conversas em perguntas ativas, sem resposta há
`RECRUITMENT_REENGAGEMENT_AFTER_HOURS` (24 por padrão), respeitando o mesmo
intervalo entre lembretes e o teto
`RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS` (2 por padrão). Conversas pausadas,
concluídas ou em revisão humana não recebem reengajamento.

Cada tentativa grava evento/auditoria e cria uma mensagem idempotente na
outbox. O cron precisa chamar o dispatcher da outbox depois, para que o lembrete
seja efetivamente enviado pela Evolution.

### Contratos e responsabilidades

| Componente | Responsabilidade | Não faz |
| --- | --- | --- |
| `MessagingGateway` | contrato canônico de envio | conhecer Evolution ou regras do funil |
| `EvolutionMessagingAdapter` | converter texto/áudio em HTTP da Evolution | decidir transições ou acessar Prisma |
| webhook | autenticar, normalizar e persistir inbound | enviar diretamente uma resposta |
| `ConversationEngine` | interpretar resposta e enfileirar próxima pergunta | chamar HTTP da Evolution |
| outbox dispatcher | lease, retry, dead letter e envio por adapter | ser chamado pelo dashboard |
| `StorageProvider` | guardar o áudio privado e gerar URLs temporárias | tornar mídia pública permanentemente |

## Áudio e storage

O adapter envia áudio apenas quando o `StorageProvider` fornece uma URL HTTPS
temporária acessível pela Evolution. `LocalStorageProvider` é exclusivo de
desenvolvimento e é bloqueado para esse envio de propósito. Antes de ativar
áudio em produção, registrar um provider de storage compatível (por exemplo,
S3) no composition root. Webhooks de áudio já são persistidos como inbound,
mas o download da mídia e a classificação manual continuam uma tarefa de
worker própria. Após o arquivo estar no storage, o adapter
`OpenAiWhisperTranscriber` usa `whisper-1` para registrar uma transcrição como
apoio operacional; a transcrição nunca deve, por si só, reprovar a profissional.

Depois de persistir um `ReceivedAudio`, o worker chama:

```text
POST /api/internal/messaging/transcribe
x-allset-job-secret: <INTERNAL_JOB_SECRET>
{ "inboundMessageId": "<uuid>" }
```

O texto transcrito é submetido ao mesmo `ConversationEngine` usado para texto.
Uma resposta clara como “sim” pode avançar uma pergunta de opção; uma fala que
não corresponda à opção esperada segue o fallback de revisão manual.

### Worker de download e transcrição

O webhook persiste os metadados mínimos da mídia e retorna
`needsMediaDownload`; ele nunca baixa bytes no caminho público. Um worker deve
chamar o endpoint autenticado abaixo para cada `InboundMessage` de áudio:

```text
POST /api/internal/messaging/download-media
x-allset-job-secret: <INTERNAL_JOB_SECRET>
{ "limit": 10 }
```

Sem `inboundMessageId`, ele busca e processa até `limit` áudios pendentes; com
um id explícito, processa somente aquele áudio. O worker usa `EvolutionMediaDownloader` para chamar
`chat/getBase64FromMediaMessage`, grava o arquivo privado com
`recordReceivedAudio` e executa a mesma transcrição/conversa usada por
`POST /api/internal/messaging/transcribe`. As etapas são idempotentes: chamar
o endpoint novamente não duplica o asset nem avança a conversa duas vezes.

Para produção, configure um scheduler/worker externo que busque inbounds de
áudio pendentes e chame esse endpoint. O formato exato da Evolution pode variar
por versão; a homologação deve confirmar que o endpoint retorna `base64`.

### Cron de expiração do marketplace

O arquivo `vercel.json` agenda, a cada cinco minutos,
`GET /api/cron/marketplace/expire` e
`GET /api/cron/messaging/download-audio`. A Vercel envia
`Authorization: Bearer <CRON_SECRET>`; defina o mesmo valor em `CRON_SECRET`
no projeto. A primeira rota chama diretamente `expireOpportunities`; a segunda
processa até dez áudios pendentes. A transcrição usa um lease de cinco minutos,
evitando que execuções concorrentes enviem o mesmo áudio ao Whisper.

### Monitoramento de disponibilidade

O monitor de infraestrutura deve verificar periodicamente a prontidão da aplicação:

```text
GET /api/internal/health
x-allset-job-secret: <INTERNAL_JOB_SECRET>
```

`200 { "ok": true }` confirma que a aplicação consegue consultar o banco.
`503` exige investigação imediata do banco ou da conectividade da aplicação.
O endpoint não expõe segredos, configuração ou detalhes do banco.

### Segurança, privacidade e retenção

- Use segredos independentes, com ao menos 32 caracteres, para webhook e jobs.
- Restrinja os endpoints internos à rede/cron do provedor quando possível.
- Armazene áudio e documentos em bucket privado; uma URL assinada deve expirar
  em minutos, nunca ser gravada em banco ou log.
- A transcrição é dado pessoal e deve seguir a política de retenção e exclusão
  aplicável ao áudio original.
- `OPENAI_API_KEY` fica apenas no processo servidor. Não a exponha em rotas
  públicas, Server Components enviados ao cliente ou logs.

### Falhas e recuperação

| Sintoma | Resultado esperado | Ação operacional |
| --- | --- | --- |
| Webhook repetido | `duplicate: true`, sem nova pergunta | nenhuma |
| Segredo inválido | HTTP 401 | verificar configuração, não repetir com segredo em log |
| Evolution indisponível | outbox fica `FAILED` e aplica backoff | verificar saúde e deixar retry agir |
| Oito falhas de envio | outbox fica `DEAD_LETTER` | investigar e reenfileirar com nova chave se apropriado |
| Áudio sem download | HTTP 202 com `needsMediaDownload` | executar/corrigir worker de mídia |
| Whisper falha | áudio permanece guardado; worker retorna falha | repetir depois ou classificar manualmente |
| Texto ambíguo | conversa vai para revisão manual | administrador escuta e informa resposta correta |

## Homologação mínima

1. Confirme `GET /instance/connectionState/{instance}` com a chave da Evolution.
2. Envie uma primeira mensagem de um telefone de teste e verifique a criação
   de `InboundMessage`, lead, conversa e mensagens na outbox.
3. Rode o despachante e confirme o texto inicial no WhatsApp.
4. Responda às opções do pré-cadastro e confirme a mudança de coluna no funil.
5. Reenvie o mesmo webhook e confirme que não há nova pergunta nem transição.
6. Envie um OGG de teste, execute o worker de download, confira `ReceivedAudio`
   e chame o endpoint de transcrição.
7. Confirme que “sim” avança somente uma pergunta de opção e que uma fala
   ambígua não é aprovada automaticamente.

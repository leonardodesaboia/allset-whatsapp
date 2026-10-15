# WhatsMiau Cloud: WhatsApp e áudio

Referência: [API v2 oficial](https://whatsmiau.dev/docs/getting-started).
O WhatsMiau é o provider principal. A Evolution continua disponível quando
suas três variáveis de conexão estão configuradas. Não há migração de dados.

Produção: instância `AllSet`, aplicação
`https://allset-mvp-allset-app.vn6tpb.easypanel.host`.

## Rollout no Easypanel

1. Faça primeiro o deploy do código a partir de `feat/vps-deploy`, mantendo
   as variáveis `EVOLUTION_*` atuais. Sem credenciais WhatsMiau, a aplicação,
   a página admin e os workers continuam usando Evolution; quando o default
   não é explícito, ele permanece `evolution` nesse cenário.
2. Antes do corte, drene áudios pendentes da Evolution e confirme que o worker
   e os cron jobs estão ativos. Áudios criptografados antigos não podem ser
   recuperados pela API WhatsMiau.
3. Prepare a chave e a instância WhatsMiau seguindo os passos abaixo. No
   Easypanel, atualize as variáveis **do app e do worker**, defina
   `MESSAGING_DEFAULT_PROVIDER=whatsmiau` e remova juntas as três variáveis
   de conexão Evolution para ativar o alias legado. Reinicie app e worker
   (o worker mantém o registry de gateways em memória).
4. Aplique `PUT /instance/update/AllSet` com o webhook abaixo, conecte pelo
   QR e homologue texto, áudio de entrada e áudio de saída. O endpoint real é
   `https://allset-mvp-allset-app.vn6tpb.easypanel.host/api/messaging/whatsmiau/webhook`.
5. Para rollback, restaure as variáveis Evolution e o default `evolution`.
   Linhas já gravadas como `whatsmiau` ainda precisam das credenciais WhatsMiau
   para serem entregues; mantenha ambos os providers até drenar essas filas.

## Configurar a conta e a aplicação

1. Crie uma chave de API no dashboard WhatsMiau. A chave é privada do servidor.
2. Configure no ambiente:

   ```dotenv
   WHATSMIAU_BASE_URL=https://api.whatsmiau.dev/v2
   WHATSMIAU_API_KEY=<chave-do-dashboard>
   WHATSMIAU_INSTANCE=AllSet
   WHATSMIAU_WEBHOOK_SECRET=<segredo-aleatorio-de-pelo-menos-32-caracteres>
   WHATSMIAU_MEDIA_HOSTS=storage.whatsmiau.io
   MESSAGING_DEFAULT_PROVIDER=whatsmiau
   OPENAI_API_KEY=<chave-para-transcricao>
   CRON_SECRET=<outro-segredo-de-pelo-menos-32-caracteres>
   INTERNAL_JOB_SECRET=<outro-segredo-de-pelo-menos-32-caracteres>
   ```

   Gere cada segredo com `openssl rand -base64 32`. Configure também o banco,
   autenticação e storage S3/MinIO conforme `.env.example`. Áudio de saída
   exige URLs HTTPS públicas assinadas pelo storage; `local-storage://` não serve.
   `WHATSMIAU_MEDIA_HOSTS` aceita hosts exatos separados por vírgula, sem
   esquema, porta, caminho ou wildcard. Autorize somente storage de confiança.
3. Crie a instância no dashboard ou com `POST /instance/create`, usando
   `{ "instanceName": "AllSet" }`. Use esse mesmo nome em
   `WHATSMIAU_INSTANCE` e nos paths da API.
4. Atualize a instância existente. Substitua os placeholders e use `APP_URL`
   como a URL HTTPS pública da aplicação:

   ```bash
   curl -X PUT 'https://api.whatsmiau.dev/v2/instance/update/AllSet' \
     -H 'apikey: <WHATSMIAU_API_KEY>' \
     -H 'Content-Type: application/json' \
     -d '{
       "saveMedia": true,
       "groupsIgnore": true,
       "webhook": {
         "enabled": true,
         "url": "https://allset-mvp-allset-app.vn6tpb.easypanel.host/api/messaging/whatsmiau/webhook",
         "headers": { "x-allset-webhook-secret": "<WHATSMIAU_WEBHOOK_SECRET>" },
         "events": ["messages.upsert", "connection.update"],
         "base64": false
       }
     }'
   ```

   O header customizado autentica o webhook; não há assinatura documentada.
   `saveMedia: true` é essencial: sem ele não há `mediaUrl` para baixar áudio.
5. Abra `/admin/settings/evolution` (URL administrativa preservada), gere o QR
   e escaneie com o WhatsApp do número de atendimento. A página usa o provider
   selecionado por `MESSAGING_DEFAULT_PROVIDER` e mostra estado e suspensão.
   Alternativamente, use `GET /instance/connect/:name` com o header `apikey`.
   HTTP 423 indica suspensão; consulte `suspension_reason` no dashboard.
6. Confirme `state: "open"` em `GET /instance/connectionState/:name`.

## Recebimento, áudio e recuperação

Somente `messages.upsert` de números `@s.whatsapp.net` é aceito. Grupos,
ecos `fromMe`, identificadores `@lid` e eventos de atualização são ignorados.
Texto segue o roteamento de oportunidades e conversas existente. Áudio aceita
`data.message.mediaUrl` com fallback para `data.mediaUrl`, sem exigir `mediaKey`.
Persistimos apenas `mediaUrl`, `mimetype` e `fileLength` em `providerMetadata`.

Depois de persistir o áudio, o webhook publica `RECEIVED_AUDIO` com o ID da
mensagem para o worker BullMQ quando há `REDIS_URL`. Sem Redis, inicia download,
storage, transcrição e conversa em fire-and-forget e responde HTTP 202.
O worker resolve o downloader pelo provider persistido e publica o job de
despacho das respostas após o roteamento da transcrição. O download usa HTTPS,
allowlist de hosts, rejeita todos os redirects, tem timeout de 30 segundos e
limite de 25 MiB durante a leitura, e exige `Content-Type: audio/*`.
A chave `apikey` nunca é enviada ao storage.

Configure o scheduler para chamar regularmente:

```bash
curl '<APP_URL>/api/cron/messaging/download-audio' \
  -H 'Authorization: Bearer <CRON_SECRET>'
curl '<APP_URL>/api/cron/messaging/dispatch' \
  -H 'Authorization: Bearer <CRON_SECRET>'
```

O cron de áudio é a rede de segurança para falhas e interrupções do processo
inline. O processamento seleciona pendências de qualquer provider e resolve
o downloader pelo provider persistido. Para reprocessar uma mensagem específica,
use `POST /api/internal/messaging/download-media`, header
`x-allset-job-secret: <INTERNAL_JOB_SECRET>` e body
`{ "inboundMessageId": "<uuid>", "limit": 1 }`.

## Compatibilidade e envio

A outbox resolve o gateway com o `provider` da própria linha, não com o default
atual do ambiente. Quando a Evolution não está configurada, o gateway WhatsMiau
é registrado como `whatsmiau` e também como alias `evolution`. Assim filas e
conversas antigas continuam enviando sem alterar registros. Quando ambas estão
configuradas, cada provider usa sua própria API. Remova as três variáveis
`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` juntas ao fazer
o corte; configuração parcial é rejeitada.

Áudio antigo criptografado da Evolution ainda depende da API Evolution
original para download. O alias de envio não recupera mídia antiga sem URL.
Antes de desligar essa API, drene suas pendências de áudio.

Texto usa `POST /message/sendText/:instance`; áudio usa
`POST /message/sendWhatsAppAudio/:instance` com `{ number, audio: <URL HTTPS> }`.
O pré-cadastro enfileira áudio quando existe `QuestionAudioAsset` ativo para
a pergunta. Não usamos `sendMedia` para áudio nem endpoint de extração base64.

## Homologação e riscos

- Envie texto e áudio reais e confira inbound, transcrição, conversa e outbox.
- Reenvie o mesmo webhook: a deduplicação local usa provider + externalId.
- Confira a resposta de oportunidade e o áudio das perguntas de pré-cadastro.
- Simule indisponibilidade temporária do worker e confira recuperação pelo cron.
- A validade de `mediaUrl` não é documentada: baixar rapidamente reduz o risco,
  mas um cron tardio pode encontrar mídia expirada. Fire-and-forget pode ser
  interrompido em ambientes que encerram execução após a resposta HTTP.
- Não há idempotência de envio documentada no WhatsMiau. Timeout seguido de retry
  pode duplicar mensagens; a outbox é at-least-once. O ID externo usa
  `key.id ?? idempotencyKey`, pois o schema da resposta não é documentado.
- Mantenha os cron jobs ativos e monitore falhas de download, transcrição e
  dead letters. Sem credenciais reais, os testes automatizados não substituem
  essa homologação.

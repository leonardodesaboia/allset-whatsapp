# Exemplo 08 — Áudio recebido, transcrição e volta para a conversa

**Pergunta que o fluxo responde:** como uma profissional que prefere mandar áudio
consegue completar o cadastro?

Motivação de produto: parte do público-alvo tem mais facilidade em falar do que
em digitar. Todas as perguntas do pré-cadastro dizem explicitamente *"pode
escrever ou mandar um áudio"*.

---

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/infrastructure/messaging/evolution-webhook.ts` | Normaliza o evento de áudio |
| `src/application/messaging/download-received-audio.usecase.ts` | Baixa a mídia da Evolution |
| `src/application/messaging/record-received-audio.usecase.ts` | Guarda no storage e cria `ReceivedAudio` |
| `src/application/messaging/transcribe-received-audio.usecase.ts` | Chama o Whisper com lease |
| `src/application/messaging/process-pending-received-audio.usecase.ts` | Orquestra os três passos e devolve o texto ao roteador |
| `src/app/api/internal/messaging/download-media/route.ts` | Worker |
| `src/app/api/cron/messaging/download-audio/route.ts` | Cron |

---

## O caminho completo

```
1. Webhook recebe áudio ──► InboundMessage (type: AUDIO) + providerMetadata
                            responde 202 { needsMediaDownload: true }
2. Worker baixa da Evolution ──► storage (S3/MinIO) + ReceivedAudio
3. Whisper transcreve ──► ReceivedAudio.transcription
4. Texto volta para processContactConversationText ──► conversa avança
```

---

## Passo 1 — o webhook

O webhook **não processa o áudio na hora**: download e transcrição são lentos e
não cabem no tempo de resposta de um webhook.

```ts
if (event.payload.type === "AUDIO") {
  return Response.json({ ok: true, needsMediaDownload: true }, { status: 202 });
}
```

`normalizeEvolutionWebhook` guarda **apenas os campos necessários para buscar a
mídia depois** (`mediaKey`, `mimetype`, `directPath`, `url`, hashes,
`fileLength`). O comentário no código é explícito: algumas configurações da
Evolution mandam o áudio inteiro em base64 no webhook, e esse blob **não pode
entrar no banco**.

---

## Passo 2 — download

`downloadReceivedAudio` é idempotente de saída:

```ts
const existing = await prisma.receivedAudio.findUnique({ where: { inboundMessageId } });
if (existing) return ok({ inboundMessageId });
```

Depois valida que o inbound é realmente do tipo `AUDIO`, que há
`providerMetadata` e que o payload tem `externalMediaId` e `contentType` — só
então chama o `InboundMediaDownloader`. O binário vai para o storage e nasce um
`ReceivedAudio` com `storageKey`, `contentType` e `sizeBytes`.

---

## Passo 3 — transcrição, com lease

```ts
const claimed = await prisma.receivedAudio.updateMany({
  where: {
    id: audio.id,
    transcription: null,
    OR: [{ transcriptionLeaseUntil: null }, { transcriptionLeaseUntil: { lt: now } }],
  },
  data: { transcriptionLeaseUntil: new Date(now.getTime() + 5 * 60 * 1000) },
});
if (!claimed.count) return err(new DomainError("Transcrição já está em andamento", "TRANSCRIPTION_IN_PROGRESS"));
```

Isso impede dois workers de pagarem duas chamadas ao Whisper pelo mesmo áudio. A
lease de 5 minutos expira sozinha se o worker morrer no meio.

Transcrição concluída: `transcription` preenchida, lease liberada, `AuditLog`
`RECEIVED_AUDIO_TRANSCRIBED` com o modelo usado.

O comentário no topo do arquivo registra a postura de produto:

> A transcrição é uma ajuda de acessibilidade, não uma decisão de seleção.
> Falhas não apagam o áudio e podem ser revisadas manualmente.

---

## Passo 4 — o texto volta para a conversa

`processPendingReceivedAudio` fecha o ciclo:

```ts
await processContactConversationText(prisma, {
  inboundMessageId,
  phoneE164: inbound.sender,
  text: transcription.value.text,
  provider: inbound.provider,
});
```

A partir daqui, o áudio é indistinguível de uma mensagem de texto: o roteador
decide entre intenção, cliente e recrutamento exatamente como sempre.

---

## Exemplo concreto

```
Bot:  "Em qual bairro você mora? Pode escrever ou mandar áudio."
      (+ o mesmo texto em áudio, se houver QuestionAudioAsset ativo)

Pessoa: [áudio de 4s] "Eu moro na Aldeota"

Worker: download → storage → Whisper → "Eu moro na Aldeota"
        → roteador → conversation-engine
        → RecruitmentLead.neighborhood = "Eu moro na Aldeota"
        → próxima pergunta: PROFESSIONAL_EXPERIENCE
```

> Observação honesta sobre o comportamento atual: perguntas abertas gravam a
> transcrição **crua**, sem extração de entidade. O bairro fica como a pessoa
> falou. Perguntas de múltipla escolha continuam exigindo o número.

---

## Processamento em lote

Sem `inboundMessageId`, o worker busca pendências sozinho:

```ts
where: {
  provider: "evolution",
  type: "AUDIO",
  OR: [{ receivedAudio: { is: null } },                      // nunca baixado
       { receivedAudio: { is: { transcription: null } } }],  // baixado, não transcrito
},
orderBy: { receivedAt: "asc" },
take: limit,   // 1..50, padrão 10
```

Cada item é tratado em `try/catch` próprio e o resultado é devolvido item a item:

```json
{
  "ok": true,
  "processed": 3,
  "results": [
    { "inboundMessageId": "…", "ok": true },
    { "inboundMessageId": "…", "ok": false, "error": "INVALID_RECEIVED_AUDIO" },
    { "inboundMessageId": "…", "ok": true }
  ]
}
```

---

## Áudio na direção de saída

O mesmo `QuestionAudioAsset` que acompanha as perguntas é enviado pelo
`EvolutionMessagingAdapter`, que gera uma **URL assinada de 10 minutos** do
storage:

```ts
const media = await this.storage.getSignedUrl({ key: storageKey, expiresInSeconds: 600 });
if (!media.startsWith("https://")) {
  throw new Error("Evolution exige uma URL HTTPS pública e temporária para enviar áudio");
}
```

É por isso que o `LocalStorageProvider` não serve para áudio em produção — e por
isso o MinIO existe no `docker-compose.yml` para desenvolvimento.

---

## Estado atual (importante)

O código do fluxo de áudio está **completo**: webhook, download, transcrição e
roteamento de volta. O que falta é **agendamento**: o `vercel.json` só agenda o
cron de reengajamento, então nada chama `/api/cron/messaging/download-audio`
automaticamente.

Para habilitar, é preciso configurar `EVOLUTION_*` e `OPENAI_API_KEY` e agendar
uma das duas rotas. Sem isso, os áudios chegam ao webhook, ficam gravados como
`InboundMessage` — e permanecem pendentes.

Checklist operacional completo: `docs/runbooks/evolution-messaging.md`.

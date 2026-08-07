# ADR 0004 — Transcrição de áudio com Whisper

## Status

Aceito em 2026-08-07.

## Contexto

Profissionais podem responder ao recrutamento por áudio. Áudio é uma modalidade
oficial do produto, não uma exceção, mas uma resposta falada precisa poder ser
aproveitada pelo `ConversationEngine` e revisada pelo administrador.

O sistema não pode acoplar regras de recrutamento, transições de status ou o
dashboard a um SDK ou API de IA específica. Também não pode tratar a
transcrição como medida de qualidade profissional ou como decisão automática de
aprovação.

## Decisão

Criar a porta de domínio `AudioTranscriber` e implementar
`OpenAiWhisperTranscriber` na infraestrutura. O adapter chama o endpoint de
transcrição da OpenAI usando o modelo explícito `whisper-1` e recebe somente
texto normalizado.

O fluxo é:

```text
WhatsApp áudio -> InboundMessage -> download do provider -> StorageProvider
                -> ReceivedAudio -> AudioTranscriber (whisper-1)
                -> transcription -> ConversationEngine ou revisão manual
```

- A chave fica somente em `OPENAI_API_KEY` no ambiente.
- O adapter usa `multipart/form-data`, não adiciona SDK adicional e não expõe a
  chave ao browser.
- Apenas formatos de áudio aceitos são enviados; tamanho e formato são
  validados antes do storage.
- A transcrição fica em `ReceivedAudio.transcription`, e a ação é auditada.
- Se a transcrição coincidir com uma resposta válida, o mesmo motor de conversa
  processa a resposta. Caso contrário, aplica o fallback já existente de
  revisão manual.
- Uma transcrição não reprova, pontua, classifica alfabetização ou decide a
  ativação de uma profissional.

## Consequências

### Positivas

- A experiência por áudio deixa de depender de digitação.
- O administrador ganha texto pesquisável e ainda preserva o arquivo original.
- Trocar de provider de transcrição requer outro adapter, não alterações no
  domínio ou no funil.

### Riscos e controles

- Transcrições podem conter erro: o player e a revisão humana continuam sendo
  a fonte de confirmação para respostas ambíguas.
- Áudio contém dado pessoal: manter storage privado, URLs curtas e não registrar
  áudio/transcrição em logs.
- Falhas da API não podem apagar o áudio nem bloquear definitivamente a
  conversa; o worker deve permitir nova tentativa e encaminhamento manual.
- O download de mídia da Evolution é uma etapa distinta e deve concluir antes
  de chamar o transcritor.

## Referência

- [OpenAI Audio Transcriptions API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)

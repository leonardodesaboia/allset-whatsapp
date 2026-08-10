# AllSet — estado consolidado da implementação

> Atualizado em 2026-08-07 (revisão final com 7 correções aplicadas).
> Este documento é a fonte de verdade do que está implementado;
> os arquivos em `docs/superpowers/plans/` preservam o plano original e podem
> manter checkboxes históricos não atualizados.

## Leitura rápida

| Área | Estado | Entregue |
| --- | --- | --- |
| Fundação | Implementado | Next.js, Prisma, autenticação admin, auditoria, ports e guardrails |
| Funil e Kanban | Implementado | lead, máquina de estados, Kanban com todas as colunas (incl. ENTREVISTA e PRE_APROVADA), drag-and-drop com refresh, notas e perfil |
| Mensageria | Implementado | contratos canônicos, mock, inbound idempotente, outbox, retry e dead letter |
| Pré-cadastro conversacional | Implementado | INTRODUCTION automático, perguntas, branching, "não entendi", triagem com verificação de experiência |
| Áudio e Whisper | Parcial | assets, armazenamento, transcrição e encaminhamento ao engine; falta download da Evolution |
| Entrevista e referência | Implementado no domínio | models, transições, auditoria e Server Actions iniciais |
| Documentos e termos | Implementado no domínio | requisitos configuráveis, documentos privados e aceite versionado |
| Onboarding e teste | Implementado no domínio | conteúdos, conclusão e teste operacional |
| Validação e ativação | Implementado no domínio | política, registros de serviço, decisão auditada e promoção |
| Evolution em produção | Parcial | adapter, webhook e despacho; falta homologação com instância real e worker de mídia |

“Implementado no domínio” significa que a regra, persistência e auditoria
existem, mas não garante que cada formulário/tela de operação já esteja
concluído ou homologado em um ambiente com banco e WhatsApp reais.

## Arquitetura entregue

```text
src/domain/          regras puras, estados e contratos (ports)
src/application/     casos de uso transacionais e read models
src/infrastructure/  Prisma, storage, adapters Evolution/Whisper, observabilidade
src/app/             dashboard admin e rotas HTTP internas/públicas
prisma/migrations/   evolução aditiva e auditável do banco
```

As regras do funil dependem de `MessagingGateway`, `StorageProvider` e
`AudioTranscriber`, nunca de Evolution ou OpenAI. Isso permite introduzir outro
provider por adapter/composition root, sem reescrever o domínio. A decisão da
mensageria está em [ADR 0001](../adr/0001-arquitetura-monolito-modular.md) e a
de transcrição em [ADR 0004](../adr/0004-transcricao-whisper.md).

## Dados e migrations

Foram adicionadas migrations aditivas para:

1. funil de recrutamento, histórico, notas, lembretes e eventos;
2. mensagens inbound/outbound e outbox;
3. conversa persistida de pré-cadastro;
4. concorrência, leases e endurecimento do fluxo;
5. assets de perguntas e áudio recebido;
6. entrevistas, avaliações e referências;
7. documentos, requisitos e aceite de termos;
8. onboarding e teste operacional;
9. política, registros de validação e ativação.

Elas estão em [`prisma/migrations`](../../prisma/migrations). A aplicação deve
executar `pnpm prisma:deploy` antes de usar as funcionalidades novas.

## Funil de profissionais

### Entregue

- `RecruitmentLead` com origem, telefone, preferências, dados de experiência,
  disponibilidade, próxima ação e vínculo posterior ao `ProfessionalProfile`.
- Máquina de estados explícita e transição centralizada com lock otimista,
  histórico, evento operacional e `AuditLog`.
- Criação manual de lead, Kanban, drag-and-drop com validação de transição,
  perfil do lead, pesquisa, filtro “precisa de mim”, notas internas e lembretes.
- Promoção de uma lead ativa para `User`/`ProfessionalProfile` quando os dados
  mínimos existem.

### Limites atuais

- A cobertura E2E do Kanban existe, mas requer Postgres/Docker local para ser
  executada.
- A experiência do dashboard não cobre ainda todas as seções descritas no
  briefing extenso (por exemplo, telas completas de todos os agregados).

## Mensageria e ConversationEngine

### Entregue

- Envelope versionado de texto e áudio, `MessagingGateway` e registry.
- `MockMessagingAdapter` para testes sem rede.
- `InboundMessage` idempotente por `(provider, externalId)`.
- `OutboxMessage` transacional com lease, backoff exponencial, auditoria e
  `DEAD_LETTER` após oito tentativas.
- Definições de perguntas, parser de opções, branching de experiência e comandos
  globais de ajuda, ligação e parar.
- Persistência de `RecruitmentConversation`; respostas válidas atualizam o lead,
  criam a próxima outbox e mudam a coluna do Kanban.

### Limites atuais

- Triagem automática é deliberadamente simples e não avalia qualidade
  profissional.
- Algumas mensagens de recuperação previstas no briefing (“não entendi”,
  abandono e retomada configurável) ainda não possuem fluxo completo. O
  reengajamento de pré-cadastro silencioso já existe por cron interno; a
  retomada por escolha explícita continua pendente.
- O despachante é acionado por endpoint interno de worker/cron; a migração para
  um processo pg-boss ainda é evolução futura.

## Evolution API

### Entregue

- `EvolutionMessagingAdapter`: texto, áudio por URL HTTPS temporária, saúde e
  normalização de telefone para o formato aceito pela Evolution.
- Webhook `POST /api/messaging/evolution/webhook`, protegido por segredo e com
  comparação em tempo constante.
- Ignora ecos da própria instância e JIDs de grupo; persiste inbound antes de
  iniciar/processar a conversa.
- Endpoint interno `POST /api/internal/messaging/dispatch`, protegido por
  segredo, para o worker/cron consumir uma mensagem de outbox por chamada.

### Não entregue/homologado

- QR Code, conexão e saúde visíveis no dashboard.
- Um processo agendado de produção que drene a outbox.
- Homologação contra uma instância Evolution e um telefone reais.
- Download de mídia da Evolution para os bytes privados do `StorageProvider`.

O procedimento e as variáveis de ambiente estão no
[runbook Evolution e áudio](../runbooks/evolution-messaging.md).

## Áudio, storage e Whisper

### Entregue

- `QuestionAudioAsset` versionado, com tipo, duração, idioma, ativação e vínculo
  por chave de pergunta.
- `ReceivedAudio`, com arquivo privado, duração opcional e transcrição.
- `recordReceivedAudio`, que valida formato/tamanho, grava no storage e evita
  duplicação por inbound.
- `AudioTranscriber` e `OpenAiWhisperTranscriber`, usando `whisper-1` somente
  no servidor com `OPENAI_API_KEY`.
- Endpoint interno `POST /api/internal/messaging/transcribe`, que transcreve um
  áudio já armazenado e aplica o texto ao `ConversationEngine`.

### Política de segurança e produto

- Áudio e transcrição são dados pessoais; não entram em logs.
- Uma URL de mídia é temporária; storage local não é aceito para envio de áudio
  pela Evolution em produção.
- A transcrição é suporte de acessibilidade. Erro, ambiguidade ou resposta fora
  das opções levam à revisão manual, nunca a reprovação automática.
- O áudio original é preservado para conferência do administrador.

### Dependência pendente

O webhook de áudio persiste o evento e solicita download assíncrono. Falta o
adapter/job que busque a mídia da instância Evolution, chame
`recordReceivedAudio` e então o endpoint de transcrição. Sem esse job, o
Whisper não recebe automaticamente os áudios reais do WhatsApp.

## Entrevista, referências, documentos e termos

### Entregue

- Entrevista humana com início/conclusão, resultado, notas e evento.
- Avaliação confidencial com critérios internos.
- Uma ou mais referências com status de verificação e `wouldHireAgain`.
- Requisitos documentais configuráveis, documento privado, aprovação/rejeição e
  motivo de rejeição.
- Termos com versão, texto formal, explicação simplificada, mídia opcional e
  registro de aceite por canal.

### Limites atuais

- A recepção automática de documentos pelo WhatsApp depende do mesmo worker de
  mídia pendente.
- As telas completas para administrar todos esses dados ainda precisam ser
  verificadas em E2E e refinadas conforme a operação real.

## Onboarding, teste e validação

### Entregue

- Conteúdos de onboarding com tipo, texto, mídia e ordenação.
- Registro de conclusão de conteúdo.
- Teste operacional com comandos esperados e decisão `PASSED`,
  `PASSED_WITH_SUPPORT` ou `FAILED`.
- Política configurável de quantidade de serviços de validação.
- Registros de serviço, elegibilidade e decisão manual de ativar, pausar,
  reprovar ou tornar preferencial.

### Limites atuais

- O encadeamento automático dessas etapas por WhatsApp ainda depende dos jobs
  de mídia e de automação descritos acima.
- A integração com serviços reais, matching e avaliação do cliente não foi
  homologada neste workspace.

## Segurança e observabilidade

- Segredos são lidos do ambiente; valores vazios em `.env.example` são tratados
  como ausentes e não ativam integrações por acidente.
- Webhook e endpoints internos exigem segredos separados.
- Auditoria é registrada nas transições e nas mensagens/transcrições relevantes,
  sem payload sensível.
- `dependency-cruiser` preserva a dependência unidirecional e impede o domínio
  de importar infraestrutura, Prisma ou Next.js.
- O envio pela outbox evita chamadas diretas do dashboard para Evolution.

## Verificação executada nesta revisão

Executado com sucesso neste workspace:

```text
36 testes unitários
TypeScript --noEmit
ESLint sem warnings
dependency-cruiser sem violações
Prisma schema validate (com DATABASE_URL sintática temporária)
```

Não executado aqui por falta de Docker/instância/credenciais reais:

- migrations aplicadas contra Postgres local;
- testes de integração Testcontainers;
- E2E Playwright;
- webhook e envio contra Evolution real;
- chamada real à API de transcrição.

## Correções aplicadas (revisão final 2026-08-07)

Sete bugs identificados e corrigidos após revisão completa do código:

| # | Arquivo | Correção |
|---|---|---|
| 1 | `kanban-board.tsx` | `router.refresh()` após drag-and-drop bem-sucedido |
| 2 | `conversation-engine.usecase.ts` | Mensagem de INTRODUCTION enviada ao iniciar conversa |
| 3 | `conversation-engine.usecase.ts` | Comando "não entendi" repete pergunta (1ª vez) ou solicita ligação (2ª) |
| 4 | `conversation-engine.usecase.ts` | Triagem verifica área **e** experiência antes de classificar |
| 5 | `kanban-read-model.ts` | ENTREVISTA e PRE_APROVADA adicionadas às colunas do Kanban |
| 6 | `conversation-engine.usecase.ts` | `phoneE164` validado antes de qualquer enqueue |
| 7 | `dispatch/route.ts`, `transcribe/route.ts` | `compareSecret` extraído como utilitário independente (`src/infrastructure/auth/`) |

## Próxima sequência recomendada

1. Subir Postgres, aplicar migrations e executar integração/E2E.
2. Configurar Evolution, webhook e worker/cron de despacho; homologar texto.
3. Implementar o downloader de mídia da Evolution e storage HTTPS privado.
4. Homologar Whisper com áudios reais e revisão administrativa.
5. Completar automações de documento, onboarding e teste operacional sobre os
   mesmos workers.

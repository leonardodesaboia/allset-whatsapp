# Plano de migração: Redis + BullMQ + worker

**Data:** 2026-08-20  
**Status:** Proposto — não implementar em produção sem homologação  
**Objetivo:** substituir as chamadas periódicas de cron HTTP por jobs persistentes, processados por um worker dedicado, sem perder nem duplicar efeitos de negócio.

## Decisão

Adotar Redis persistente e BullMQ para executar trabalhos assíncronos. O PostgreSQL continua sendo a fonte de verdade: entidades de negócio, outbox, estado e histórico permanecem nele. Redis não deve ser tratado como banco de dados canônico.

O deploy passa a ter três serviços:

```text
Next.js web ─────┐
                 ├── PostgreSQL (fonte de verdade + outbox)
Worker BullMQ ───┤
                 └── Redis persistente (fila, atrasos e coordenação)
```

O serviço web recebe webhooks e ações administrativas. O worker envia mensagens, baixa/transcreve áudios e executa tarefas agendadas. Nenhum job crítico deve depender de uma requisição HTTP de cron para ser descoberto.

## Escopo inicial

| Job | Evento que o cria | Efeito do worker | Substitui |
|---|---|---|---|
| `message-dispatch` | nova mensagem na outbox | envia pelo `MessagingGateway` e atualiza a outbox | `/api/cron/messaging/dispatch` |
| `received-audio` | webhook de áudio recebido | baixa mídia, armazena, transcreve e continua o fluxo | `/api/cron/messaging/download-audio` |
| `opportunity-expiration` | criação de oportunidade com prazo | expira somente se ela ainda estiver aberta ao executar | `/api/cron/marketplace/expire` |
| `recruitment-reengagement` | conversa entra em estado aguardando retorno | reengaja somente se ainda estiver silenciosa e elegível | `/api/cron/recruitment/reengage` |

## Princípios obrigatórios

1. **PostgreSQL é a fonte de verdade.** Um job no Redis é uma instrução de processamento, não a confirmação de uma ação de negócio.
2. **At-least-once é assumido.** Todo handler precisa suportar execução repetida sem produzir mensagem, transcrição, expiração ou reengajamento duplicado.
3. **Sem efeito antes da persistência.** Primeiro persistir entidade/evento/outbox; depois publicar o job.
4. **Falha de publicação é recuperável.** Se Redis estiver indisponível após o commit do PostgreSQL, o item pendente continua identificável e pode ser reenfileirado.
5. **Segredos nunca entram no payload.** Jobs transportam IDs e metadados mínimos; o worker lê credenciais pelas variáveis de ambiente.
6. **O worker não importa componentes da UI.** Ele usa os mesmos casos de uso da camada de aplicação já usados pelas rotas atuais.

## Estrutura proposta

```text
src/
  application/jobs/
    enqueue-domain-job.ts
    reconcile-pending-jobs.usecase.ts
  infrastructure/jobs/
    bullmq-connection.ts
    job-queue.ts
    job-names.ts
    job-payloads.ts
    job-observability.ts
  worker/
    main.ts
    processors/
      dispatch-message.processor.ts
      process-received-audio.processor.ts
      expire-opportunity.processor.ts
      reengage-recruitment.processor.ts
```

Criar um comando separado, por exemplo `pnpm worker`, que execute `src/worker/main.ts`. O processo Next.js não deve iniciar workers embutidos: em ambientes com múltiplas réplicas isso cria consumidores e schedulers duplicados de forma difícil de controlar.

## Modelo de publicação confiável

Não tentar transformar PostgreSQL e Redis em uma transação distribuída. A sequência correta é:

1. O caso de uso grava a alteração de negócio e uma linha de outbox/evento pendente no PostgreSQL.
2. Após o commit, ele tenta publicar um job BullMQ com um `jobId` determinístico.
3. Se publicar falhar, registra erro estruturado e devolve sucesso do efeito principal quando aplicável; o evento continua pendente no PostgreSQL.
4. Um reconciliador interno percorre periodicamente registros pendentes e tenta reenfileirá-los. Durante a migração ele pode ser chamado manualmente ou pelo mecanismo de repetição próprio do worker; depois, deve virar um job recorrente BullMQ.
5. O handler revalida o estado no PostgreSQL antes de qualquer I/O e marca o resultado de modo transacional quando possível.

`jobId` deve identificar o efeito, não a tentativa. Exemplos:

```text
outbox:<outboxMessageId>
audio:<receivedMessageId>
opportunity-expiration:<opportunityId>:<expiresAt ISO>
reengagement:<conversationId>:<expectedStateVersion>
```

Isso reduz duplicatas na fila; a proteção definitiva ainda é a validação idempotente no banco.

## Configuração de filas

Todas as filas devem usar prefixo próprio do ambiente, por exemplo `allset:production` e `allset:staging`, para impedir que staging processe jobs de produção.

| Fila | Concorrência inicial | Retry | Backoff | Limite | Observação |
|---|---:|---:|---|---:|---|
| `message-dispatch` | 3 | 8 | exponencial, base 30 s | conforme limite da Evolution | preservar ordenação por conversa quando necessário |
| `received-audio` | 2 | 5 | exponencial, base 1 min | 2 simultâneos | custo e latência da transcrição |
| `opportunity-expiration` | 5 | 5 | exponencial, base 1 min | sem limite externo | job atrasado revalida status antes de expirar |
| `recruitment-reengagement` | 2 | 5 | exponencial, base 5 min | conforme mensageria | respeitar horário e máximo de tentativas |

Após esgotar tentativas, o job deve ir para a fila de falhas do BullMQ e gerar alerta. Não apagar jobs falhos automaticamente antes de haver procedimento de análise e reprocessamento.

## Regras por fluxo

### Mensagens de saída

- A outbox é criada junto da transição de negócio atual.
- O job recebe apenas `outboxMessageId`.
- O processor busca a linha e encerra sem enviar se ela já estiver `SENT`/cancelada.
- A marcação de envio deve usar estado condicional/versão para que duas tentativas não confirmem efeitos diferentes.
- Uma falha transitória da Evolution deve permitir retry; erro permanente deve marcar falha auditável e alertar.

### Áudio recebido

- O webhook persiste a mensagem recebida antes de enfileirar `received-audio`.
- O processor usa `receivedMessageId` e verifica se download/transcrição já existem.
- O arquivo deve ser persistido em storage antes de registrar conclusão.
- Uma transcrição repetida não pode criar duas mensagens de conversa ou avançar a máquina de estados duas vezes.
- Falta de `EVOLUTION_*`, storage ou `OPENAI_API_KEY` deve falhar de forma visível, sem descartar a mensagem pendente.

### Expiração de oportunidade

- Na criação, agendar para `expiresAt` com `delay = max(0, expiresAt - now)`.
- Ao processar, expirar somente se `status` ainda for aberto e `expiresAt <= now`.
- O job não deve alterar oportunidade aceita, cancelada ou já expirada.
- Em alterações de prazo, remover/substituir o job anterior usando o `jobId` que inclui a versão/prazo.

### Reengajamento de recrutamento

- Agendar quando a conversa entrar no estado que aguarda resposta, usando o horário calculado por `RECRUITMENT_REENGAGEMENT_AFTER_HOURS`.
- O processor revalida: conversa continua silenciosa, estado esperado, profissional elegível e número de tentativas abaixo de `RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS`.
- O envio de reengajamento passa pela outbox; não chamar Evolution diretamente no processor.
- Novo inbound ou avanço de estado torna o job antigo inofensivo pela revalidação de versão/estado.

## Infraestrutura e variáveis de ambiente

Adicionar ao ambiente web e worker:

```dotenv
REDIS_URL=redis://:<senha>@redis:6379/0
JOB_QUEUE_PREFIX=allset:production
WORKER_CONCURRENCY_MESSAGE_DISPATCH=3
WORKER_CONCURRENCY_RECEIVED_AUDIO=2
```

Exigir Redis com autenticação, rede privada, volume persistente, política de reinício e limite de memória configurado. Não expor a porta Redis à internet. A URL e o prefixo devem ser validados no módulo de ambiente; produção deve falhar na inicialização sem `REDIS_URL` quando o worker estiver habilitado.

No Easypanel, criar:

1. Serviço Redis persistente, acessível apenas na rede interna.
2. Serviço `web`, com `pnpm start`.
3. Serviço `worker`, usando a mesma imagem e variáveis, com `pnpm worker`.
4. Healthcheck do worker que valide conectividade Redis e PostgreSQL, sem expor segredos.

## Observabilidade e operação

Cada job deve registrar `jobName`, `jobId`, `attempt`, IDs de domínio, duração e resultado. Nunca logar telefone completo, conteúdo de mensagem, áudio, tokens ou segredos.

Criar alertas para:

- job falho após esgotar tentativas;
- fila com item mais antigo acima de 10 minutos para mensagens/áudios;
- worker sem heartbeat por mais de 2 minutos;
- crescimento sustentado de jobs pendentes;
- falhas 5xx da Evolution/OpenAI acima do limite definido.

Disponibilizar painel Bull Board apenas atrás de autenticação administrativa e rede privada, ou inicialmente usar métricas/logs sem expor painel público.

## Testes obrigatórios

1. Unitários para `jobId`, payloads, configuração de retry e cálculo de `delay`.
2. Integração com Redis descartável para publicação, consumo, retry e delayed jobs.
3. Integração com PostgreSQL para cada processor, provando idempotência após duas execuções.
4. Teste de indisponibilidade Redis após o commit do banco e posterior reconciliação.
5. Teste de reinício do worker com job ativo e de falha da Evolution/OpenAI.
6. E2E de webhook de texto e áudio até a atualização final no banco usando adaptadores de teste.
7. Cobertura de ramos de erro e de duplicidade; não considerar a migração pronta apenas porque o caminho feliz passa.

## Sequência de implementação

1. Adicionar dependências `bullmq` e cliente Redis, schema de ambiente e serviço Redis local/CI.
2. Criar abstração de fila e testes, sem alterar os fluxos existentes.
3. Migrar `message-dispatch`, mantendo a outbox como fonte de verdade.
4. Migrar `received-audio` e provar idempotência ponta a ponta.
5. Migrar `opportunity-expiration` para delayed job.
6. Migrar `recruitment-reengagement` para delayed job que gera outbox.
7. Implementar reconciliador, métricas, alertas e runbook de reprocessamento.
8. Homologar em staging com Redis e integrações reais.
9. Rodar em paralelo com os crons atuais apenas com observação controlada, evitando que ambos emitam o mesmo efeito; a idempotência deve tornar a coexistência segura.
10. Após período definido de estabilidade, remover entradas de crontab, manter as rotas somente se houver uso administrativo justificado, e atualizar os runbooks.

## Critérios para desligar os crons

Só remover os quatro crons quando todos forem verdadeiros:

- worker está estável em staging e produção, com reinício automático testado;
- mensagens, áudios, expirações e reengajamentos foram processados pelo worker em cenários reais;
- há alerta para backlog, falhas e ausência de worker;
- reconciliação de registros pendentes foi testada com Redis indisponível;
- nenhum job produziu mensagem ou transição duplicada nos testes e na observação;
- backups/restauração de PostgreSQL e persistência de Redis foram verificadas;
- o runbook de incidente explica como pausar, reprocessar e investigar jobs falhos.

## Riscos aceitos e não aceitos

Aceito: jobs podem executar mais de uma vez; os handlers devem ser idempotentes. Jobs podem atrasar durante indisponibilidade de provedor, desde que continuem recuperáveis.

Não aceito: confirmar uma mensagem sem persistir seu estado, perder item por Redis reiniciar, expor Redis/Bull Board à internet, depender exclusivamente de Redis para recuperar trabalho pendente, ou desligar crons antes de comprovar o worker em staging.

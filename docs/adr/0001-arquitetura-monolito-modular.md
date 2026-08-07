# ADR 0001: Arquitetura de Monólito Modular para AllSet MVP

**Data:** 2026-08-06  
**Status:** Aceito  
**Contexto:** Início do projeto AllSet MVP com stack greenfield  
**Decisão:** Adotar arquitetura de monólito modular em camadas, com mensageria agnóstica de provider.

## Problema

AllSet é um marketplace de serviços de limpeza doméstica acionado via WhatsApp. Precisa:
- Escalar para múltiplos fornecedores de mensageria (Evolution API hoje, Meta Cloud API amanhã)
- Implementar fluxos de negócio complexos (pedidos, profissionais, pagamentos) sem acoplamento à camada de apresentação
- Manter observabilidade e auditoria de todas as transições de estado
- Suportar jobs assíncronos confiáveis (lembretes, lembretes de pagamento, distribuição de oportunidades)

## Decisão

### Arquitetura Geral

**Monólito modular em camadas** em Next.js 16 + Node 24.x:

```
┌─────────────────────────────────────────────────────┐
│  API/Webhooks (ports)                               │
├─────────────────────────────────────────────────────┤
│  Domain (entities, value objects, máquinas de estado)│
├─────────────────────────────────────────────────────┤
│  Use Cases (orquestração de domínio)                │
├─────────────────────────────────────────────────────┤
│  Adapters (Messaging, Payment, Storage, Auth)       │
├─────────────────────────────────────────────────────┤
│  Infra (BD, cache, jobs, observabilidade)           │
└─────────────────────────────────────────────────────┘
```

- **Domain:** Entidades e regras de negócio puras (sem frameworks, sem I/O)
- **Use Cases:** Orquestração de domínio com transações e handlers de eventos
- **Adapters:** Implementações concretas de interfaces genéricas (Messaging, Payment, Storage, ErrorReporting)
- **Infra:** Prisma ORM, worker/cron de outbox (pg-boss continua a evolução
  planejada), observabilidade (Pino)

### Messaging Provider-Agnostic

Mensageria não é um serviço de terceiros — é um **adapter**:

- Interface genérica: `MessagingGateway` (send, receive, health-check, capabilities)
- Implementação 1: `MockMessagingAdapter` (em memória, não faz I/O real)
- Implementação 2: `EvolutionMessagingAdapter` (Evolution API via REST)
- Implementação 3: `MetaCloudMessagingAdapter` (Meta Cloud API — Phase 8 TBD)

Roteamento via `ProviderRouter` (configurável por cliente, tipo de mensagem, contexto).

### Confiabilidade Assíncrona: Outbox + worker

Eventos de domínio são persistidos no **outbox pattern**:

1. Use case escreve: entidade + eventos + outbox em transação atômica
2. Worker/cron autenticado lê a outbox por endpoint interno, executa o adapter
   e marca o resultado
3. Retry automático com backoff exponencial e dead letter no próprio registro
4. Trata falhas transitórias sem perder eventos

Não há filas externas (Redis, Kafka, RabbitMQ). A adoção de pg-boss permanece
planejada para automações de longa duração, sem mudar o contrato de outbox.

### Autenticação e Autorização

- **Better Auth + Prisma adapter** (senha + email)
- Único papel no MVP: `ADMIN`
- Dashboard protegido por sessão de browser
- Webhooks de mensageria (Evolution) validados por token/HMAC
- Auditoria: `AuditLog` registra toda transição de entidade crítica

### Observabilidade

- **Pino** para logs estruturados (JSON por padrão)
- **ErrorReporter port:** implementação mock → console, opcional switch para Sentry
- **Dependency-cruiser + Knip** no CI: evita importações cíclicas e dead code

## Consequências

### Vantagens

1. **Agnóstico de messaging:** swapping providers é apenas trocar uma implementação de adapter
2. **Auditável:** todos os eventos persistem antes de execução
3. **Testável:** mock adapters rodam testes de ponta a ponta sem I/O real
4. **Sem DevOps extra:** tudo roda no mesmo Postgres (outbox + dados + jobs)
5. **TypeScript strict:** erros de tipo capturados em build, não em runtime

### Desvantagens

1. **Monólito:** limite de escalabilidade horizontal está em TBD (Fase 8+)
2. **Sem gráficos de dados reais:** fase 1 usa mocks, comparação com staging apenas em Fase 7
3. **Complexidade de domínio:** máquinas de estado, value objects, outbox exigem design disciplinado

## TBDs (não resolver antes de Fase 8)

- **Provedor real de pagamento** (hoje mock, será Asaas/Stripe/outro)
- **Comissão e política comercial final** (% do profissional, descontos, promoções)
- **Prazo de repasse** (D+1, D+7, custom por profissional?)
- **Política de cancelamento** (até quando? penalidades?)
- **Critérios definitivos de documentação do profissional** (RG, CPF, comprovante de endereço, foto)
- **Setores exatos da Aldeota** (mapa de cobertura, validação de CEP)
- **Storage e infraestrutura de produção** (S3, CDN, hosting — Vercel/AWS/GCP/outro)
- **Regras fiscais** (NF eletrônica, ISS, ICMS, Nota de Serviço)
- **Migração para Meta Cloud API** (quando sair do Evolution? Como manter compatibilidade?)

Essas aparecem como:
- Feature flags (`IS_PRODUCTION_PAYMENT_ENABLED`)
- Campos `TBD` em documentação
- Mock implementations no domínio
- Contrato explícito em puertos de adapter

Nunca como valores hardcoded que assumimos sem questionar.

## Referências

- [Monolith First — Martin Fowler](https://martinfowler.com/bliki/MonolithFirst.html)
- [Hexagonal Architecture — Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)
- [Outbox Pattern — Chris Richardson](https://microservices.io/patterns/data/transactional-outbox.html)
- [CQRS/Event Sourcing — Microsoft docs](https://docs.microsoft.com/en-us/azure/architecture/patterns/cqrs)

# ADR 0002 — Fixar Prisma ORM em 6.x para o MVP (Fase 1)

## Status

Aceito (2026-08-06).

## Contexto

O roadmap do MVP (`docs/product/allset-mvp-roadmap.md`) e o plano da Fase 1
(`docs/superpowers/plans/2026-08-06-fase1-fundacao.md`) foram escritos
assumindo a sintaxe clássica do Prisma:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

```ts
new PrismaClient({ datasources: { db: { url: databaseUrl } } })
```

Durante a Task 3, ao rodar `pnpm add @prisma/client` / `pnpm add -D prisma`
sem versão fixada (conforme exige a regra de "lockfile como fonte de
verdade"), a versão resolvida foi a 7.9.1. O Prisma 7 remove o suporte a
`datasource { url = env(...) }` no schema e ao parâmetro `datasources` no
construtor do `PrismaClient` — a nova forma exige um arquivo
`prisma.config.ts` e um *driver adapter* explícito (ex.: `@prisma/adapter-pg`
+ `pg`) para toda conexão, mesmo em desenvolvimento local.

## Decisão

Fixar `@prisma/client` e `prisma` em `6.x` (`pnpm add @prisma/client@6` /
`pnpm add -D prisma@6`) para toda a Fase 1. O schema e o código de
`infrastructure/db/` usam a sintaxe clássica exatamente como escrita nas
tarefas do plano.

## Consequências

- Nenhuma dependência nova (`@prisma/adapter-pg`, `pg`) precisa ser
  justificada agora.
- O código das Tasks 3, 6 e 8 permanece simples, sem uma camada de driver
  adapter.
- **Débito técnico registrado:** migrar para o padrão de driver adapter do
  Prisma 7 (`prisma.config.ts` + `@prisma/adapter-pg`) fica como tarefa
  explícita da **Fase 8 — Estabilização**
  (`docs/product/allset-mvp-roadmap.md`), quando o projeto já tiver todo o
  domínio implementado e a migração puder ser feita de uma vez, com testes
  de regressão completos cobrindo o comportamento atual.
- Prisma 6.x continua recebendo suporte oficial; reavaliar a data-limite de
  suporte antes do início da Fase 8.

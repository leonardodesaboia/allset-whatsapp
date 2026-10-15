import { describe, expect, it } from "vitest";
import { BETTER_AUTH_SECRET_PLACEHOLDER, parseEnv, sourceForModuleEvaluation } from "@/env";

describe("parseEnv", () => {
  const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db", BETTER_AUTH_SECRET: "a".repeat(32), BETTER_AUTH_URL: "http://localhost:3000" };
  it("parses the scheduler opt-out without treating false as a truthy string", () => {
    expect(parseEnv({ ...base, INTERNAL_SCHEDULER_ENABLED: "false" }).INTERNAL_SCHEDULER_ENABLED).toBe(false);
    expect(parseEnv({ ...base, INTERNAL_SCHEDULER_ENABLED: "true" }).INTERNAL_SCHEDULER_ENABLED).toBe(true);
    expect(parseEnv(base).INTERNAL_SCHEDULER_ENABLED).toBeUndefined();
    expect(() => parseEnv({ ...base, INTERNAL_SCHEDULER_ENABLED: "invalid" })).toThrow(/INTERNAL_SCHEDULER_ENABLED/);
  });
  const production = { ...base, NODE_ENV: "production", INTERNAL_JOB_SECRET: "b".repeat(32), CRON_SECRET: "c".repeat(32) };
  const evolution = { EVOLUTION_BASE_URL: "http://evolution:8080", EVOLUTION_API_KEY: "old", EVOLUTION_INSTANCE: "AllSet", EVOLUTION_WEBHOOK_SECRET: "d".repeat(32) };
  it("preserves an Evolution-only production rollout without WhatsMiau variables", () => {
    expect(parseEnv({ ...production, ...evolution }).MESSAGING_DEFAULT_PROVIDER).toBe("evolution");
    expect(parseEnv({ ...production, ...evolution }).WHATSMIAU_API_KEY).toBeUndefined();
    expect(parseEnv({ ...production, ...evolution, MESSAGING_DEFAULT_PROVIDER: "evolution" }).MESSAGING_DEFAULT_PROVIDER).toBe("evolution");
  });
  it("requires only the configured provider secrets after cutover", () => {
    const migrated = { ...production, WHATSMIAU_API_KEY: "new", WHATSMIAU_INSTANCE: "AllSet", WHATSMIAU_WEBHOOK_SECRET: "e".repeat(32) };
    expect(parseEnv(migrated).MESSAGING_DEFAULT_PROVIDER).toBe("whatsmiau");
    expect(() => parseEnv({ ...migrated, WHATSMIAU_WEBHOOK_SECRET: undefined })).toThrow(/WHATSMIAU_WEBHOOK_SECRET/);
    expect(() => parseEnv({ ...migrated, ...evolution, EVOLUTION_WEBHOOK_SECRET: undefined })).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
  });
  it("injects WhatsMiau build secrets only during build evaluation", () => {
    const build = sourceForModuleEvaluation({ NEXT_PHASE: "phase-production-build", NODE_ENV: "production", WHATSMIAU_API_KEY: "new", WHATSMIAU_INSTANCE: "AllSet" });
    expect(parseEnv(build).WHATSMIAU_WEBHOOK_SECRET).toMatch(/^build-only-whatsmiau-/);
    expect(sourceForModuleEvaluation({ NODE_ENV: "production" }).WHATSMIAU_WEBHOOK_SECRET).toBeUndefined();
  });
  it("defaults to WhatsMiau and parses its host allowlist", () => {
    expect(parseEnv(base)).toMatchObject({ MESSAGING_DEFAULT_PROVIDER: "whatsmiau", WHATSMIAU_BASE_URL: "https://api.whatsmiau.dev/v2", WHATSMIAU_MEDIA_HOSTS: ["storage.whatsmiau.io"] });
    expect(parseEnv({ ...base, WHATSMIAU_MEDIA_HOSTS: "storage.whatsmiau.io, MEDIA.example" }).WHATSMIAU_MEDIA_HOSTS).toEqual(["storage.whatsmiau.io", "media.example"]);
    expect(() => parseEnv({ ...base, WHATSMIAU_WEBHOOK_SECRET: "short" })).toThrow(/WHATSMIAU_WEBHOOK_SECRET/);
    for (const hosts of ["", "https://storage.whatsmiau.io", "*.whatsmiau.io", "127.0.0.1"]) expect(() => parseEnv({ ...base, WHATSMIAU_MEDIA_HOSTS: hosts })).toThrow(/WHATSMIAU_MEDIA_HOSTS/);
  });
  it("aceita um conjunto válido de variáveis", () => {
    const result = parseEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      NODE_ENV: "test",
    });
    expect(result.DATABASE_URL).toContain("postgresql://");
  });

  it("aceita DATABASE_URL com esquema postgres:// (ex.: Testcontainers)", () => {
    const result = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      NODE_ENV: "test",
    });
    expect(result.DATABASE_URL).toContain("postgres://");
  });

  it("rejeita DATABASE_URL com esquema que não seja postgres", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "mysql://user:pass@localhost:3306/db",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejeita quando DATABASE_URL está ausente", () => {
    expect(() =>
      parseEnv({
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejeita o BETTER_AUTH_SECRET de placeholder do .env.example", () => {
    // `cp .env.example .env` não pode produzir um app funcional: o placeholder
    // é público (está versionado), então assinar sessão com ele permitiria
    // forjar um cookie de admin.
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        BETTER_AUTH_SECRET: BETTER_AUTH_SECRET_PLACEHOLDER,
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("o placeholder tem comprimento suficiente — só a trava explícita o barra", () => {
    // Guarda de regressão: se o placeholder encurtar para menos de 32 chars,
    // o teste acima passaria pelo motivo errado (min(32)) e a trava do
    // literal poderia ser removida sem ninguém perceber.
    expect(BETTER_AUTH_SECRET_PLACEHOLDER.length).toBeGreaterThanOrEqual(32);
  });

  it("rejeita BETTER_AUTH_SECRET curto demais", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        BETTER_AUTH_SECRET: "curto",
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("exige segredos dos jobs em produção", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://allset.example",
        NODE_ENV: "production",
      }),
    ).toThrow(/WHATSMIAU_WEBHOOK_SECRET.*INTERNAL_JOB_SECRET.*CRON_SECRET/);
  });

  it("exige o segredo do webhook Evolution em produção", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://allset.example",
        NODE_ENV: "production",
        MESSAGING_DEFAULT_PROVIDER: "evolution",
        INTERNAL_JOB_SECRET: "b".repeat(32),
        CRON_SECRET: "c".repeat(32),
      }),
    ).toThrow(/EVOLUTION_WEBHOOK_SECRET.*obrigatório em produção/);
  });

  it("aceita segredos dos jobs em produção", () => {
    expect(parseEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://allset.example",
      NODE_ENV: "production",
      MESSAGING_DEFAULT_PROVIDER: "evolution",
      EVOLUTION_WEBHOOK_SECRET: "d".repeat(32),
      INTERNAL_JOB_SECRET: "b".repeat(32),
      CRON_SECRET: "c".repeat(32),
    }).CRON_SECRET).toBe("c".repeat(32));
  });

  it("permite apenas a avaliação de módulos durante next build sem segredos de runtime", () => {
    const source = sourceForModuleEvaluation({ NEXT_PHASE: "phase-production-build" });
    expect(parseEnv(source).DATABASE_URL).toContain("postgresql://build:");
  });

  it("não injeta valores de build fora do next build", () => {
    expect(sourceForModuleEvaluation({})).toEqual({});
  });

  it("aceita a desativação dedicada do rate limit apenas em loopback", () => {
    expect(parseEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3100",
      NODE_ENV: "test",
      E2E_DISABLE_AUTH_RATE_LIMIT: "true",
    }).E2E_DISABLE_AUTH_RATE_LIMIT).toBe(true);

    expect(() => parseEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://allset.example",
      NODE_ENV: "production",
      EVOLUTION_WEBHOOK_SECRET: "d".repeat(32),
      INTERNAL_JOB_SECRET: "b".repeat(32),
      CRON_SECRET: "c".repeat(32),
      E2E_DISABLE_AUTH_RATE_LIMIT: "true",
    })).toThrow(/E2E_DISABLE_AUTH_RATE_LIMIT/);
  });
});

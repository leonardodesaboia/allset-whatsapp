import { describe, expect, it } from "vitest";
import { BETTER_AUTH_SECRET_PLACEHOLDER, parseEnv, sourceForModuleEvaluation } from "@/env";

describe("parseEnv", () => {
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

  it("permite apenas a avaliação de módulos durante next build sem segredos de runtime", () => {
    const source = sourceForModuleEvaluation({ NEXT_PHASE: "phase-production-build" });
    expect(parseEnv(source).DATABASE_URL).toContain("postgresql://build:");
  });

  it("não injeta valores de build fora do next build", () => {
    expect(sourceForModuleEvaluation({})).toEqual({});
  });
});

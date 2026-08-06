import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

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

  it("rejeita quando DATABASE_URL está ausente", () => {
    expect(() =>
      parseEnv({
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/DATABASE_URL/);
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
});

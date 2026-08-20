import { describe, expect, it } from "vitest";
import { isAuthRateLimitEnabled } from "./auth-rate-limit";

describe("isAuthRateLimitEnabled", () => {
  it("mantém o rate limit habilitado por padrão", () => {
    expect(isAuthRateLimitEnabled({
      baseUrl: "https://allset.example",
    })).toBe(true);
  });

  it("desabilita somente para o harness explícito em loopback", () => {
    expect(isAuthRateLimitEnabled({
      baseUrl: "http://localhost:3100",
      disableForE2E: true,
    })).toBe(false);
  });

  it("mantém a proteção em origem pública mesmo com flag indevida", () => {
    expect(isAuthRateLimitEnabled({
      baseUrl: "https://allset.example",
      disableForE2E: true,
    })).toBe(true);
  });
});

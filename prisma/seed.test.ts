import { describe, expect, it } from "vitest";
import { readAdminSeedConfig } from "./seed";

const testPassword = "a".repeat(12);

describe("readAdminSeedConfig", () => {
  it("requires an explicit password instead of a known default", () => {
    expect(() => readAdminSeedConfig({})).toThrow("SEED_ADMIN_PASSWORD é obrigatória");
  });

  it("normalizes and validates bootstrap settings", () => {
    expect(
      readAdminSeedConfig({
        SEED_ADMIN_EMAIL: " Admin@Example.COM ",
        SEED_ADMIN_PASSWORD: testPassword,
        SEED_ADMIN_NAME: " Admin principal ",
        SEED_ADMIN_PHONE_E164: "+5585999999999",
      }),
    ).toEqual({
      email: "admin@example.com",
      password: testPassword,
      name: "Admin principal",
      phoneE164: "+5585999999999",
    });
  });

  it("rejects an invalid admin phone number", () => {
    expect(() =>
      readAdminSeedConfig({
        SEED_ADMIN_PASSWORD: testPassword,
        SEED_ADMIN_PHONE_E164: "85999999999",
      }),
    ).toThrow("E.164");
  });
});

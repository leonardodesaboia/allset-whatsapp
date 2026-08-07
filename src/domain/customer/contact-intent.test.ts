import { describe, expect, it } from "vitest";
import { contactIntentPrompt, parseContactIntent } from "./contact-intent";

describe("contact intent", () => {
  it("uses explicit numbered options for the initial routing", () => {
    expect(contactIntentPrompt).toContain("1 — Quero contratar uma limpeza");
    expect(contactIntentPrompt).toContain("2 — Quero trabalhar como profissional");
  });

  it("parses a customer or professional selection without guessing", () => {
    expect(parseContactIntent("1")).toBe("CUSTOMER");
    expect(parseContactIntent("profissional")).toBe("PROFESSIONAL");
    expect(parseContactIntent("olá")).toBeUndefined();
  });
});

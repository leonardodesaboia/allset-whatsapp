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
  it("reconhece frases com a intenção de contratar ou trabalhar", () => {
    expect(parseContactIntent("Olá, preciso de uma diarista!")).toBe("CUSTOMER");
    expect(parseContactIntent("gostaria de contratar uma limpeza")).toBe("CUSTOMER");
    expect(parseContactIntent("bom dia, sou diarista e quero trabalhar")).toBe("PROFESSIONAL");
    expect(parseContactIntent("quero trabalhar como profissional")).toBe("PROFESSIONAL");
    expect(parseContactIntent("quero receber propostas de trabalho")).toBe("PROFESSIONAL");
    expect(parseContactIntent("não quero trabalhar")).toBeUndefined();
    expect(parseContactIntent("quero contratar e trabalhar")).toBeUndefined();
    expect(parseContactIntent("quero trabalhar ou contratar")).toBeUndefined();
    expect(parseContactIntent("1?")).toBeUndefined();
  });
});

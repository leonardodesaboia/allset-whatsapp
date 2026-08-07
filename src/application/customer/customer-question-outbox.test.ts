import { describe, expect, it } from "vitest";
import { customerQuestionText } from "./customer-question-outbox";

describe("customerQuestionText", () => {
  it("formata alternativas como escolhas numeradas", () => {
    const text = customerQuestionText("FINAL_CONFIRMATION");
    expect(text).toContain("1 — Confirmar e pagar");
    expect(text).toContain("2 — Alterar informações");
  });
});

import { describe, expect, it } from "vitest";
import { isEligibleForOpportunity } from "./opportunity-matching-policy";

describe("isEligibleForOpportunity", () => {
  const lead = { status: "ATIVA", phoneE164: "+5585999990000", proposalsAcceptedAt: new Date() };

  it("oferece a toda profissional ativa que aceitou receber propostas", () => {
    expect(isEligibleForOpportunity(lead)).toBe(true);
    expect(isEligibleForOpportunity({ ...lead, status: "PREFERENCIAL" })).toBe(true);
  });

  it("não oferece sem aceite, sem telefone ou fora de ATIVA/PREFERENCIAL", () => {
    expect(isEligibleForOpportunity({ ...lead, proposalsAcceptedAt: null })).toBe(false);
    expect(isEligibleForOpportunity({ ...lead, phoneE164: null })).toBe(false);
    expect(isEligibleForOpportunity({ ...lead, status: "PAUSADA" })).toBe(false);
    expect(isEligibleForOpportunity({ ...lead, status: "TRIAGEM" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { formatOpportunityMessage } from "./opportunity-message";

describe("formatOpportunityMessage", () => {
  const opportunity = {
    neighborhood: "Aldeota",
    // 10:00 BRT = 13:00 UTC (Fortaleza = UTC-3)
    scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
    durationMinutes: 180,
    paymentCents: 15000,
    expiresAt: new Date("2026-08-10T17:00:00.000Z"),
  };

  it("contém o bairro", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("Aldeota");
  });

  it("contém valor em reais com vírgula decimal", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("150,00");
  });

  it("contém duração em horas", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("3h");
  });

  it("contém SIM e NAO em negrito WhatsApp", () => {
    const msg = formatOpportunityMessage(opportunity);
    expect(msg).toContain("*SIM*");
    expect(msg).toContain("*NAO*");
  });
});

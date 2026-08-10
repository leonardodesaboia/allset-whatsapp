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
    responseToken: "A1B2C3D4E5",
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

  it("contém SIM, NAO e o código de correlação em negrito WhatsApp", () => {
    const msg = formatOpportunityMessage(opportunity);
    expect(msg).toContain("*SIM A1B2C3D4E5*");
    expect(msg).toContain("*NAO A1B2C3D4E5*");
  });
});

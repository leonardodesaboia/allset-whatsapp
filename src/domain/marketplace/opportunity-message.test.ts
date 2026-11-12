import { describe, expect, it } from "vitest";
import { formatOpportunityMessage } from "./opportunity-message";

describe("formatOpportunityMessage", () => {
  const opportunity = {
    neighborhood: "Aldeota",
    // 10:00 BRT = 13:00 UTC (Fortaleza = UTC-3)
    scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
    durationMinutes: 180,
    paymentCents: 15000,
    expiresAt: new Date("2026-08-09T12:30:00.000Z"),
    sentAt: new Date("2026-08-09T12:00:00.000Z"),
  };

  it("contém o bairro, a data com hora e a duração", () => {
    const msg = formatOpportunityMessage(opportunity);
    expect(msg).toContain("Bairro: Aldeota");
    expect(msg).toContain("Segunda-feira, 10 de agosto, 10:00");
    expect(msg).toContain("Cerca de 3h");
  });

  it("contém valor em reais com vírgula decimal", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("150,00");
  });

  it("pede só SIM ou NÃO, sem código de correlação", () => {
    const msg = formatOpportunityMessage(opportunity);
    expect(msg).toContain("1 — SIM, aceito");
    expect(msg).toContain("2 — NÃO posso");
    expect(msg).not.toMatch(/[A-F0-9]{10}/);
  });

  it("mostra só a hora do prazo no mesmo dia e a data quando muda o dia", () => {
    expect(formatOpportunityMessage(opportunity)).toContain("Você tem até 09:30 para responder.");
    expect(
      formatOpportunityMessage({ ...opportunity, sentAt: new Date("2026-08-09T02:50:00.000Z"), expiresAt: new Date("2026-08-09T03:20:00.000Z") })
    ).toContain("Você tem até 09/08 às 00:20 para responder.");
  });

  it("inclui a descrição do cliente e omite duração e valor quando não informados", () => {
    const msg = formatOpportunityMessage({
      ...opportunity,
      durationMinutes: null,
      paymentCents: null,
      serviceDetails: "Apto 2 quartos, limpeza pesada",
    });
    expect(msg).toContain("Detalhes: Apto 2 quartos, limpeza pesada");
    expect(msg).not.toContain("Cerca de");
    expect(msg).not.toContain("Valor estimado");
    expect(msg).toContain("combine direto com o cliente");
  });
});

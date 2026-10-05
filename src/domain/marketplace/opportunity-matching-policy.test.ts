import { describe, expect, it } from "vitest";
import { isEligibleForOpportunity } from "./opportunity-matching-policy";

// 2026-08-10 = segunda-feira (DOW=1 em UTC)
const opportunity = {
  neighborhood: "Aldeota",
  scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
  durationMinutes: 180,
};

const baseLead = {
  status: "ATIVA" as const,
  neighborhood: "Aldeota",
  canServeInitialArea: "SIM" as const,
  availabilityDays: ["segunda, quarta, sexta"] as unknown,
  phoneE164: "+5585999990001",
};

describe("isEligibleForOpportunity", () => {
  it("elegível: ATIVA, área SIM, dia disponível", () => {
    expect(isEligibleForOpportunity(baseLead, opportunity, [])).toBe(true);
  });

  it("elegível: status PREFERENCIAL", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, status: "PREFERENCIAL" as const },
      opportunity, [],
    )).toBe(true);
  });

  it("inelegível: status BASE_FUTURA", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, status: "BASE_FUTURA" as unknown as "ATIVA" },
      opportunity, [],
    )).toBe(false);
  });

  it("inelegível: canServeInitialArea NAO", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, canServeInitialArea: "NAO" as const },
      opportunity, [],
    )).toBe(false);
  });

  it("inelegível: canServeInitialArea TALVEZ + bairro diferente", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, canServeInitialArea: "TALVEZ" as const, neighborhood: "Benfica" },
      opportunity, [],
    )).toBe(false);
  });

  it("elegível: canServeInitialArea TALVEZ + mesmo bairro", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, canServeInitialArea: "TALVEZ" as const },
      opportunity, [],
    )).toBe(true);
  });

  it("inelegível: dia não disponível — domingo, profissional só seg/qua/sex", () => {
    // 2026-08-09 = domingo (DOW=0)
    expect(isEligibleForOpportunity(
      baseLead,
      { ...opportunity, scheduledAt: new Date("2026-08-09T13:00:00.000Z") },
      [],
    )).toBe(false);
  });

  it("elegível: range 'segunda-feira a sexta-feira' (nomes compostos) cobre quarta-feira", () => {
    expect(isEligibleForOpportunity(
      { ...baseLead, availabilityDays: ["segunda-feira a sexta-feira"] as unknown },
      { ...opportunity, scheduledAt: new Date("2026-08-12T13:00:00.000Z") },
      [],
    )).toBe(true);
  });

  it("elegível: range 'segunda a sexta' cobre quarta-feira", () => {
    // 2026-08-12 = quarta (DOW=3)
    expect(isEligibleForOpportunity(
      { ...baseLead, availabilityDays: ["segunda a sexta"] as unknown },
      { ...opportunity, scheduledAt: new Date("2026-08-12T13:00:00.000Z") },
      [],
    )).toBe(true);
  });

  it("range circular 'sexta a domingo' inclui sexta, sábado e domingo, mas não quinta", () => {
    const lead = { ...baseLead, availabilityDays: ["sexta a domingo"] as unknown };

    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-14T13:00:00.000Z") }, // sexta
      [],
    )).toBe(true);
    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-15T13:00:00.000Z") }, // sábado
      [],
    )).toBe(true);
    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-16T13:00:00.000Z") }, // domingo
      [],
    )).toBe(true);
    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-13T13:00:00.000Z") }, // quinta
      [],
    )).toBe(false);
  });

  it("range circular 'sábado a segunda' inclui sábado, domingo e segunda, mas não terça", () => {
    const lead = { ...baseLead, availabilityDays: ["sábado a segunda"] as unknown };

    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-15T13:00:00.000Z") }, // sábado
      [],
    )).toBe(true);
    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-16T13:00:00.000Z") }, // domingo
      [],
    )).toBe(true);
    expect(isEligibleForOpportunity(lead, opportunity, [])).toBe(true); // segunda
    expect(isEligibleForOpportunity(
      lead,
      { ...opportunity, scheduledAt: new Date("2026-08-11T13:00:00.000Z") }, // terça
      [],
    )).toBe(false);
  });

  it("inelegível: conflito de slot no mesmo dia calendario", () => {
    const sameDay = new Date("2026-08-10T06:00:00.000Z");
    expect(isEligibleForOpportunity(baseLead, opportunity, [sameDay])).toBe(false);
  });

  it("usa o dia civil de Fortaleza, não o dia UTC, para disponibilidade e conflito", () => {
    const mondayFortalezaLate = new Date("2026-08-11T02:30:00.000Z"); // segunda, 23:30 em Fortaleza
    const mondayFortalezaEarly = new Date("2026-08-10T03:30:00.000Z"); // segunda, 00:30 em Fortaleza
    expect(isEligibleForOpportunity(baseLead, { ...opportunity, scheduledAt: mondayFortalezaLate }, [])).toBe(true);
    expect(isEligibleForOpportunity(baseLead, { ...opportunity, scheduledAt: mondayFortalezaLate }, [mondayFortalezaEarly])).toBe(false);
  });

  it("elegível: conflito em dia diferente não bloqueia", () => {
    const otherDay = new Date("2026-08-11T13:00:00.000Z");
    expect(isEligibleForOpportunity(baseLead, opportunity, [otherDay])).toBe(true);
  });

  it("inelegível: phoneE164 null", () => {
    expect(isEligibleForOpportunity({ ...baseLead, phoneE164: null }, opportunity, [])).toBe(false);
  });
});

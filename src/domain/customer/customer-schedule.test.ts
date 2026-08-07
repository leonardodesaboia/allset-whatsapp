import { describe, expect, it } from "vitest";
import {
  customerScheduleDateChoices,
  parseScheduleDateChoice,
  parseScheduleTimeChoice,
  scheduledAtFromFortalezaLocal,
} from "./customer-schedule";

describe("customer schedule choices", () => {
  it("gera opções numeradas de data a partir do dia local de Fortaleza", () => {
    const base = new Date("2026-08-07T23:30:00Z");
    const choices = customerScheduleDateChoices(base);

    expect(choices[0]).toEqual({ value: "2026-08-08", label: "Amanhã (08/08)" });
    expect(choices[4]?.value).toBe("2026-08-12");
  });

  it("aceita índice para data e horário sem exigir texto livre", () => {
    const base = new Date("2026-08-07T12:00:00Z");

    expect(parseScheduleDateChoice("2", base)).toBe("2026-08-09");
    expect(parseScheduleTimeChoice("3")).toBe("13:00");
  });

  it("cria scheduledAt em UTC a partir de data e hora locais de Fortaleza", () => {
    expect(scheduledAtFromFortalezaLocal("2026-08-09", "09:00")?.toISOString()).toBe("2026-08-09T12:00:00.000Z");
  });
});

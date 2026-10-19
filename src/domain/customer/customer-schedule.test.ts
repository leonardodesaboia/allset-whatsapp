import { describe, expect, it } from "vitest";
import {
  customerScheduleDateChoices,
  interpretScheduleReply,
  parseScheduleDateChoice,
  parseScheduleDateTime,
  parseScheduleTimeChoice,
  scheduledAtFromFortalezaLocal,
} from "./customer-schedule";

describe("customer schedule choices", () => {
  it("gera opções numeradas de data a partir do dia local de Fortaleza", () => {
    const base = new Date("2026-08-07T23:30:00Z");
    const choices = customerScheduleDateChoices(base);

    expect(choices[0]).toEqual({
      value: "2026-08-08",
      label: "Amanhã (08/08)",
    });
    expect(choices[4]?.value).toBe("2026-08-12");
  });

  it("aceita índice para a data sem exigir texto livre", () => {
    const base = new Date("2026-08-07T12:00:00Z");

    expect(parseScheduleDateChoice("2", base)).toBe("2026-08-09");
  });

  it("cria scheduledAt em UTC a partir de data e hora locais de Fortaleza", () => {
    expect(
      scheduledAtFromFortalezaLocal("2026-08-09", "09:00")?.toISOString()
    ).toBe("2026-08-09T12:00:00.000Z");
  });

  it("entende data e horário na mesma mensagem", () => {
    const base = new Date("2026-08-07T12:00:00Z");
    expect(parseScheduleDateTime("amanhã às 14h", base)).toEqual({
      date: "2026-08-08",
      time: "14:00",
    });
    expect(parseScheduleDateTime("09/08 9h", base)).toEqual({
      date: "2026-08-09",
      time: "09:00",
    });
    expect(
      parseScheduleDateTime("sexta às 13h", new Date("2026-08-06T12:00:00Z"))
    ).toEqual({ date: "2026-08-07", time: "13:00" });
    expect(parseScheduleDateTime("hoje às 8h", base)).toEqual({
      date: "2026-08-07",
      time: "08:00",
    });
  });

  it("rejeita datas de calendário inválidas", () => {
    expect(
      scheduledAtFromFortalezaLocal("2026-02-31", "14:00")
    ).toBeUndefined();
  });
});

describe("interpretScheduleReply (bug: '18/10 as 14 h' gravava 08:00)", () => {
  // 15/10/2026 (quinta) 09:00 em Fortaleza
  const base = new Date("2026-10-15T12:00:00Z");
  const slot = (date: string, time: string) => ({ status: "slot", date, time });

  it.each([
    ["18/10 as 14 h", "2026-10-18", "14:00"],
    ["18/10 às 14h", "2026-10-18", "14:00"],
    ["18/10 14:00", "2026-10-18", "14:00"],
    ["dia 18 as 14", "2026-10-18", "14:00"],
    ["amanhã 14h", "2026-10-16", "14:00"],
    ["amanhã às 14h", "2026-10-16", "14:00"],
    ["19/10 14hrs", "2026-10-19", "14:00"],
    ["18/10 as 14 horas", "2026-10-18", "14:00"],
    ["18/10 2 da tarde", "2026-10-18", "14:00"],
    ["18/10 as 8h", "2026-10-18", "08:00"],
    ["19/10 9 da manhã", "2026-10-19", "09:00"],
    ["28/10 13h", "2026-10-28", "13:00"],
    ["18/10/2026 às 14h", "2026-10-18", "14:00"],
    ["depois de amanhã 9h", "2026-10-17", "09:00"],
    // opção numérica do dia + horário
    ["3 14h", "2026-10-18", "14:00"],
    ["3 - 14h", "2026-10-18", "14:00"],
    ["opção 3 às 14", "2026-10-18", "14:00"],
    ["1 às 8h", "2026-10-16", "08:00"],
  ])("%s", (text, date, time) => {
    expect(interpretScheduleReply(text, base)).toEqual(slot(date, time));
  });

  it("só o dia: pergunta o horário em seguida", () => {
    expect(interpretScheduleReply("18/10", base)).toEqual({
      status: "date_only",
      date: "2026-10-18",
    });
    expect(interpretScheduleReply("dia 18", base)).toEqual({
      status: "date_only",
      date: "2026-10-18",
    });
    expect(interpretScheduleReply("amanhã", base)).toEqual({
      status: "date_only",
      date: "2026-10-16",
    });
    expect(interpretScheduleReply("3", base)).toEqual({
      status: "date_only",
      date: "2026-10-18",
    });
  });

  it("só o horário: pede o dia", () => {
    expect(interpretScheduleReply("14 horas", base)).toEqual({
      status: "time_only",
      time: "14:00",
    });
    expect(interpretScheduleReply("2 da tarde", base)).toEqual({
      status: "time_only",
      time: "14:00",
    });
    expect(interpretScheduleReply("14hrs", base)).toEqual({
      status: "time_only",
      time: "14:00",
    });
  });

  it("aceita qualquer horário entre 6h e 22h, inclusive com minutos", () => {
    expect(interpretScheduleReply("18/10 às 15h", base)).toEqual(
      slot("2026-10-18", "15:00")
    );
    expect(interpretScheduleReply("18/10 14:30", base)).toEqual(
      slot("2026-10-18", "14:30")
    );
    expect(interpretScheduleReply("amanhã 10h", base)).toEqual(
      slot("2026-10-16", "10:00")
    );
    expect(interpretScheduleReply("sábado 7h45", base)).toEqual(
      slot("2026-10-17", "07:45")
    );
  });

  it("nunca cai silenciosamente em outro horário", () => {
    expect(interpretScheduleReply("amanhã 3h", base)).toMatchObject({
      status: "time_unavailable",
      hour: 3,
    });
    expect(interpretScheduleReply("18/10 23h", base)).toEqual({
      status: "time_unavailable",
      date: "2026-10-18",
      hour: 23,
      minute: 0,
    });
    expect(interpretScheduleReply("qualquer dia", base)).toEqual({
      status: "unknown",
    });
    expect(interpretScheduleReply("31/02 14h", base)).toEqual({
      status: "unknown",
    });
  });

  it("parseScheduleDateTime não confunde o dia do mês com a hora", () => {
    expect(parseScheduleDateTime("18/10 as 14 h", base)).toEqual({
      date: "2026-10-18",
      time: "14:00",
    });
    expect(parseScheduleDateTime("19/10", base)).toBeUndefined();
  });

  it("horário livre no passo de horário", () => {
    expect(parseScheduleTimeChoice("14h")).toBe("14:00");
    expect(parseScheduleTimeChoice("14")).toBe("14:00");
    expect(parseScheduleTimeChoice("2 da tarde")).toBe("14:00");
    expect(parseScheduleTimeChoice("às 9")).toBe("09:00");
    expect(parseScheduleTimeChoice("15h")).toBe("15:00");
    expect(parseScheduleTimeChoice("10:30")).toBe("10:30");
    expect(parseScheduleTimeChoice("3h")).toBeUndefined();
    expect(parseScheduleTimeChoice("25h")).toBeUndefined();
  });
});

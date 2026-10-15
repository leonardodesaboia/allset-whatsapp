import { describe, expect, it } from "vitest";
import { formatBRL, formatPhone, formatRelative } from "./format";

describe("formatPhone", () => {
  it("formata celular brasileiro com DDI", () => {
    expect(formatPhone("5585999998888")).toBe("+55 (85) 99999-8888");
  });

  it("formata fixo e aceita +", () => {
    expect(formatPhone("+558533334444")).toBe("+55 (85) 3333-4444");
  });

  it("devolve o original quando não reconhece e traço quando vazio", () => {
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone(null)).toBe("—");
  });
});

describe("formatBRL", () => {
  it("formata centavos em reais", () => {
    expect(formatBRL(12345).replace(/\s/g, " ")).toBe("R$ 123,45");
  });

  it("devolve traço quando ausente", () => {
    expect(formatBRL(null)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("usa minutos, horas e dias", () => {
    expect(formatRelative(new Date("2026-10-15T11:55:00Z"), now)).toBe(
      "há 5 min"
    );
    expect(formatRelative(new Date("2026-10-15T09:00:00Z"), now)).toBe(
      "há 3 h"
    );
    expect(formatRelative(new Date("2026-10-13T12:00:00Z"), now)).toBe(
      "há 2 dias"
    );
    expect(formatRelative(new Date("2026-10-14T12:00:00Z"), now)).toBe(
      "há 1 dia"
    );
  });

  it("trata futuro e agora", () => {
    expect(formatRelative(new Date("2026-10-15T12:30:00Z"), now)).toBe(
      "em 30 min"
    );
    expect(formatRelative(new Date("2026-10-15T12:00:20Z"), now)).toBe("agora");
  });
});

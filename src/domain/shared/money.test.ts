import { describe, expect, it } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  it("armazena valores em centavos inteiros", () => {
    expect(Money.fromCents(14_500).cents).toBe(14_500);
  });

  it("rejeita valores fracionários", () => {
    expect(() => Money.fromCents(14_500.5)).toThrow(/inteiro/);
  });

  it("rejeita valores negativos", () => {
    expect(() => Money.fromCents(-100)).toThrow(/negativo/);
  });

  it("soma dois valores", () => {
    const total = Money.fromCents(10_000).add(Money.fromCents(4_500));
    expect(total.cents).toBe(14_500);
  });

  it("formata em BRL", () => {
    // toLocaleString uses non-breaking space (U+00A0) between symbol and amount
    expect(Money.fromCents(14_500).formatBRL()).toBe("R$ 145,00");
  });
});

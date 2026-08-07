export class Money {
  private constructor(public readonly cents: number) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new Error("Money deve ser um valor inteiro de centavos");
    }
    if (cents < 0) {
      throw new Error("Money não pode ser negativo");
    }
    return new Money(cents);
  }

  add(other: Money): Money {
    return Money.fromCents(this.cents + other.cents);
  }

  formatBRL(): string {
    return (this.cents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }
}

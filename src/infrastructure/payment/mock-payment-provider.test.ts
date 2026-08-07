import { describe, expect, it } from "vitest";
import { MockPaymentProvider } from "./mock-payment-provider";
import { Money } from "../../domain/shared/money";

describe("MockPaymentProvider", () => {
  it("cria uma cobrança PENDING e a mesma idempotencyKey retorna a mesma cobrança", async () => {
    const provider = new MockPaymentProvider();
    const request = {
      idempotencyKey: "booking:1:charge:v1",
      bookingId: "1",
      amount: Money.fromCents(14_500),
      description: "Limpeza comum",
    };

    const first = await provider.createCharge(request);
    const second = await provider.createCharge(request);

    expect(first.status).toBe("PENDING");
    expect(second.externalId).toBe(first.externalId);
  });

  it("confirmPayment (helper de teste) move o status para PAID", async () => {
    const provider = new MockPaymentProvider();
    const { externalId } = await provider.createCharge({
      idempotencyKey: "booking:2:charge:v1",
      bookingId: "2",
      amount: Money.fromCents(10_000),
      description: "Limpeza comum",
    });

    provider.simulateConfirmation(externalId);

    expect(await provider.getChargeStatus(externalId)).toBe("PAID");
  });

  it("refund muda o status para REFUNDED", async () => {
    const provider = new MockPaymentProvider();
    const { externalId } = await provider.createCharge({
      idempotencyKey: "booking:3:charge:v1",
      bookingId: "3",
      amount: Money.fromCents(10_000),
      description: "Limpeza comum",
    });
    provider.simulateConfirmation(externalId);

    await provider.refund(externalId, Money.fromCents(10_000));

    expect(await provider.getChargeStatus(externalId)).toBe("REFUNDED");
  });
});

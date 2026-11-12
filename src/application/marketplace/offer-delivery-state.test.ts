import { describe, expect, it, vi } from "vitest";
import { findOfferBlockUntil, releaseHeldOffers } from "./offer-delivery-state";

const now = new Date("2026-11-12T12:00:00.000Z");
const input = {
  recipient: "+5585999990000",
  opportunityId: "opp-2",
  outboxId: "out-2",
  now,
};

function fakeDb(options: { inFlight?: boolean; openExpiresAt?: Date | null }) {
  return {
    outboxMessage: {
      findFirst: vi.fn(async () => (options.inFlight ? { id: "out-1" } : null)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    opportunityResponse: {
      findFirst: vi.fn(async () =>
        options.openExpiresAt ? { expiresAt: options.openExpiresAt } : null
      ),
    },
  };
}

describe("findOfferBlockUntil", () => {
  it("libera a proposta quando a profissional não tem outra aberta", async () => {
    expect(await findOfferBlockUntil(fakeDb({}) as never, input)).toBeNull();
  });

  it("segura a proposta até o prazo da proposta aberta", async () => {
    const openExpiresAt = new Date(now.getTime() + 20 * 60_000);
    expect(
      await findOfferBlockUntil(fakeDb({ openExpiresAt }) as never, input)
    ).toEqual(openExpiresAt);
  });

  it("reavalia em breve enquanto outra proposta ainda está sendo entregue", async () => {
    const until = await findOfferBlockUntil(
      fakeDb({ inFlight: true }) as never,
      input
    );
    expect(until!.getTime() - now.getTime()).toBe(60_000);
  });
});

describe("releaseHeldOffers", () => {
  it("antecipa só propostas pendentes dos telefones informados", async () => {
    const db = fakeDb({});
    await releaseHeldOffers(db as never, ["+1", null, "+1", "+2"], now);
    expect(db.outboxMessage.updateMany).toHaveBeenCalledWith({
      where: {
        recipient: { in: ["+1", "+2"] },
        status: "PENDING",
        idempotencyKey: { endsWith: ":offer" },
        availableAt: { gt: now },
      },
      data: { availableAt: now },
    });
  });

  it("não consulta o banco sem telefones", async () => {
    const db = fakeDb({});
    await releaseHeldOffers(db as never, [null], now);
    expect(db.outboxMessage.updateMany).not.toHaveBeenCalled();
  });
});

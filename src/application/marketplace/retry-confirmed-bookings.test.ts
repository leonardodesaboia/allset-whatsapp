import { expect, it, vi } from "vitest";
import { retryConfirmedBookings } from "./notify-opportunity.usecase";

it("isola falhas por pedido e continua distribuindo os demais", async () => {
  const failure = new Error("O pedido precisa de data e local do atendimento");
  const prisma = {
    recruitmentLead: { count: vi.fn(async () => 2) },
    booking: { findMany: vi.fn(async () => [{ id: "broken" }, { id: "ok" }]) },
    $transaction: vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ notified: 2, dispatched: true }),
  };
  expect(await retryConfirmedBookings(prisma as never)).toEqual({
    dispatched: 1,
    failures: [{ bookingId: "broken", error: failure }],
  });
  expect(prisma.$transaction).toHaveBeenCalledTimes(2);
});

import { beforeEach, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { retryConfirmedBookings } from "@/application/marketplace/notify-opportunity.usecase";
import { dispatchNextOutboxMessage } from "@/application/messaging/dispatch-outbox.usecase";
import { getNextOutboxDispatchAt } from "@/application/messaging/next-outbox-dispatch-at.usecase";
import { logger } from "@/infrastructure/observability/logger";
import { dispatchMessageProcessor } from "./dispatch-message.processor";

vi.mock("@/infrastructure/db/prisma-client", () => ({ prisma: {} }));
vi.mock("@/infrastructure/messaging/messaging-runtime", () => ({
  createMessagingGatewayRegistry: vi.fn(() => ({})),
}));
vi.mock("@/infrastructure/jobs/publish-job", () => ({
  publishJobSafe: vi.fn(async () => {}),
}));
vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/application/marketplace/notify-opportunity.usecase", () => ({
  retryConfirmedBookings: vi.fn(),
}));
vi.mock("@/application/messaging/dispatch-outbox.usecase", () => ({
  dispatchNextOutboxMessage: vi.fn(),
}));
vi.mock("@/application/messaging/next-outbox-dispatch-at.usecase", () => ({
  getNextOutboxDispatchAt: vi.fn(),
}));

const job = { id: "job-1", data: {} } as Job<Record<string, never>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(dispatchNextOutboxMessage)
    .mockResolvedValueOnce({
      id: "out-1",
      status: "SENT",
      idempotencyKey: "customer:1",
      correlationId: null,
      attempts: 1,
      availableAt: new Date(),
    } as never)
    .mockResolvedValue(null);
  vi.mocked(getNextOutboxDispatchAt).mockResolvedValue(
    new Date(Date.now() + 30_000)
  );
});

it("continua drenando a outbox quando a recuperação de pedidos falha", async () => {
  vi.mocked(retryConfirmedBookings).mockRejectedValue(
    new Error("pedido sem local")
  );
  await expect(dispatchMessageProcessor(job)).resolves.toBeUndefined();
  expect(dispatchNextOutboxMessage).toHaveBeenCalled();
  expect(publishJobSafe).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "message-dispatch",
      delay: expect.any(Number),
    })
  );
  expect(logger.error).toHaveBeenCalled();
});

it("registra cada pedido que falhou sem interromper o envio", async () => {
  vi.mocked(retryConfirmedBookings).mockResolvedValue({
    dispatched: 1,
    failures: [{ bookingId: "b-1", error: new Error("x") }],
  });
  await dispatchMessageProcessor(job);
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ bookingId: "b-1" }),
    expect.any(String)
  );
  expect(dispatchNextOutboxMessage).toHaveBeenCalled();
});

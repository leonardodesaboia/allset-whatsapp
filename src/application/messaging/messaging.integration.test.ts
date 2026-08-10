import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { textPayload } from "../../domain/messaging/message";
import { MockMessagingAdapter } from "../../infrastructure/messaging/mock-messaging-adapter";
import { StaticMessagingGatewayRegistry } from "../../infrastructure/messaging/messaging-gateway-registry";
import { dispatchNextOutboxMessage } from "./dispatch-outbox.usecase";
import { enqueueOutboundMessage } from "./enqueue-outbound-message.usecase";
import { processInboundEvent } from "./process-inbound-event.usecase";

describe("mensageria genérica", () => {
  let prisma: PrismaClient; let stop: () => Promise<void>;
  beforeAll(async () => { const database = await startTestDatabase(); prisma = database.prisma; stop = database.stop; }, 60_000);
  afterAll(async () => stop());
  it("despacha uma outbox pendente e registra sucesso", async () => { const queued = await enqueueOutboundMessage(prisma, { provider: "mock", recipient: "+5585", payload: textPayload("Olá"), idempotencyKey: `outbox-${Date.now()}`, actor: "test" }); const mock = new MockMessagingAdapter(); const sent = await dispatchNextOutboxMessage(prisma, new StaticMessagingGatewayRegistry([["mock", mock]])); expect(sent?.id).toBe(queued.id); expect(sent?.status).toBe("SENT"); expect(mock.sent).toHaveLength(1); });
  it("mantém falha recuperável", async () => { await enqueueOutboundMessage(prisma, { provider: "mock", recipient: "+5585", payload: textPayload("Falha"), idempotencyKey: `outbox-failure-${Date.now()}`, actor: "test" }); const mock = new MockMessagingAdapter(); mock.failNext(); const failed = await dispatchNextOutboxMessage(prisma, new StaticMessagingGatewayRegistry([["mock", mock]])); expect(failed?.status).toBe("FAILED"); expect(failed?.attempts).toBe(1); expect(failed?.lastError).toContain("Falha simulada"); });
  it("trata inbound repetido de forma idempotente", async () => { const input = { provider: "mock", externalId: `event-${Date.now()}`, sender: "+5585", recipient: "+5511", payload: textPayload("Oi") }; const first = await processInboundEvent(prisma, input); const second = await processInboundEvent(prisma, input); expect(first.duplicate).toBe(false); expect(second.duplicate).toBe(true); expect(second.message.id).toBe(first.message.id); });
});

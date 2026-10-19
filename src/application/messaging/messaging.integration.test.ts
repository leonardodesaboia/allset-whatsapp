import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { textPayload } from "../../domain/messaging/message";
import { MockMessagingAdapter } from "../../infrastructure/messaging/mock-messaging-adapter";
import { StaticMessagingGatewayRegistry } from "../../infrastructure/messaging/messaging-gateway-registry";
import { dispatchNextOutboxMessage } from "./dispatch-outbox.usecase";
import { enqueueOutboundMessage } from "./enqueue-outbound-message.usecase";
import { processInboundEvent } from "./process-inbound-event.usecase";
import { getNextOutboxDispatchAt } from "./next-outbox-dispatch-at.usecase";

describe("mensageria genérica", () => {
  let prisma: PrismaClient; let stop: () => Promise<void>;
  beforeAll(async () => { const database = await startTestDatabase(); prisma = database.prisma; stop = database.stop; }, 60_000);
  afterAll(async () => stop());
  it("despacha uma outbox pendente e registra sucesso", async () => { const queued = await enqueueOutboundMessage(prisma, { provider: "mock", recipient: "+5585", payload: textPayload("Olá"), idempotencyKey: `outbox-${Date.now()}`, actor: "test" }); const mock = new MockMessagingAdapter(); const sent = await dispatchNextOutboxMessage(prisma, new StaticMessagingGatewayRegistry([["mock", mock]])); expect(sent?.id).toBe(queued.id); expect(sent?.status).toBe("SENT"); expect(mock.sent).toHaveLength(1); });
  it("mantém falha recuperável", async () => { await enqueueOutboundMessage(prisma, { provider: "mock", recipient: "+5585", payload: textPayload("Falha"), idempotencyKey: `outbox-failure-${Date.now()}`, actor: "test" }); const mock = new MockMessagingAdapter(); mock.failNext(); const failed = await dispatchNextOutboxMessage(prisma, new StaticMessagingGatewayRegistry([["mock", mock]])); expect(failed?.status).toBe("FAILED"); expect(failed?.attempts).toBe(1); expect(failed?.lastError).toContain("Falha simulada"); });
  it("trata inbound repetido de forma idempotente", async () => { const input = { provider: "mock", externalId: `event-${Date.now()}`, sender: "+5585", recipient: "+5511", payload: textPayload("Oi") }; const first = await processInboundEvent(prisma, input); const second = await processInboundEvent(prisma, input); expect(first.duplicate).toBe(false); expect(second.duplicate).toBe(true); expect(second.message.id).toBe(first.message.id); });
  it("compartilha o intervalo de 30s entre despachos concorrentes e mantém a fila", async () => {
    await prisma.outboxMessage.deleteMany();
    for (let i = 0; i < 3; i++) await enqueueOutboundMessage(prisma, {
      provider: "evolution", recipient: `+558599990000${i}`, payload: textPayload("Proposta"),
      idempotencyKey: `throttle-${i}`, actor: "test",
      priority: i === 1 ? 0 : -1,
    });
    const gateway = new MockMessagingAdapter();
    const registry = new StaticMessagingGatewayRegistry([["evolution", gateway]]);
    await Promise.all(Array.from({ length: 5 }, () => dispatchNextOutboxMessage(prisma, registry)));
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.recipient).toBe("+5585999900001");
    expect(await prisma.outboxMessage.count({ where: { status: "PENDING" } })).toBe(2);
    const throttle = await prisma.messagingDispatchThrottle.findUniqueOrThrow({ where: { provider: "evolution" } });
    expect(throttle.nextSendAt.getTime() - Date.now()).toBeGreaterThan(25_000);
    expect(await dispatchNextOutboxMessage(prisma, registry)).toBeNull();
    await prisma.messagingDispatchThrottle.update({ where: { provider: "evolution" }, data: { nextSendAt: new Date(0) } });
    expect((await dispatchNextOutboxMessage(prisma, registry))?.status).toBe("SENT");
    expect(gateway.sent).toHaveLength(2);
  });

  it("não deixa uma lease futura bloquear mensagens prontas", async () => {
    await prisma.outboxMessage.deleteMany();
    const now = Date.now();
    const throttleAt = new Date(now + 30_000);
    const leaseAt = new Date(now + 300_000);
    await prisma.messagingDispatchThrottle.upsert({ where: { provider: "evolution" }, create: { provider: "evolution", nextSendAt: throttleAt }, update: { nextSendAt: throttleAt } });
    await prisma.outboxMessage.create({ data: {
      provider: "evolution", recipient: "+5585999900001", type: "TEXT", payload: { ...textPayload("Em envio") },
      idempotencyKey: "stuck-lease", status: "SENDING", availableAt: new Date(now - 60_000), leaseExpiresAt: leaseAt,
    } });
    const ready = await enqueueOutboundMessage(prisma, {
      provider: "evolution", recipient: "+5585999900002", payload: textPayload("Pronta"), idempotencyKey: "ready-after-lease", actor: "test",
    });
    expect(await getNextOutboxDispatchAt(prisma)).toEqual(throttleAt);
    await prisma.outboxMessage.delete({ where: { id: ready.id } });
    expect(await getNextOutboxDispatchAt(prisma)).toEqual(leaseAt);
  });

  it("cancela cobranças legadas antes de chamar o gateway", async () => {
    await prisma.outboxMessage.deleteMany();
    await enqueueOutboundMessage(prisma, {
      provider: "mock", recipient: "+5585999900001", payload: textPayload("Realize o PIX"),
      idempotencyKey: "payment-reminder:legacy", actor: "test",
    });
    const gateway = new MockMessagingAdapter();
    const result = await dispatchNextOutboxMessage(prisma, new StaticMessagingGatewayRegistry([["mock", gateway]]));
    expect(result?.status).toBe("CANCELLED");
    expect(gateway.sent).toHaveLength(0);
  });
});

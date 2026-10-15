import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { processInboundEvent } from "../messaging/process-inbound-event.usecase";
import { routeInboundText } from "../messaging/route-inbound-text.usecase";
import { textPayload } from "../../domain/messaging/message";

describe("customer configuration handoff", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let seq = 0;
  const logger = { error: vi.fn() };
  const neutral = "Recebemos seu pedido. Nossa equipe vai continuar o atendimento por aqui em breve.";

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
    await prisma.serviceDefinition.create({ data: { code: "CLEANING", name: "Limpeza" } });
    await prisma.propertyPricingTier.create({ data: { label: "Apartamento", characteristics: { bedrooms: 2 }, priceCents: 15000, durationMinutes: 180 } });
  }, 60_000);
  afterAll(async () => stop());
  beforeEach(async () => {
    logger.error.mockClear();
    await prisma.serviceDefinition.updateMany({ data: { isActive: true } });
    await prisma.propertyPricingTier.updateMany({ data: { isActive: true } });
  });

  async function receive(sender: string, text: string) {
    const { message } = await processInboundEvent(prisma, { provider: "mock", externalId: randomUUID(), sender, recipient: "allset", payload: textPayload(text) });
    return routeInboundText(prisma, { inboundMessageId: message.id, phoneE164: sender, text, provider: "mock" }, logger);
  }
  const phone = () => `+5585922${String(++seq).padStart(6, "0")}`;
  async function notices(sender: string) {
    const rows = await prisma.outboxMessage.findMany({ where: { recipient: sender } });
    return rows.map((row) => (row.payload as { text: string }).text);
  }
  function expectConfigurationLog(reason: string) {
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ reason, provider: "mock" }), "Customer flow blocked: no active pricing tiers/service configured");
  }

  it("uses a neutral handoff when returning customers have no active pricing tier", async () => {
    const sender = phone();
    await prisma.user.create({ data: { phoneE164: sender, fullName: "Maria", role: "CUSTOMER" } });
    await prisma.propertyPricingTier.updateMany({ data: { isActive: false } });
    await receive(sender, "Olá");
    await receive(sender, "1");
    expect(await notices(sender)).toContain(neutral);
    expect((await notices(sender)).join(" ")).not.toContain("Vamos validar o endereço");
    expectConfigurationLog("PRICING_NOT_CONFIGURED");
  });

  it("uses a neutral handoff after collecting a new customer's name without active pricing", async () => {
    const sender = phone();
    await prisma.propertyPricingTier.updateMany({ data: { isActive: false } });
    for (const text of ["Olá", "1", "Maria Souza"]) await receive(sender, text);
    expect(await notices(sender)).toContain(neutral);
    expect((await notices(sender)).join(" ")).not.toContain("Vamos validar o endereço");
    expectConfigurationLog("PRICING_NOT_CONFIGURED");
  });

  it("uses a neutral handoff if a tier is selected but no service is active", async () => {
    const sender = phone();
    await prisma.serviceDefinition.updateMany({ data: { isActive: false } });
    for (const text of ["Olá", "1", "Maria Souza", "1"]) await receive(sender, text);
    expect(await notices(sender)).toContain(neutral);
    expect((await notices(sender)).join(" ")).not.toContain("Vamos validar o endereço");
    expectConfigurationLog("SERVICE_NOT_CONFIGURED");
  });

  it("keeps the address validation notice only after receiving an address", async () => {
    const sender = phone();
    for (const text of ["Olá", "1", "Maria Souza", "1", "amanhã às 14h"]) await receive(sender, text);
    expect((await notices(sender)).join(" ")).not.toContain("Vamos validar o endereço");
    await receive(sender, "Rua Teste, 123, Meireles");
    expect(await notices(sender)).toContain("Recebemos seus dados. Vamos validar o endereço e continuaremos por aqui.");
    expect(logger.error).not.toHaveBeenCalled();
  });
});

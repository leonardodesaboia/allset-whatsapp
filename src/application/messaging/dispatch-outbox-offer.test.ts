import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchNextOutboxMessage } from "./dispatch-outbox.usecase";
import { prepareOpportunityDelivery } from "../marketplace/prepare-opportunity-delivery.usecase";

vi.mock("../audit/record-audit-log.usecase", () => ({ recordAuditLog: vi.fn() }));
vi.mock("../marketplace/prepare-opportunity-delivery.usecase", () => ({ prepareOpportunityDelivery: vi.fn() }));

const delivery = { responseId: "response-1", sentAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60_000) };
const offer = {
  id: "out-1", provider: "mock", recipient: "+5585999990000", type: "TEXT", status: "PENDING", attempts: 0,
  idempotencyKey: "opportunity:opp-1:lead-1:offer", correlationId: "opp-1", payload: { version: 1, type: "TEXT", text: "x" },
  availableAt: new Date(), leaseExpiresAt: null,
};

function fakePrisma(options: { blockedUntil?: Date } = {}) {
  const db = {
    outboxMessage: {
      findFirst: vi.fn(async (args: { where: { status?: string } }) => (args.where.status === "SENDING" ? null : offer)),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => offer),
      findUniqueOrThrow: vi.fn(async () => offer),
    },
    serviceOpportunity: { findUnique: vi.fn(async () => ({ status: "OPEN" })) },
    recruitmentLead: {
      findUnique: vi.fn(async () => ({ status: "ATIVA", phoneE164: offer.recipient, proposalsAcceptedAt: new Date() })),
    },
    // Lease por provider que serializa os envios.
    messagingProviderState: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    opportunityResponse: {
      findFirst: vi.fn(async () => (options.blockedUntil ? { expiresAt: options.blockedUntil } : null)),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}

const registry = (send: () => Promise<{ externalId: string }>) => ({
  get: () => ({ send, capabilities: () => ({ text: true, audio: false }), health: async () => ({ ok: true }) }),
});

describe("dispatchNextOutboxMessage para propostas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prepareOpportunityDelivery).mockResolvedValue({ payload: { version: 1, type: "TEXT", text: "Nova proposta" }, delivery });
  });

  it("não marca a proposta como entregue quando o envio falha", async () => {
    const prisma = fakePrisma();
    await dispatchNextOutboxMessage(prisma as never, registry(async () => { throw new Error("timeout"); }) as never);
    expect(prisma.opportunityResponse.update).not.toHaveBeenCalled();
  });

  it("grava o prazo individual junto com a confirmação do envio", async () => {
    const prisma = fakePrisma();
    await dispatchNextOutboxMessage(prisma as never, registry(async () => ({ externalId: "wa-1" })) as never);
    expect(prisma.opportunityResponse.update).toHaveBeenCalledWith({
      where: { id: "response-1" },
      data: { sentAt: delivery.sentAt, expiresAt: delivery.expiresAt },
    });
  });

  it("segura a proposta enquanto a profissional tem outra aberta, sem enviar", async () => {
    const blockedUntil = new Date(Date.now() + 10 * 60_000);
    const prisma = fakePrisma({ blockedUntil });
    const send = vi.fn(async () => ({ externalId: "wa-1" }));
    await dispatchNextOutboxMessage(prisma as never, registry(send) as never);
    expect(send).not.toHaveBeenCalled();
    expect(prisma.outboxMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { availableAt: blockedUntil } }));
  });
});

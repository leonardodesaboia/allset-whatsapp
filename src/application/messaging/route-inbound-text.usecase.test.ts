import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeInboundText } from "./route-inbound-text.usecase";
import { processOpportunityResponse } from "../marketplace/process-opportunity-response.usecase";
import { processContactConversationText } from "./process-contact-conversation-text.usecase";

vi.mock("../marketplace/process-opportunity-response.usecase", () => ({
  processOpportunityResponse: vi.fn(async () => ({ outcome: "ACCEPTED" })),
  requestOpportunityClarification: vi.fn(async () => ({
    outcome: "AMBIGUOUS_RESPONSE",
  })),
}));
vi.mock("./process-contact-conversation-text.usecase", () => ({
  processContactConversationText: vi.fn(async () => ({
    routed: "recruitment",
  })),
}));

const input = {
  inboundMessageId: "inbound-1",
  phoneE164: "+5585999990000",
  text: "sim",
  provider: "mock",
};
const response = (id: string, expiresAt: Date | null) => ({
  id,
  opportunityId: `opp-${id}`,
  leadId: "lead-1",
  expiresAt,
  responseToken: null,
});

function fakePrisma(options: {
  open?: ReturnType<typeof response>[];
  sentKeys?: string[];
  recent?: { id: string } | null;
}) {
  return {
    opportunityResponse: {
      findMany: vi.fn(async () => options.open ?? []),
      findFirst: vi.fn(async () => options.recent ?? null),
    },
    outboxMessage: {
      findMany: vi.fn(async () =>
        (options.sentKeys ?? []).map((idempotencyKey) => ({ idempotencyKey }))
      ),
    },
  };
}

describe("routeInboundText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não aceita uma proposta que ainda está na fila", async () => {
    const prisma = fakePrisma({ open: [response("queued", null)] });
    await routeInboundText(prisma as never, input);
    expect(processOpportunityResponse).not.toHaveBeenCalled();
    expect(processContactConversationText).toHaveBeenCalled();
  });

  it("um SIM simples vale para a única proposta entregue", async () => {
    const delivered = response("delivered", new Date(Date.now() + 60_000));
    const prisma = fakePrisma({ open: [delivered, response("queued", null)] });
    const result = await routeInboundText(prisma as never, input);
    expect(result.routed).toBe("opportunity");
    expect(processOpportunityResponse).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ responseId: "delivered" })
    );
  });

  it("conta propostas antigas sem prazo individual só quando o outbox foi enviado", async () => {
    const legacy = response("legacy", null);
    const prisma = fakePrisma({
      open: [legacy],
      sentKeys: ["opportunity:opp-legacy:lead-1:offer"],
    });
    await routeInboundText(prisma as never, { ...input, text: "1" });
    expect(processOpportunityResponse).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ responseId: "legacy" })
    );
  });

  it("responde um SIM atrasado pela proposta recente em vez do menu", async () => {
    const prisma = fakePrisma({ open: [], recent: { id: "expired" } });
    await routeInboundText(prisma as never, input);
    expect(processOpportunityResponse).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ responseId: "expired" })
    );
    expect(processContactConversationText).not.toHaveBeenCalled();
  });

  it("textos que não são SIM/NÃO seguem para a conversa sem consultar propostas", async () => {
    const prisma = fakePrisma({});
    await routeInboundText(prisma as never, { ...input, text: "AJUDA" });
    expect(prisma.opportunityResponse.findMany).not.toHaveBeenCalled();
    expect(processContactConversationText).toHaveBeenCalled();
  });
});

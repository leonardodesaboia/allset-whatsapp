import { beforeEach, describe, expect, it, vi } from "vitest";
import { processContactConversationText } from "./process-contact-conversation-text.usecase";
import { startRecruitmentConversation } from "../recruitment/conversation-engine.usecase";

vi.mock("../customer/contact-intent-conversation.usecase", () => ({
  processContactIntentSelection: vi.fn(),
  startContactIntentConversation: vi.fn(),
}));

vi.mock("../customer/customer-booking-conversation.usecase", () => ({
  processCustomerBookingAnswer: vi.fn(),
  startCustomerBookingConversation: vi.fn(),
}));

vi.mock("../recruitment/conversation-engine.usecase", () => ({
  processRecruitmentAnswer: vi.fn(),
  startRecruitmentConversation: vi.fn(async () => ({ started: true })),
}));

vi.mock("../messaging/enqueue-outbound-message.usecase", () => ({
  enqueueOutboundMessage: vi.fn(),
}));

vi.mock("../recruitment/transition-lead-status.usecase", () => ({
  transitionLeadStatusInTransaction: vi.fn(),
}));

describe("processContactConversationText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consome o inbound ao iniciar recrutamento para um contato que ja escolheu profissional", async () => {
    const prisma = {
      recruitmentLead: { findUnique: vi.fn(async () => null) },
      contactIntentConversation: { findUnique: vi.fn(async () => ({ state: "PROFESSIONAL" })) },
    };

    await processContactConversationText(prisma as never, {
      inboundMessageId: "inbound-1",
      phoneE164: "+5585999999999",
      text: "quero trabalhar",
      provider: "mock",
    });

    expect(startRecruitmentConversation).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ inboundMessageId: "inbound-1" }),
    );
  });

  it("marca como processada a mensagem de lead encerrado sem conversa ativa", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      recruitmentLead: {
        findUnique: vi.fn(async () => ({
          id: "lead-1",
          status: "BASE_FUTURA",
          conversation: null,
        })),
      },
      contactIntentConversation: { findUnique: vi.fn(async () => null) },
      inboundMessage: { updateMany },
    };

    await expect(processContactConversationText(prisma as never, {
      inboundMessageId: "inbound-2",
      phoneE164: "+5585888888888",
      text: "oi",
      provider: "mock",
    })).resolves.toEqual({ routed: "recruitment", ignored: "NO_RECRUITMENT_CONVERSATION" });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "inbound-2", processedAt: null },
      data: { processedAt: expect.any(Date) },
    });
  });
});

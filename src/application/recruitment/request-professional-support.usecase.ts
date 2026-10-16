import type { PrismaClient } from "@prisma/client";
import { textPayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

/** Support is an operational task, independent of approval and eligibility. */
export async function requestProfessionalSupport(
  prisma: PrismaClient,
  input: { leadId: string; inboundMessageId: string; text: string },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RecruitmentLead" WHERE id = ${input.leadId} FOR UPDATE`;
    const lead = await tx.recruitmentLead.findUnique({ where: { id: input.leadId } });
    const inbound = await tx.inboundMessage.findUnique({ where: { id: input.inboundMessageId } });
    if (!lead?.phoneE164 || !inbound || inbound.sender !== lead.phoneE164) return false;
    const claimed = await tx.inboundMessage.updateMany({
      where: { id: inbound.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimed.count) return false;

    const now = new Date();
    const updated = await tx.recruitmentLead.updateMany({
      where: { id: lead.id, version: lead.version },
      data: {
        nextAction: "Atender pedido de ajuda da profissional",
        nextActionAt: now,
        lastInteractionAt: now,
        version: { increment: 1 },
      },
    });
    if (!updated.count) throw new Error("Profissional alterada concorrentemente");
    await tx.leadNote.create({
      data: { leadId: lead.id, type: "GERAL", content: `Pedido de atendimento: ${input.text.slice(0, 500)}`, author: "system:support" },
    });
    await tx.leadEvent.create({
      data: { leadId: lead.id, type: "SUPPORT_REQUESTED", description: "Profissional solicitou atendimento", actor: "system:support" },
    });
    await recordAuditLog(tx, {
      actor: "system:support", action: "PROFESSIONAL_SUPPORT_REQUESTED", entityType: "RecruitmentLead", entityId: lead.id,
      metadata: { inboundMessageId: inbound.id, status: lead.status },
    });
    await enqueueOutboundMessage(tx, {
      provider: inbound.provider,
      recipient: lead.phoneE164,
      payload: textPayload("Recebemos seu pedido de atendimento. Nossa equipe vai analisar sua mensagem e entrar em contato. Seu cadastro permanece na etapa atual."),
      idempotencyKey: `professional-support:${inbound.id}`,
      correlationId: lead.id,
      actor: "system:support",
    });
    return true;
  });
}

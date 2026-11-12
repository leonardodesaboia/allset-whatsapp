import type { Prisma, PrismaClient } from "@prisma/client";

type Database = PrismaClient | Prisma.TransactionClient;

/** Cada profissional tem no máximo uma proposta aberta; a próxima espera. */
const inFlightRecheckMs = 60_000;

export const offerIdempotencyKey = (opportunityId: string, leadId: string) =>
  `opportunity:${opportunityId}:${leadId}:offer`;

interface ResponseRef {
  id: string;
  opportunityId: string;
  leadId: string;
  expiresAt: Date | null;
}

/**
 * Uma resposta só vale depois que a proposta chegou à profissional. O prazo
 * individual é gravado no envio; propostas anteriores a ele contam pelo outbox.
 */
export async function deliveredResponseIds(
  db: Database,
  responses: ResponseRef[]
): Promise<Set<string>> {
  const delivered = new Set(
    responses
      .filter((response) => response.expiresAt)
      .map((response) => response.id)
  );
  const legacy = responses.filter((response) => !response.expiresAt);
  if (!legacy.length) return delivered;
  const sent = await db.outboxMessage.findMany({
    where: {
      idempotencyKey: {
        in: legacy.map((response) =>
          offerIdempotencyKey(response.opportunityId, response.leadId)
        ),
      },
      status: "SENT",
    },
    select: { idempotencyKey: true },
  });
  const sentKeys = new Set(sent.map((message) => message.idempotencyKey));
  for (const response of legacy)
    if (
      sentKeys.has(offerIdempotencyKey(response.opportunityId, response.leadId))
    )
      delivered.add(response.id);
  return delivered;
}

/** Retorna até quando a proposta deve esperar, ou null se pode sair agora. */
export async function findOfferBlockUntil(
  db: Database,
  input: {
    recipient: string;
    opportunityId: string;
    outboxId: string;
    now: Date;
  }
): Promise<Date | null> {
  const inFlight = await db.outboxMessage.findFirst({
    where: {
      recipient: input.recipient,
      status: "SENDING",
      idempotencyKey: { endsWith: ":offer" },
      id: { not: input.outboxId },
    },
    select: { id: true },
  });
  if (inFlight) return new Date(input.now.getTime() + inFlightRecheckMs);
  const open = await db.opportunityResponse.findFirst({
    where: {
      lead: { phoneE164: input.recipient },
      opportunityId: { not: input.opportunityId },
      response: null,
      expiresAt: { gt: input.now },
      opportunity: { status: "OPEN" },
    },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });
  return open?.expiresAt ?? null;
}

/** Libera propostas em espera quando a proposta aberta foi respondida ou encerrada. */
export async function releaseHeldOffers(
  db: Database,
  recipients: Array<string | null>,
  now: Date
): Promise<void> {
  const phones = [
    ...new Set(recipients.filter((phone): phone is string => Boolean(phone))),
  ];
  if (!phones.length) return;
  await db.outboxMessage.updateMany({
    where: {
      recipient: { in: phones },
      status: "PENDING",
      idempotencyKey: { endsWith: ":offer" },
      availableAt: { gt: now },
    },
    data: { availableAt: now },
  });
}

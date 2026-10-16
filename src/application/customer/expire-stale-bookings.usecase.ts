import type { PrismaClient } from "@prisma/client";

/**
 * Antes cobrava pagamento: lembrava em 12h e cancelava em 24h. A AllSet não
 * cobra mais pelo serviço, então este job nunca lembra nem cancela por falta de
 * pagamento. Mantido (com o mesmo formato de retorno) porque o cron e o
 * agendador interno ainda o chamam; pedidos que ficaram em AWAITING_PAYMENT
 * seguem para as profissionais assim que o cliente responde (ou pelo admin).
 */
export async function expireStaleBookings(_prisma: PrismaClient): Promise<{
  reminders: number;
  cancelled: number;
  skipped: number;
  errors: Array<{ bookingId: string; error: unknown }>;
}> {
  return { reminders: 0, cancelled: 0, skipped: 0, errors: [] };
}

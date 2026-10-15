const TIME_ZONE = "America/Fortaleza";

/** "sexta-feira, 18 de outubro às 14:00" — always in Fortaleza time. */
export function formatScheduleForCustomer(scheduledAt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(scheduledAt);
}

export function estimatedValueText(totalCents: number): string {
  return `💰 Valor estimado: R$ ${(totalCents / 100).toFixed(2).replace(".", ",")} (sem cobrança pela AllSet — o valor final você combina direto com a profissional)`;
}

type BookingSummaryInput = {
  scheduledAt: Date | null;
  addressLine1: string | null;
  totalCents: number;
  durationMinutes: number | null;
};

/** Uses the agreed booking values rather than the current pricing catalog. */
export function customerBookingDetails(booking: BookingSummaryInput): string[] {
  const lines: string[] = [];
  if (booking.scheduledAt) lines.push(`🗓️ ${formatScheduleForCustomer(booking.scheduledAt)}`);
  if (booking.addressLine1) lines.push(`📍 ${booking.addressLine1}`);
  if (booking.totalCents > 0) lines.push(estimatedValueText(booking.totalCents));
  if (booking.durationMinutes) lines.push(`Duração prevista: ${booking.durationMinutes} minutos`);
  return lines;
}

/** Confirmation request (used by conversations that were already waiting on it). */
export function customerBookingSummary(booking: BookingSummaryInput): string {
  return [
    "Confira os dados do agendamento:",
    "",
    ...customerBookingDetails(booking),
    "",
    "Podemos enviar seu pedido para as profissionais?",
    "",
    "1 — Confirmar e enviar",
    "2 — Alterar informações",
  ].join("\n");
}

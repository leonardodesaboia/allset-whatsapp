/** Uses the agreed booking values rather than the current pricing catalog. */
export function customerBookingSummary(booking: {
  scheduledAt: Date | null;
  addressLine1: string | null;
  totalCents: number;
  durationMinutes: number | null;
}): string {
  const lines = ["Confira os dados do agendamento:", ""];
  if (booking.scheduledAt) {
    lines.push(new Intl.DateTimeFormat("pt-BR", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      timeZone: "America/Fortaleza",
    }).format(booking.scheduledAt));
  }
  if (booking.addressLine1) lines.push(`📍 ${booking.addressLine1}`);
  lines.push(`💰 R$ ${(booking.totalCents / 100).toFixed(2).replace(".", ",")}`);
  if (booking.durationMinutes) lines.push(`Duração prevista: ${booking.durationMinutes} minutos`);
  lines.push("", "Podemos seguir para o pagamento?", "", "1 — Confirmar e pagar", "2 — Alterar informações");
  return lines.join("\n");
}

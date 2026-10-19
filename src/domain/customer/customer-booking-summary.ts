import { whatsappLink } from "../marketplace/contact-exchange-message";

const TIME_ZONE = "America/Fortaleza";

/** "sexta-feira, 18 de outubro às 14:00" — always in Fortaleza time. */
export function formatScheduleForCustomer(scheduledAt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(scheduledAt);
}

function estimatedValueText(totalCents: number): string {
  return `💰 Valor estimado: R$ ${(totalCents / 100).toFixed(2).replace(".", ",")} (sem cobrança pela AllSet — o valor final você combina direto com a profissional)`;
}

type BookingSummaryInput = {
  scheduledAt: Date | null;
  addressLine1: string | null;
  totalCents: number;
  durationMinutes: number | null;
  customerNotes?: string | null;
  neighborhood?: string | null;
};

/** Uses the agreed booking values rather than the current pricing catalog. */
export function customerBookingDetails(booking: BookingSummaryInput): string[] {
  const lines: string[] = [];
  if (booking.scheduledAt)
    lines.push(`🗓️ ${formatScheduleForCustomer(booking.scheduledAt)}`);
  if (booking.addressLine1) {
    const neighborhood = booking.neighborhood?.trim();
    const showNeighborhood =
      neighborhood &&
      !booking.addressLine1.toLowerCase().includes(neighborhood.toLowerCase());
    lines.push(
      `📍 ${booking.addressLine1}${showNeighborhood ? ` — ${neighborhood}` : ""}`
    );
  }
  if (booking.totalCents > 0)
    lines.push(estimatedValueText(booking.totalCents));
  if (booking.durationMinutes)
    lines.push(`Duração prevista: ${booking.durationMinutes} minutos`);
  if (booking.customerNotes) lines.push(`📝 ${booking.customerNotes}`);
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

/** Reply to a customer who writes again after the request was sent. */
export function customerBookingInProgressText(input: {
  scheduledAt: Date;
  /** false when no professional has received the offer yet (none eligible, or it expired). */
  offered: boolean;
  professionalName: string | null;
  professionalPhoneE164: string | null;
}): string {
  const when = formatScheduleForCustomer(input.scheduledAt);
  const status = input.professionalPhoneE164
    ? [
        `Seu pedido para ${when} foi aceito por ${input.professionalName ?? "uma profissional"}.`,
        "",
        `📱 WhatsApp: ${input.professionalPhoneE164}`,
        `💬 Conversar agora: ${whatsappLink(input.professionalPhoneE164)}`,
        "",
        "Fale direto com ela para combinar os detalhes e o valor.",
      ]
    : input.offered
      ? [
          `Seu pedido para ${when} já está com as profissionais.`,
          "Assim que uma delas aceitar, enviamos o nome e o WhatsApp dela por aqui.",
        ]
      : [
          `Ainda estamos buscando uma profissional disponível para ${when}.`,
          "Avisaremos por aqui assim que uma delas aceitar.",
        ];
  return [...status, "", "Para fazer um novo pedido, responda NOVO."].join(
    "\n"
  );
}

const TZ = "America/Fortaleza";

export interface OpportunityMessageInput {
  neighborhood: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  paymentCents: number | null;
  /** Free-text description the customer gave (property, type of cleaning...). */
  serviceDetails?: string | null;
  expiresAt: Date;
  /** Momento do envio; o prazo mostra a data só quando cai em outro dia. */
  sentAt: Date;
}

const dayKey = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: TZ }).format(date);

/** Cada profissional tem uma proposta aberta por vez, então basta SIM ou NÃO. */
export function formatOpportunityMessage(
  input: OpportunityMessageInput
): string {
  const dateStr = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  }).format(input.scheduledAt);

  const timeStr = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(input.scheduledAt);

  const expiresTime = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(input.expiresAt);
  const expiresStr =
    dayKey(input.expiresAt) === dayKey(input.sentAt)
      ? expiresTime
      : `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ }).format(input.expiresAt)} às ${expiresTime}`;

  const hours = input.durationMinutes
    ? Math.max(1, Math.round(input.durationMinutes / 60))
    : null;
  const payment =
    input.paymentCents && input.paymentCents > 0
      ? (input.paymentCents / 100).toFixed(2).replace(".", ",")
      : null;

  return [
    "Nova proposta de serviço",
    "",
    `📍 Bairro: ${input.neighborhood}`,
    `📅 ${dateStr.charAt(0).toUpperCase()}${dateStr.slice(1)}, ${timeStr}`,
    hours ? `⏱️ Cerca de ${hours}h` : null,
    input.serviceDetails ? `📝 Detalhes: ${input.serviceDetails}` : null,
    payment
      ? `💰 Valor estimado: R$ ${payment} (o valor final você combina direto com o cliente)`
      : "💰 Valor e detalhes: combine direto com o cliente depois de aceitar.",
    "",
    "Responda:",
    "1 — SIM, aceito",
    "2 — NÃO posso",
    "",
    "Quem aceitar primeiro fica com o serviço.",
    `Você tem até ${expiresStr} para responder.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

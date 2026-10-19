const TZ = "America/Fortaleza";

export interface OpportunityMessageInput {
  neighborhood: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  paymentCents: number | null;
  /** Free-text description the customer gave (property, type of cleaning...). */
  serviceDetails?: string | null;
  expiresAt: Date;
  responseToken: string;
}

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

  const expiresStr = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(input.expiresAt);

  const hours = input.durationMinutes
    ? Math.round(input.durationMinutes / 60)
    : null;
  const payment =
    input.paymentCents && input.paymentCents > 0
      ? (input.paymentCents / 100).toFixed(2).replace(".", ",")
      : null;

  return [
    "Ola! Temos uma oportunidade de servico para voce.",
    "",
    `Bairro: ${input.neighborhood}`,
    `Data: ${dateStr}`,
    `Horario: ${timeStr}`,
    input.serviceDetails ? `Detalhes: ${input.serviceDetails}` : null,
    hours ? `Duracao estimada: ${hours}h` : null,
    payment
      ? `Valor estimado: R$ ${payment} (o valor final você combina direto com o cliente)`
      : "Valor e detalhes: combine direto com o cliente depois de aceitar.",
    "",
    `Responda *SIM ${input.responseToken}* para aceitar ou *NAO ${input.responseToken}* para recusar.`,
    "Quem aceitar primeiro fica com o serviço.",
    `Voce tem ate ${expiresStr} para responder.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

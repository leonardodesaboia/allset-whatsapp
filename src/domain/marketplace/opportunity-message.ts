const TZ = "America/Fortaleza";

export interface OpportunityMessageInput {
  neighborhood: string;
  scheduledAt: Date;
  durationMinutes: number;
  paymentCents: number;
  expiresAt: Date;
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

  const hours = Math.round(input.durationMinutes / 60);
  const payment = (input.paymentCents / 100).toFixed(2).replace(".", ",");

  return [
    "Ola! Temos uma oportunidade de servico para voce.",
    "",
    `Bairro: ${input.neighborhood}`,
    `Data: ${dateStr}`,
    `Horario: ${timeStr}`,
    `Duracao estimada: ${hours}h`,
    `Pagamento: R$ ${payment}`,
    "",
    "Responda *SIM* para aceitar ou *NAO* para recusar.",
    `Voce tem ate ${expiresStr} para responder.`,
  ].join("\n");
}

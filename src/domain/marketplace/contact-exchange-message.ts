const TZ = "America/Fortaleza";

function schedule(scheduledAt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(scheduledAt);
}

function reais(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/** Digits-only WhatsApp link so each side can open the chat with one tap. */
export function whatsappLink(phoneE164: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}`;
}

export interface ProfessionalContactInput {
  professionalName: string | null;
  professionalPhoneE164: string;
  scheduledAt: Date;
}

/** Sent to the customer when a professional accepts: who to talk to, no promises about follow-up. */
export function formatCustomerContactMessage(input: ProfessionalContactInput): string {
  return [
    `Boa notícia! ${input.professionalName ?? "Uma profissional"} aceitou o seu pedido para ${schedule(input.scheduledAt)}.`,
    "",
    `👤 Profissional: ${input.professionalName ?? "—"}`,
    `📱 WhatsApp: ${input.professionalPhoneE164}`,
    `💬 Conversar agora: ${whatsappLink(input.professionalPhoneE164)}`,
    "",
    "Fale direto com ela para combinar os detalhes e o valor do serviço.",
    "A AllSet apenas conecta vocês; o combinado é feito direto entre as partes.",
  ].join("\n");
}

export interface CustomerContactInput {
  customerName: string | null;
  customerPhoneE164: string;
  scheduledAt: Date;
  address: string | null;
  addressLine2?: string | null;
  addressReference?: string | null;
  propertyLabel: string | null;
  estimatedValueCents: number | null;
  serviceDetails?: string | null;
}

/** Sent to the professional on acceptance: everything needed to combine directly with the customer. */
export function formatProfessionalContactMessage(input: CustomerContactInput): string {
  return [
    "Confirmado! Estes são os dados do cliente para vocês combinarem direto:",
    "",
    `👤 Cliente: ${input.customerName ?? "—"}`,
    `📱 WhatsApp: ${input.customerPhoneE164}`,
    `💬 Conversar agora: ${whatsappLink(input.customerPhoneE164)}`,
    input.address ? `📍 Endereço: ${input.address}` : null,
    input.addressLine2 ?? null,
    input.addressReference ? `Referência: ${input.addressReference}` : null,
    `🗓️ Dia e horário: ${schedule(input.scheduledAt)}`,
    input.propertyLabel ? `🏠 Imóvel: ${input.propertyLabel}` : null,
    input.serviceDetails ? `📝 Detalhes: ${input.serviceDetails}` : null,
    input.estimatedValueCents != null && input.estimatedValueCents > 0
      ? `💰 Valor estimado: ${reais(input.estimatedValueCents)} (combine o valor final direto com o cliente)`
      : null,
    "",
    "A AllSet apenas conecta vocês; o combinado é feito direto entre as partes.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

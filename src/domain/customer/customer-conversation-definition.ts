export type CustomerConversationState =
  | "INTRODUCTION"
  | "NAME"
  // Etapa da descrição livre do serviço (imóvel, tipo de limpeza, detalhes).
  // O nome do estado vem do fluxo antigo de faixas de imóvel.
  | "PROPERTY_CHARACTERISTICS"
  | "SCHEDULE_DATE"
  | "SCHEDULE_TIME"
  | "QUOTE"
  | "QUOTE_ACCEPTANCE"
  | "ADDRESS"
  | "NEIGHBORHOOD"
  | "FINAL_CONFIRMATION"
  | "EDIT_SELECTION"
  | "AWAITING_PAYMENT"
  | "MANUAL_REVIEW"
  | "PAUSED"
  | "COMPLETED";

type CustomerChoice = { value: string; label: string };
export type CustomerQuestion = { key: CustomerConversationState; text: string; choices?: readonly CustomerChoice[] };

export const SERVICE_DETAILS_PROMPT = [
  "Por último, conte em uma mensagem o que a profissional precisa saber.",
  "",
  "Ex.: apartamento de 2 quartos e 1 banheiro, limpeza completa, tenho os produtos.",
].join("\n");

export const CUSTOMER_QUESTIONS: Partial<Record<CustomerConversationState, CustomerQuestion>> = {
  INTRODUCTION: { key: "INTRODUCTION", text: "Olá! Você quer contratar uma limpeza residencial?", choices: [{ value: "YES", label: "Quero contratar" }, { value: "NO", label: "Agora não" }] },
  NAME: { key: "NAME", text: "Ótimo! Vou pegar alguns dados rápidos para enviar seu pedido às profissionais. Qual é o seu nome?" },
  SCHEDULE_TIME: { key: "SCHEDULE_TIME", text: "Qual horário você prefere? Ex.: 9h ou 14h30." },
  NEIGHBORHOOD: { key: "NEIGHBORHOOD", text: "Qual é o bairro do atendimento?" },
  PROPERTY_CHARACTERISTICS: { key: "PROPERTY_CHARACTERISTICS", text: SERVICE_DETAILS_PROMPT },
  FINAL_CONFIRMATION: { key: "FINAL_CONFIRMATION", text: "Confira os dados. Podemos enviar seu pedido para as profissionais?", choices: [{ value: "CONFIRM", label: "Confirmar e enviar" }, { value: "CHANGE", label: "Alterar informações" }] },
  EDIT_SELECTION: { key: "EDIT_SELECTION", text: "O que você quer alterar?", choices: [{ value: "SCHEDULE", label: "Dia ou horário" }, { value: "ADDRESS", label: "Endereço" }, { value: "DETAILS", label: "Detalhes do serviço" }] },
};

export function parseCustomerChoice(state: CustomerConversationState, text: string): string | undefined {
  const choices = CUSTOMER_QUESTIONS[state]?.choices;
  if (!choices) return text.trim() || undefined;
  const normalized = text.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  if (/^\d+$/.test(normalized)) return choices[Number(normalized) - 1]?.value;
  const direct = choices.find((choice) => choice.value === normalized || choice.label.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase() === normalized);
  if (direct) return direct.value;
  if (["SIM", "S", "QUERO", "CONFIRMAR"].includes(normalized)) return choices[0]?.value;
  if (["NAO", "N", "ALTERAR", "MUDAR"].includes(normalized)) return choices[1]?.value;
  return undefined;
}

import { CUSTOMER_SCHEDULE_TIME_CHOICES } from "./customer-schedule";

export type CustomerConversationState =
  | "INTRODUCTION"
  | "NAME"
  | "PROPERTY_CHARACTERISTICS"
  | "SCHEDULE_DATE"
  | "SCHEDULE_TIME"
  | "QUOTE"
  | "QUOTE_ACCEPTANCE"
  | "ADDRESS"
  | "FINAL_CONFIRMATION"
  | "AWAITING_PAYMENT"
  | "MANUAL_REVIEW"
  | "PAUSED"
  | "COMPLETED";

type CustomerChoice = { value: string; label: string };
export type CustomerQuestion = { key: CustomerConversationState; text: string; choices?: readonly CustomerChoice[] };

export const CUSTOMER_QUESTIONS: Partial<Record<CustomerConversationState, CustomerQuestion>> = {
  INTRODUCTION: { key: "INTRODUCTION", text: "Olá! Você quer contratar uma limpeza residencial?", choices: [{ value: "YES", label: "Quero contratar" }, { value: "NO", label: "Agora não" }] },
  NAME: { key: "NAME", text: "Qual é o seu nome?" },
  SCHEDULE_DATE: { key: "SCHEDULE_DATE", text: "Qual dia você prefere?" },
  SCHEDULE_TIME: { key: "SCHEDULE_TIME", text: "Qual horário você prefere?", choices: CUSTOMER_SCHEDULE_TIME_CHOICES },
  QUOTE_ACCEPTANCE: { key: "QUOTE_ACCEPTANCE", text: "Quer seguir com este valor?", choices: [{ value: "ACCEPT", label: "Confirmar e continuar" }, { value: "CHANGE", label: "Alterar informações" }] },
  FINAL_CONFIRMATION: { key: "FINAL_CONFIRMATION", text: "Confira os dados. Podemos seguir para o pagamento?", choices: [{ value: "PAY", label: "Confirmar e pagar" }, { value: "CHANGE", label: "Alterar informações" }] },
};

export function parseCustomerChoice(state: CustomerConversationState, text: string): string | undefined {
  const choices = CUSTOMER_QUESTIONS[state]?.choices;
  if (!choices) return text.trim() || undefined;
  const normalized = text.trim().toUpperCase();
  if (/^\d+$/.test(normalized)) return choices[Number(normalized) - 1]?.value;
  return choices.find((choice) => choice.value === normalized)?.value;
}

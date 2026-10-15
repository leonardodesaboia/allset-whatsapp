import type { CustomerConversationState } from "./customer-conversation-definition";

// QUOTE is transient; PAUSED, MANUAL_REVIEW and COMPLETED have no customer question.
export const CUSTOMER_ADMIN_STEPS = [
  "INTRODUCTION",
  "NAME",
  "PROPERTY_CHARACTERISTICS",
  "SCHEDULE_DATE",
  "SCHEDULE_TIME",
  "QUOTE_ACCEPTANCE",
  "ADDRESS",
  "FINAL_CONFIRMATION",
  "EDIT_SELECTION",
  "AWAITING_PAYMENT",
] as const satisfies readonly CustomerConversationState[];

export type CustomerAdminStep = (typeof CUSTOMER_ADMIN_STEPS)[number];

export function isCustomerAdminStep(
  value: string | null
): value is CustomerAdminStep {
  return CUSTOMER_ADMIN_STEPS.some((step) => step === value);
}

export function customerResumeStep(input: {
  state: string;
  lastQuestionKey: string | null;
  hasBooking: boolean;
}): CustomerAdminStep | null {
  if (!["PAUSED", "MANUAL_REVIEW"].includes(input.state)) return null;
  if (isCustomerAdminStep(input.lastQuestionKey)) return input.lastQuestionKey;
  // Review overwrites lastQuestionKey. Recollect the address without approving coverage.
  return input.hasBooking ? "ADDRESS" : "PROPERTY_CHARACTERISTICS";
}

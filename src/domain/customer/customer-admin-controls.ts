import type { CustomerConversationState } from "./customer-conversation-definition";

// QUOTE is transient; PAUSED, MANUAL_REVIEW, COMPLETED and the legacy
// AWAITING_PAYMENT have no customer question (there is no platform payment).
export const CUSTOMER_ADMIN_STEPS = [
  "INTRODUCTION",
  "NAME",
  "PROPERTY_CHARACTERISTICS",
  "SCHEDULE_DATE",
  "SCHEDULE_TIME",
  "ADDRESS",
  "NEIGHBORHOOD",
  "FINAL_CONFIRMATION",
  "EDIT_SELECTION",
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
  return input.hasBooking ? "ADDRESS" : "NAME";
}

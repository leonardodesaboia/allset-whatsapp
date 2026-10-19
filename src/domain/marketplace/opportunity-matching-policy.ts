const ELIGIBLE_STATUSES = new Set(["ATIVA", "PREFERENCIAL"]);

/** Only active professionals may receive or accept opportunities. */
export function isLeadStatusEligible(status: string): boolean {
  return ELIGIBLE_STATUSES.has(status);
}

export interface LeadInfo {
  status: string;
  phoneE164: string | null;
  proposalsAcceptedAt: Date | null;
}

/**
 * Every active professional who accepted proposals receives every offer; each
 * one decides whether area, day and time work for her. No daily limit.
 */
export function isEligibleForOpportunity(lead: LeadInfo): boolean {
  return (
    isLeadStatusEligible(lead.status) &&
    Boolean(lead.phoneE164 && lead.proposalsAcceptedAt)
  );
}

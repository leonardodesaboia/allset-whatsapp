export interface ReengagementCandidate {
  state: string;
  lastInboundAt: Date | null;
  lastReengagementAt: Date | null;
  reengagementCount: number;
}

const activeStates = new Set([
  "CHANNEL_PREFERENCE",
  "NAME",
  "NEIGHBORHOOD",
  "PROFESSIONAL_EXPERIENCE",
  "EXPERIENCE_DURATION",
  "INFORMAL_EXPERIENCE",
  "SERVICE_AREA",
  "AVAILABILITY",
]);

/** Evita cobranças de conversas pausadas, concluídas e em revisão humana. */
export function isEligibleForReengagement(
  candidate: ReengagementCandidate,
  now: Date,
  afterHours: number,
  maximumAttempts: number,
): boolean {
  if (!activeStates.has(candidate.state) || !candidate.lastInboundAt || candidate.reengagementCount >= maximumAttempts) return false;
  const dueAt = candidate.lastInboundAt.getTime() + afterHours * 60 * 60 * 1000;
  const cooldownDueAt = candidate.lastReengagementAt
    ? candidate.lastReengagementAt.getTime() + afterHours * 60 * 60 * 1000
    : Number.NEGATIVE_INFINITY;
  return now.getTime() >= dueAt && now.getTime() >= cooldownDueAt;
}

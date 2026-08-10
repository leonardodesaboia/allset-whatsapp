export type ParsedOpportunityReply = {
  response: "ACCEPTED" | "DECLINED";
  responseToken: string | null;
};

/** Parses SIM/NAO replies and the optional correlation code printed in the offer. */
export function parseOpportunityReply(text: string): ParsedOpportunityReply | null {
  const normalized = text
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const match = normalized.match(/^(SIM|S|NAO|N)(?:\s+([A-Z0-9]{10}))?$/);
  if (!match) return null;

  return {
    response: match[1] === "SIM" || match[1] === "S" ? "ACCEPTED" : "DECLINED",
    responseToken: match[2] ?? null,
  };
}

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
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const token = normalized.match(/(?:^|\s)([A-Z0-9]{10})$/)?.[1] ?? null;
  const answer = token ? normalized.slice(0, -token.length).trim() : normalized;
  const padded = ` ${answer} `;
  const has = (choices: readonly string[]) => choices.some((choice) => padded.includes(` ${choice} `));
  // Respostas de oportunidade precisam tolerar frases curtas e pequenos erros,
  // mas nunca devem converter dúvida em recusa. "não sei" e "talvez" seguem
  // para esclarecimento.
  if (has(["NAO SEI", "TALVEZ", "DEPENDE", "QUEM SABE"])) return null;
  const declined = answer === "2" || has(["NAO", "N", "NAO CONSIGO", "NAO POSSO", "NAO QUERO", "NAO DA", "N CONSIGO", "N POSSO", "N QUERO", "N DA", "RECUSO", "RECUSAR", "NAUM", "NAUMM", "NUM"]);
  const accepted = answer === "1" || (!declined && has(["SIM", "SIMM", "SIIM", "SS", "ACEITO", "ACEITAR", "QUERO", "POSSO", "CONSIGO", "CONFIRMO", "CONFIRMAR"]));
  if (!accepted && !declined) return null;

  return {
    response: accepted ? "ACCEPTED" : "DECLINED",
    responseToken: token,
  };
}

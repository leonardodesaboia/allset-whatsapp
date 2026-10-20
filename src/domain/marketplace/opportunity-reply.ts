import { isUncertainReply, normalizeConversationText, parseBinaryReply } from "../shared/conversation-language";

export type ParsedOpportunityReply = {
  response: "ACCEPTED" | "DECLINED";
  responseToken: string | null;
};

/** Parses SIM/NAO replies and the optional correlation code printed in the offer. */
export function parseOpportunityReply(text: string): ParsedOpportunityReply | null {
  if (isUncertainReply(text)) return null;
  // Hexadecimal codes match the tokens generated for offers. Do not mistake a
  // ten-letter word in a natural sentence for a correlation code.
  const message = normalizeConversationText(text);
  const token = message.match(/(?:^|\s)([A-F0-9]{10})$/)?.[1] ?? null;
  const answer = token ? message.slice(0, -token.length).trim() : text;
  const normalized = normalizeConversationText(answer);
  const reply = normalized === "1" ? "YES" : normalized === "2" ? "NO" : parseBinaryReply(answer, "OPPORTUNITY");
  if (!reply) return null;

  return {
    response: reply === "YES" ? "ACCEPTED" : "DECLINED",
    responseToken: token,
  };
}

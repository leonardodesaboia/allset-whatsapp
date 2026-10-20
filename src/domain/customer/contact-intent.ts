import { containsPhrase, isUncertainReply, normalizeConversationText } from "../shared/conversation-language";

export type ContactIntent = "CUSTOMER" | "PROFESSIONAL";

export const contactIntentPrompt = [
  "Olá! Como a AllSet pode ajudar?",
  "",
  "1 — Quero contratar uma limpeza",
  "2 — Quero trabalhar como profissional",
].join("\n");

export function parseContactIntent(value: string): ContactIntent | undefined {
  const normalized = normalizeConversationText(value);
  if (isUncertainReply(value)) return undefined;
  if (["1", "CLIENTE", "CONTRATAR", "CONTRATAR LIMPEZA"].includes(normalized)) return "CUSTOMER";
  if (["2", "PROFISSIONAL", "TRABALHAR", "TRABALHAR COMO PROFISSIONAL"].includes(normalized)) return "PROFESSIONAL";
  if (containsPhrase(normalized, ["NAO", "N", "NAUM"]) || (containsPhrase(normalized, ["CONTRATAR"]) && containsPhrase(normalized, ["TRABALHAR"]))) return undefined;
  const customer = containsPhrase(normalized, ["QUERO CONTRATAR", "GOSTARIA DE CONTRATAR", "PRECISO DE LIMPEZA", "PRECISO DE UMA LIMPEZA", "PRECISO DE FAXINA", "PRECISO DE UMA FAXINA", "PRECISO DE UMA DIARISTA", "QUERO UMA DIARISTA", "QUERO UMA FAXINA", "CONTRATAR UMA LIMPEZA", "SOU CLIENTE"]);
  const professional = containsPhrase(normalized, ["QUERO TRABALHAR", "GOSTARIA DE TRABALHAR", "QUERO ME CADASTRAR PARA TRABALHAR", "SOU DIARISTA", "SOU FAXINEIRA", "SOU PROFISSIONAL", "PROCURO TRABALHO", "PROCURANDO TRABALHO", "BUSCO TRABALHO", "QUERO RECEBER PROPOSTAS"]);
  if (customer !== professional) return customer ? "CUSTOMER" : "PROFESSIONAL";
  return undefined;
}

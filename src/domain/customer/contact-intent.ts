export type ContactIntent = "CUSTOMER" | "PROFESSIONAL";

export const contactIntentPrompt = [
  "Olá! Como a AllSet pode ajudar?",
  "",
  "1 — Quero contratar uma limpeza",
  "2 — Quero trabalhar como profissional",
].join("\n");

export function parseContactIntent(value: string): ContactIntent | undefined {
  const normalized = value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  if (["1", "CLIENTE", "CONTRATAR", "CONTRATAR LIMPEZA"].includes(normalized)) return "CUSTOMER";
  if (["2", "PROFISSIONAL", "TRABALHAR", "TRABALHAR COMO PROFISSIONAL"].includes(normalized)) return "PROFESSIONAL";
  return undefined;
}

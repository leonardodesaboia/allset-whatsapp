export type ConversationState = "INTRODUCTION" | "CHANNEL_PREFERENCE" | "NAME" | "NEIGHBORHOOD" | "PROFESSIONAL_EXPERIENCE" | "EXPERIENCE_DURATION" | "INFORMAL_EXPERIENCE" | "SERVICE_AREA" | "AVAILABILITY" | "MANUAL_REVIEW" | "PAUSED" | "COMPLETED";
export interface QuestionDefinition { key: ConversationState; text: string; options?: readonly string[]; audioAssetId?: string; }
export const QUESTIONS: Partial<Record<ConversationState, QuestionDefinition>> = {
  INTRODUCTION: { key: "INTRODUCTION", text: "Olá! 👋\n\nA AllSet ajuda profissionais de limpeza a encontrar novos clientes.\n\nQuando surgir uma oportunidade, você recebe pelo WhatsApp:\n📍 onde será\n📅 o dia\n🕘 o horário\n💰 quanto você vai receber\n\nVocê escolhe se quer aceitar.\n\nVocê não paga para receber oportunidades." },
  CHANNEL_PREFERENCE: { key: "CHANNEL_PREFERENCE", text: "Como você prefere continuar?\n1 — Continuar pelo WhatsApp\n2 — Quero receber uma ligação", options: ["WHATSAPP", "PHONE"] },
  NAME: { key: "NAME", text: "Como você se chama? Pode escrever ou mandar um áudio." },
  NEIGHBORHOOD: { key: "NEIGHBORHOOD", text: "Em qual bairro você mora? Pode escrever ou mandar áudio." },
  PROFESSIONAL_EXPERIENCE: { key: "PROFESSIONAL_EXPERIENCE", text: "Você já trabalhou fazendo limpeza para outras pessoas?\n1 — Sim\n2 — Não", options: ["SIM", "NAO"] },
  EXPERIENCE_DURATION: { key: "EXPERIENCE_DURATION", text: "Há mais ou menos quanto tempo?\n1 — Menos de 1 ano\n2 — De 1 a 3 anos\n3 — Mais de 3 anos\n4 — Prefiro responder por áudio", options: ["LT_1Y", "Y1_3", "GT_3Y", "BY_AUDIO"] },
  INFORMAL_EXPERIENCE: { key: "INFORMAL_EXPERIENCE", text: "Você já fez limpeza para outras pessoas, mesmo sem trabalhar como diarista?\n1 — Sim\n2 — Não", options: ["SIM", "NAO"] },
  SERVICE_AREA: { key: "SERVICE_AREA", text: "Você consegue trabalhar no Meireles ou na Aldeota?\n1 — Sim\n2 — Talvez\n3 — Não", options: ["SIM", "TALVEZ", "NAO"] },
  AVAILABILITY: { key: "AVAILABILITY", text: "Quais dias você costuma ter disponíveis? Escreva os dias ou mande áudio." },
};
export function normalizeAnswer(value: string): string { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase(); }
export function parseAnswer(state: ConversationState, value: string): string | undefined {
  const normalized = normalizeAnswer(value);
  const numeric = { CHANNEL_PREFERENCE: ["WHATSAPP", "PHONE"], PROFESSIONAL_EXPERIENCE: ["SIM", "NAO"], EXPERIENCE_DURATION: ["LT_1Y", "Y1_3", "GT_3Y", "BY_AUDIO"], INFORMAL_EXPERIENCE: ["SIM", "NAO"], SERVICE_AREA: ["SIM", "TALVEZ", "NAO"] } as const;
  const options = numeric[state as keyof typeof numeric];
  if (options && /^[1-4]$/.test(normalized)) return options[Number(normalized) - 1];
  if (state === "CHANNEL_PREFERENCE" && ["WHATSAPP", "PHONE"].includes(normalized)) return normalized;
  if (["PROFESSIONAL_EXPERIENCE", "INFORMAL_EXPERIENCE"].includes(state) && ["SIM", "NAO"].includes(normalized)) return normalized;
  if (state === "EXPERIENCE_DURATION" && ["LT_1Y", "Y1_3", "GT_3Y", "BY_AUDIO"].includes(normalized)) return normalized;
  if (state === "SERVICE_AREA" && ["SIM", "TALVEZ", "NAO"].includes(normalized)) return normalized;
  return options ? undefined : normalized;
}
export function globalCommand(value: string): "HELP" | "PHONE" | "STOP" | "MENU" | "MISUNDERSTOOD" | undefined { const text = normalizeAnswer(value); if (["AJUDA", "HELP"].includes(text)) return "HELP"; if (["LIGACAO", "PHONE", "LIGAR"].includes(text)) return "PHONE"; if (["PARAR", "STOP"].includes(text)) return "STOP"; if (text === "MENU") return "MENU"; if (["NAO ENTENDI", "NÃO ENTENDI"].includes(text)) return "MISUNDERSTOOD"; return undefined; }

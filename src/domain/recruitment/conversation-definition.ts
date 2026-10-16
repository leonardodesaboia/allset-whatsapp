export type ConversationState =
  | "REGIONS"
  | "EXPERIENCE_KIND"
  | "CONFIRMATION"
  | "EDIT_SELECTION"
  | "INTRODUCTION"
  | "CHANNEL_PREFERENCE"
  | "NAME"
  | "NEIGHBORHOOD"
  | "PROFESSIONAL_EXPERIENCE"
  | "EXPERIENCE_DURATION"
  | "INFORMAL_EXPERIENCE"
  | "SERVICE_AREA"
  | "AVAILABILITY"
  | "MANUAL_REVIEW"
  | "PAUSED"
  | "COMPLETED";
export interface QuestionDefinition {
  key: ConversationState;
  text: string;
  options?: readonly string[];
  audioAssetId?: string;
}
export const QUESTIONS: Partial<Record<ConversationState, QuestionDefinition>> =
  {
    INTRODUCTION: {
      key: "INTRODUCTION",
      text: "Olá! 👋 A AllSet apresenta oportunidades de limpeza pelo WhatsApp. Você escolhe se quer aceitar e combina diretamente com o cliente. Não cobramos para receber oportunidades. São só 4 perguntas, cerca de 2 minutos.",
    },
    REGIONS: {
      key: "REGIONS",
      text: "Em quais bairros ou regiões você pode trabalhar? Exemplo: Centro e bairros próximos. Pode escrever ou mandar áudio.",
    },
    EXPERIENCE_KIND: {
      key: "EXPERIENCE_KIND",
      text: "Você já trabalhou com limpeza?\n1 — Sim, com carteira ou em empresa\n2 — Sim, como diarista\n3 — Ainda não\nPode responder com o número, texto ou áudio.",
      options: ["FORMAL", "DIARISTA", "NONE"],
    },
    CONFIRMATION: {
      key: "CONFIRMATION",
      text: "Está tudo certo?\n1 — Confirmar\n2 — Corrigir",
      options: ["CONFIRM", "EDIT"],
    },
    EDIT_SELECTION: {
      key: "EDIT_SELECTION",
      text: "O que quer corrigir?\n1 — Nome\n2 — Bairros ou regiões\n3 — Experiência\n4 — Disponibilidade",
      options: ["NAME", "REGIONS", "EXPERIENCE_KIND", "AVAILABILITY"],
    },
    CHANNEL_PREFERENCE: {
      key: "CHANNEL_PREFERENCE",
      text: "Como você prefere continuar?\n1 — Continuar pelo WhatsApp\n2 — Quero receber uma ligação",
      options: ["WHATSAPP", "PHONE"],
    },
    NAME: {
      key: "NAME",
      text: "Para começar, como você se chama? Exemplo: Maria Silva. Pode escrever ou mandar um áudio. Se precisar, escreva AJUDA a qualquer momento.",
    },
    NEIGHBORHOOD: {
      key: "NEIGHBORHOOD",
      text: "Em qual bairro você mora? Pode escrever ou mandar áudio.",
    },
    PROFESSIONAL_EXPERIENCE: {
      key: "PROFESSIONAL_EXPERIENCE",
      text: "Você já trabalhou fazendo limpeza para outras pessoas?\n1 — Sim\n2 — Não",
      options: ["SIM", "NAO"],
    },
    EXPERIENCE_DURATION: {
      key: "EXPERIENCE_DURATION",
      text: "Há mais ou menos quanto tempo?\n1 — Menos de 1 ano\n2 — De 1 a 3 anos\n3 — Mais de 3 anos\n4 — Prefiro responder por áudio",
      options: ["LT_1Y", "Y1_3", "GT_3Y", "BY_AUDIO"],
    },
    INFORMAL_EXPERIENCE: {
      key: "INFORMAL_EXPERIENCE",
      text: "Você já fez limpeza para outras pessoas, mesmo sem trabalhar como diarista?\n1 — Sim\n2 — Não",
      options: ["SIM", "NAO"],
    },
    // Legacy state: existing answers remain readable; new conversations use REGIONS.
    SERVICE_AREA: {
      key: "SERVICE_AREA",
      text: "Vamos atualizar as regiões onde você pode trabalhar. Responda MENU para ver a pergunta atualizada.",
      options: ["SIM", "TALVEZ", "NAO"],
    },
    AVAILABILITY: {
      key: "AVAILABILITY",
      text: "Quando você pode trabalhar?\n1 — Segunda a sexta de manhã\n2 — Segunda a sexta à tarde\n3 — Sábado\n4 — Domingo\nPode escolher mais de uma (exemplo: 1 e 3), escrever outros dias e turnos ou mandar áudio.",
    },
  };
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, choices: readonly string[]): boolean {
  return choices.some(
    (choice) =>
      text === choice ||
      text.includes(` ${choice} `) ||
      text.startsWith(`${choice} `) ||
      text.endsWith(` ${choice}`)
  );
}

function parseYesNo(value: string): "SIM" | "NAO" | undefined {
  const padded = ` ${value} `;
  // Variações frequentes em mensagens rápidas e transcrições de áudio. Não
  // incluímos "não sei" ou "talvez": nesses casos é melhor pedir ajuda do
  // que transformar incerteza em uma decisão da profissional.
  if (includesAny(padded, ["NAO SEI", "TALVEZ", "DEPENDE", "QUEM SABE"]))
    return undefined;
  if (
    includesAny(padded, ["NAO", "NAUM", "NAUMM", "NUM", "RECUSO", "NUNCA"]) ||
    includesAny(padded, [
      "NAO CONSIGO",
      "NAO POSSO",
      "NAO QUERO",
      "NAO DA",
      "N CONSIGO",
      "N POSSO",
      "N QUERO",
      "N DA",
    ])
  )
    return "NAO";
  if (
    includesAny(padded, [
      "SIM",
      "SIMM",
      "SIIM",
      "SS",
      "CLARO",
      "JA TRABALHEI",
      "JA FIZ",
    ])
  )
    return "SIM";
  return undefined;
}

function parseServiceArea(value: string): "SIM" | "TALVEZ" | "NAO" | undefined {
  if (
    includesAny(` ${value} `, [
      "TALVEZ",
      "TALVEIS",
      "TALVES",
      "NAO SEI",
      "DEPENDE",
      "AS VEZES",
      "QUEM SABE",
    ])
  )
    return "TALVEZ";
  const yesNo = parseYesNo(value);
  if (yesNo) return yesNo;
  if (includesAny(` ${value} `, ["CONSIGO", "POSSO", "DA SIM"])) return "SIM";
  return undefined;
}
export function parseAnswer(
  state: ConversationState,
  value: string
): string | undefined {
  const normalized = normalizeAnswer(value);
  if (
    !normalized ||
    globalCommand(value) ||
    [
      "OI",
      "OLA",
      "BOM DIA",
      "BOA TARDE",
      "BOA NOITE",
      "TUDO BEM",
      "OI TUDO BEM",
      "OLA TUDO BEM",
      "OBRIGADA",
      "OBRIGADO",
      "OK",
    ].includes(normalized)
  )
    return undefined;
  if (
    /^(OI|OLA|BOM DIA|BOA TARDE|BOA NOITE)( (TUDO BEM|BOM DIA|BOA TARDE|BOA NOITE))?$/.test(
      normalized
    )
  )
    return undefined;
  if (state === "EXPERIENCE_KIND") {
    if (["1", "FORMAL"].includes(normalized)) return "FORMAL";
    if (["2", "DIARISTA"].includes(normalized)) return "DIARISTA";
    if (
      ["3", "NONE", "NAO"].includes(normalized) ||
      /\b(AINDA NAO|NUNCA|SEM EXPERIENCIA|NAO TRABALHEI)\b/.test(normalized)
    )
      return "NONE";
    if (/\b(NAO|NUNCA|SEM)\b/.test(normalized)) return undefined;
    if (/\b(CARTEIRA|EMPRESA|REGISTRADA|REGISTRADO)\b/.test(normalized))
      return "FORMAL";
    if (/\b(DIARISTA|DIARIAS|FAXINAS|FAXINEIRA|POR CONTA)\b/.test(normalized))
      return "DIARISTA";
    return undefined;
  }
  if (state === "CONFIRMATION") {
    if (
      [
        "1",
        "CONFIRMAR",
        "CONFIRMO",
        "SIM",
        "ESTA CERTO",
        "TUDO CERTO",
      ].includes(normalized)
    )
      return "CONFIRM";
    if (["2", "CORRIGIR", "ALTERAR", "NAO"].includes(normalized)) return "EDIT";
    return undefined;
  }
  if (state === "EDIT_SELECTION")
    return (
      {
        "1": "NAME",
        NOME: "NAME",
        "2": "REGIONS",
        BAIRROS: "REGIONS",
        REGIOES: "REGIONS",
        "3": "EXPERIENCE_KIND",
        EXPERIENCIA: "EXPERIENCE_KIND",
        "4": "AVAILABILITY",
        DISPONIBILIDADE: "AVAILABILITY",
      } as Record<string, string>
    )[normalized];
  if (state === "AVAILABILITY") {
    if (/^[1-4](?: (?:E )?[1-4])*$/.test(normalized)) {
      const labels = [
        "Segunda a sexta de manhã",
        "Segunda a sexta à tarde",
        "Sábado",
        "Domingo",
      ];
      return [...new Set(normalized.match(/[1-4]/g))]
        .map((n) => labels[Number(n) - 1])
        .join("; ");
    }
    if (/\d/.test(normalized) && !/[A-Z]{3}/.test(normalized)) return undefined;
    if (
      !/\b(SEGUNDAS?|TERCAS?|QUARTAS?|QUINTAS?|SEXTAS?|SABADOS?|DOMINGOS?|SEG|TER|QUA|QUI|SEX|SAB|DOM|DIAS|SEMANA|MANHA|TARDE|NOITE|INTEGRAL|QUALQUER|TODOS|TODO)\b/.test(
        normalized
      )
    )
      return undefined;
    if (/^(TODOS|TODO|QUALQUER) (OS )?DIAS/.test(normalized))
      return (
        "Segunda a domingo" +
        (normalized.includes("MANHA")
          ? " de manhã"
          : normalized.includes("TARDE")
            ? " à tarde"
            : "")
      );
    return value.trim();
  }
  if (
    ["NAME", "REGIONS", "NEIGHBORHOOD"].includes(state) &&
    (!/[A-Z]{2}/.test(normalized) || normalized.length > 500)
  )
    return undefined;
  const numeric = {
    CHANNEL_PREFERENCE: ["WHATSAPP", "PHONE"],
    PROFESSIONAL_EXPERIENCE: ["SIM", "NAO"],
    EXPERIENCE_DURATION: ["LT_1Y", "Y1_3", "GT_3Y", "BY_AUDIO"],
    INFORMAL_EXPERIENCE: ["SIM", "NAO"],
    SERVICE_AREA: ["SIM", "TALVEZ", "NAO"],
  } as const;
  const options = numeric[state as keyof typeof numeric];
  if (options && /^[1-4]$/.test(normalized))
    return options[Number(normalized) - 1];
  if (
    state === "CHANNEL_PREFERENCE" &&
    ["WHATSAPP", "PHONE"].includes(normalized)
  )
    return normalized;
  if (["PROFESSIONAL_EXPERIENCE", "INFORMAL_EXPERIENCE"].includes(state))
    return parseYesNo(normalized);
  if (
    state === "EXPERIENCE_DURATION" &&
    ["LT_1Y", "Y1_3", "GT_3Y", "BY_AUDIO"].includes(normalized)
  )
    return normalized;
  if (state === "SERVICE_AREA") return parseServiceArea(normalized);
  return options ? undefined : normalized;
}
export function globalCommand(
  value: string
): "HELP" | "PHONE" | "STOP" | "MENU" | "MISUNDERSTOOD" | undefined {
  const text = normalizeAnswer(value);
  if (
    [
      "AJUDA",
      "HELP",
      "ATENDENTE",
      "FALAR COM ATENDENTE",
      "FALAR COM UM ATENDENTE",
      "FALAR COM UMA ATENDENTE",
      "FALAR COM HUMANO",
      "FALAR COM A EQUIPE",
    ].includes(text)
  )
    return "HELP";
  if (["LIGACAO", "PHONE", "LIGAR"].includes(text)) return "PHONE";
  if (["PARAR", "STOP", "CANCELAR"].includes(text)) return "STOP";
  if (text === "MENU") return "MENU";
  if (text === "NAO ENTENDI") return "MISUNDERSTOOD";
  return undefined;
}

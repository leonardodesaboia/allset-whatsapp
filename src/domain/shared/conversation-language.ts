/** Deterministic Portuguese replies shared by text and audio transcriptions. */
export function normalizeConversationText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\bS+I+M+\b/g, "SIM").replace(/\bNA+O+\b/g, "NAO");
}

export function containsPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some(phrase => ` ${text} `.includes(` ${phrase} `));
}

export function isUncertainReply(value: string): boolean {
  const text = normalizeConversationText(value);
  return /[?？]/u.test(value) || /^(?:(?:OI|OLA|BOM DIA|BOA TARDE|BOA NOITE) )?COMO\b/.test(text) || containsPhrase(text, [
    "TALVEZ", "TALVES", "TALVEIS", "DEPENDE", "QUEM SABE", "NAO SEI", "N SEI",
    "ACHO", "SE DER", "SE EU", "SO SE", "CASO", "PRECISO SABER", "QUERO SABER",
    "GOSTARIA DE SABER", "QUANTO", "QUAL", "QUANDO", "SERA", "AINDA VOU VER",
    "VOU PENSAR", "VOU VER", "NAO TENHO CERTEZA", "TIVER", "PUDER", "SE", "OU",
    "VOU CONFIRMAR DEPOIS", "VOU RESPONDER DEPOIS",
  ]);
}

type ReplyContext = "CONSENT" | "OPPORTUNITY" | "CONFIRMATION" | "EXPERIENCE" | "SERVICE_AREA";

export function parseBinaryReply(value: string, context: ReplyContext): "YES" | "NO" | undefined {
  if (isUncertainReply(value) || parseConversationCommand(value)) return undefined;
  const text = normalizeConversationText(value);
  // These phrases negate a refusal rather than express one. Ask again instead
  // of assigning a meaning to a double negative or a correction mid-message.
  if (containsPhrase(text, ["NAO QUERO RECUSAR", "NAO VOU RECUSAR", "NAO QUERO CANCELAR", "NAO PRECISA ALTERAR", "NAO SO", "MAS", "POREM"])) return undefined;
  const noProblem = context !== "EXPERIENCE" && containsPhrase(text, ["NAO TEM PROBLEMA", "NAO VEJO PROBLEMA", "SEM PROBLEMA", "SEM PROBLEMAS"]);
  const decisionText = noProblem ? text.replace(/\bNAO (?:TEM|VEJO) PROBLEMA\b/g, "") : text;
  const negative = containsPhrase(decisionText, [
    "NAO", "NAUM", "NAUMM", "NUNCA", "RECUSO", "RECUSAR", "SEM INTERESSE",
    "N CONSIGO", "N POSSO", "N QUERO", "N VOU", "N DA", "FICA PARA OUTRA", "FICA PRA OUTRA",
    "DEIXA PARA OUTRA", "DEIXA PRA OUTRA", "OUTRA HORA", "AGORA NUM", "NUM CONSIGO", "NUM POSSO", "NUM VOU",
  ]) || ["N", "NUM"].includes(text);
  if (negative) return "NO";

  const commonYes = containsPhrase(text, ["SIM", "SIMM", "SIIM", "SS", "CLARO", "COM CERTEZA", "PODE SER"])
    || ["S", "PODE", "CERTO", "BELEZA", "BLZ", "FECHOU", "COMBINADO"].includes(text);
  if (commonYes || noProblem) return "YES";
  const affirmatives: Record<ReplyContext, readonly string[]> = {
    CONSENT: ["ACEITO", "AUTORIZO", "PODE MANDAR", "PODE ENVIAR", "PODE ME MANDAR", "PODE ME ENVIAR", "QUERO RECEBER", "TENHO INTERESSE", "GOSTARIA DE RECEBER"],
    OPPORTUNITY: ["ACEITO", "CONFIRMO", "PODE CONFIRMAR", "PODE CONTAR COMIGO", "CONTA COMIGO", "EU TOPO", "TO DENTRO", "ESTOU DENTRO", "POSSO IR", "CONSIGO IR", "VOU SIM", "QUERO ESSE", "QUERO ESTE", "FICO COM ESSE", "FICO COM ESTE"],
    CONFIRMATION: ["CONFIRMO", "CONFIRMAR", "PODE CONFIRMAR", "PODE CONTINUAR", "PODEMOS CONTINUAR", "PODE SEGUIR", "VAMOS SEGUIR", "TUDO CERTO", "ESTA CERTO", "TA CERTO", "ESTA CORRETO", "PODE BUSCAR", "QUERO CONTRATAR", "GOSTARIA DE CONTRATAR"],
    EXPERIENCE: ["JA TRABALHEI", "JA FIZ", "TENHO EXPERIENCIA", "TRABALHO COM LIMPEZA", "SOU DIARISTA", "SOU FAXINEIRA"],
    SERVICE_AREA: ["CONSIGO", "POSSO", "ATENDO", "TRABALHO NESSA REGIAO", "DA CERTO"],
  };
  if (containsPhrase(text, affirmatives[context])) return "YES";
  const standalone: Partial<Record<ReplyContext, readonly string[]>> = {
    CONSENT: ["QUERO", "ACEITAR"], OPPORTUNITY: ["QUERO", "POSSO", "CONSIGO", "TOPO", "ACEITAR", "CONFIRMAR"],
    CONFIRMATION: ["QUERO", "OK", "OKAY", "CONTINUAR", "ACEITO"],
  };
  return standalone[context]?.includes(text) ? "YES" : undefined;
}

export type ConversationCommand = "HELP" | "PHONE" | "STOP" | "MENU" | "MISUNDERSTOOD";

export function parseConversationCommand(value: string): ConversationCommand | undefined {
  const text = normalizeConversationText(value);
  if (containsPhrase(text, ["NAO QUERO AJUDA", "NAO PRECISO DE AJUDA", "NAO QUERO PARAR", "NAO PARE", "NAO QUERO LIGACAO", "NAO ME LIGUE"])) return undefined;
  if (containsPhrase(text, ["NAO ENTENDI", "N ENTENDI", "NAUM ENTENDI", "NUM ENTENDI", "NAO COMPREENDI", "NAO CONSEGUI ENTENDER", "NAO ESTOU ENTENDENDO", "PODE EXPLICAR", "EXPLICA DE NOVO"])) return "MISUNDERSTOOD";
  if (["PARAR", "STOP", "PARE", "SAIR", "CANCELAR"].includes(text) || containsPhrase(text, ["QUERO PARAR", "PODE PARAR", "PARE DE ENVIAR", "PARE DE MANDAR", "NAO MANDE MAIS", "NAO ENVIE MAIS", "NAO QUERO MAIS RECEBER", "REMOVA MEU NUMERO", "TIRE MEU NUMERO"])) return "STOP";
  if (["LIGACAO", "PHONE", "LIGAR"].includes(text) || containsPhrase(text, ["ME LIGA", "ME LIGUE", "PODE ME LIGAR", "QUERO UMA LIGACAO", "PREFIRO LIGACAO", "PREFIRO POR TELEFONE"])) return "PHONE";
  if (["AJUDA", "HELP", "SOCORRO", "SUPORTE", "ATENDENTE"].includes(text) || containsPhrase(text, ["PRECISO DE AJUDA", "QUERO AJUDA", "PODE ME AJUDAR", "ME AJUDA", "ME AJUDE", "FALAR COM ALGUEM", "FALAR COM UMA PESSOA", "FALAR COM ATENDENTE", "FALAR COM A EQUIPE", "FALAR COM UM HUMANO"])) return "HELP";
  if (["MENU", "PERGUNTA", "REPETIR", "INICIO", "COMECO"].includes(text) || containsPhrase(text, ["VOLTAR AO MENU", "VOLTAR PARA O MENU", "MANDA O MENU", "MANDE O MENU", "MOSTRAR O MENU", "PODE REPETIR", "REPITA A PERGUNTA"])) return "MENU";
  return undefined;
}

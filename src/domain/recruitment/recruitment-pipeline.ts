import type { RecruitmentStatus } from "./recruitment-status";

export const RECRUITMENT_COLUMNS = [
  { status: "LEAD", label: "Novos contatos" },
  { status: "PRE_CADASTRO", label: "Em cadastro" },
  { status: "TRIAGEM", label: "Cadastro recebido" },
  { status: "CONVERSA_PENDENTE", label: "Em análise" },
  { status: "DOCUMENTACAO", label: "Documentos" },
  { status: "ATIVA", label: "Aprovadas" },
  { status: "BASE_FUTURA", label: "Base futura" },
  { status: "REPROVADA", label: "Reprovadas" },
  { status: "SUSPENSA", label: "Suspensas" },
  { status: "DESISTIU", label: "Desistências" },
] as const satisfies readonly { status: RecruitmentStatus; label: string }[];

// Display grouping only: never rewrites a lead's status or its history.
export function recruitmentColumn(
  status: RecruitmentStatus
): RecruitmentStatus {
  if (
    [
      "ENTREVISTA",
      "REFERENCIA",
      "PRE_APROVADA",
      "LIGACAO_SOLICITADA",
      "PRECISA_DE_AJUDA",
      "AGUARDANDO_COMPLEMENTACAO",
      "PAUSADA",
    ].includes(status)
  )
    return "CONVERSA_PENDENTE";
  if (["ONBOARDING", "TESTE_OPERACIONAL", "EM_VALIDACAO"].includes(status))
    return "DOCUMENTACAO";
  if (status === "PREFERENCIAL") return "ATIVA";
  return status;
}

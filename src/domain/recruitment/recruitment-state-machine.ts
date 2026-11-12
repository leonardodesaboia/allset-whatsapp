import { DomainError } from "../shared/domain-error";
import { err, ok, type Result } from "../shared/result";
import type { RecruitmentStatus } from "./recruitment-status";

const mainStages: RecruitmentStatus[] = [
  "PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "ENTREVISTA", "REFERENCIA",
  "PRE_APROVADA", "ONBOARDING", "TESTE_OPERACIONAL",
  "EM_VALIDACAO", "ATIVA", "PREFERENCIAL",
];
const commonExits: RecruitmentStatus[] = [
  "LIGACAO_SOLICITADA", "PRECISA_DE_AJUDA", "AGUARDANDO_COMPLEMENTACAO",
  "BASE_FUTURA", "DESISTIU", "PAUSADA", "REPROVADA",
];
const stage = (forward: RecruitmentStatus[]): RecruitmentStatus[] => [...new Set([...forward, ...commonExits])];

export const ALLOWED_TRANSITIONS: Record<RecruitmentStatus, RecruitmentStatus[]> = {
  LEAD: stage(["PRE_CADASTRO"]),
  // Cadastro simples: nome + aceite de propostas ativa direto.
  PRE_CADASTRO: stage(["TRIAGEM", "ATIVA"]),
  TRIAGEM: stage(["CONVERSA_PENDENTE"]),
  // Sem envio de documentos: a aprovação do admin ativa direto da análise.
  CONVERSA_PENDENTE: stage(["ENTREVISTA", "ATIVA"]),
  ENTREVISTA: stage(["REFERENCIA", "ATIVA"]),
  REFERENCIA: stage(["PRE_APROVADA", "ATIVA"]),
  PRE_APROVADA: stage(["ONBOARDING", "ATIVA"]),
  // Etapa antiga, mantida só para quem ainda está nela.
  DOCUMENTACAO: stage(["ONBOARDING", "ATIVA"]),
  ONBOARDING: stage(["TESTE_OPERACIONAL", "ATIVA"]),
  TESTE_OPERACIONAL: stage(["EM_VALIDACAO", "ATIVA"]),
  EM_VALIDACAO: stage(["ATIVA", "PREFERENCIAL"]),
  ATIVA: ["PREFERENCIAL", "PAUSADA", "SUSPENSA", "LIGACAO_SOLICITADA", "DESISTIU", "REPROVADA"],
  PREFERENCIAL: ["ATIVA", "PAUSADA", "SUSPENSA", "LIGACAO_SOLICITADA", "DESISTIU", "REPROVADA"],
  LIGACAO_SOLICITADA: [...mainStages, "DESISTIU", "BASE_FUTURA", "REPROVADA"],
  PRECISA_DE_AJUDA: [...mainStages, "DESISTIU", "BASE_FUTURA", "LIGACAO_SOLICITADA", "AGUARDANDO_COMPLEMENTACAO", "REPROVADA"],
  AGUARDANDO_COMPLEMENTACAO: [...mainStages, "DESISTIU", "BASE_FUTURA", "LIGACAO_SOLICITADA", "REPROVADA", "PRECISA_DE_AJUDA"],
  PAUSADA: [...mainStages, "LIGACAO_SOLICITADA", "SUSPENSA", "DESISTIU", "REPROVADA"],
  SUSPENSA: ["ATIVA", "PREFERENCIAL", "DESISTIU"],
  BASE_FUTURA: ["PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "DESISTIU"],
  DESISTIU: [],
  REPROVADA: [],
};

export function transitionRecruitmentStatus(
  current: RecruitmentStatus,
  target: RecruitmentStatus,
): Result<RecruitmentStatus, DomainError> {
  if (!ALLOWED_TRANSITIONS[current].includes(target)) {
    return err(new DomainError(`Transição inválida de ${current} para ${target}`, "INVALID_RECRUITMENT_TRANSITION"));
  }
  return ok(target);
}

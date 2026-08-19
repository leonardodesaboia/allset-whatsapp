import { DomainError } from "../shared/domain-error";
import { err, ok, type Result } from "../shared/result";
import type { RecruitmentStatus } from "./recruitment-status";

const mainStages: RecruitmentStatus[] = [
  "PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "ENTREVISTA", "REFERENCIA",
  "PRE_APROVADA", "DOCUMENTACAO", "ONBOARDING", "TESTE_OPERACIONAL",
  "EM_VALIDACAO", "ATIVA", "PREFERENCIAL",
];
const commonExits: RecruitmentStatus[] = [
  "LIGACAO_SOLICITADA", "PRECISA_DE_AJUDA", "AGUARDANDO_COMPLEMENTACAO",
  "BASE_FUTURA", "DESISTIU", "PAUSADA", "REPROVADA",
];
const stage = (forward: RecruitmentStatus[]): RecruitmentStatus[] => [...new Set([...forward, ...commonExits])];

export const ALLOWED_TRANSITIONS: Record<RecruitmentStatus, RecruitmentStatus[]> = {
  LEAD: stage(["PRE_CADASTRO"]),
  PRE_CADASTRO: stage(["TRIAGEM"]),
  TRIAGEM: stage(["CONVERSA_PENDENTE"]),
  CONVERSA_PENDENTE: stage(["ENTREVISTA"]),
  ENTREVISTA: stage(["REFERENCIA"]),
  REFERENCIA: stage(["PRE_APROVADA"]),
  PRE_APROVADA: stage(["DOCUMENTACAO"]),
  DOCUMENTACAO: stage(["ONBOARDING"]),
  ONBOARDING: stage(["TESTE_OPERACIONAL"]),
  TESTE_OPERACIONAL: stage(["EM_VALIDACAO"]),
  EM_VALIDACAO: stage(["ATIVA", "PREFERENCIAL"]),
  ATIVA: ["PREFERENCIAL", "PAUSADA", "SUSPENSA", "LIGACAO_SOLICITADA"],
  PREFERENCIAL: ["ATIVA", "PAUSADA", "SUSPENSA", "LIGACAO_SOLICITADA"],
  LIGACAO_SOLICITADA: [...mainStages, "DESISTIU", "BASE_FUTURA", "REPROVADA"],
  PRECISA_DE_AJUDA: [...mainStages, "DESISTIU", "BASE_FUTURA", "LIGACAO_SOLICITADA"],
  AGUARDANDO_COMPLEMENTACAO: [...mainStages, "DESISTIU", "BASE_FUTURA", "LIGACAO_SOLICITADA", "REPROVADA"],
  PAUSADA: [...mainStages, "LIGACAO_SOLICITADA", "SUSPENSA", "DESISTIU"],
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

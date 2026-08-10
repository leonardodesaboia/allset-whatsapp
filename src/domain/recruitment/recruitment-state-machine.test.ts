import { describe, expect, it } from "vitest";
import { ALLOWED_TRANSITIONS, transitionRecruitmentStatus } from "./recruitment-state-machine";
import { RECRUITMENT_STATUSES, type RecruitmentStatus } from "./recruitment-status";

describe("transitionRecruitmentStatus", () => {
  it("permite transições declaradas e cobre todos os status", () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS) as [RecruitmentStatus, RecruitmentStatus[]][]) {
      for (const to of targets) expect(transitionRecruitmentStatus(from, to).ok).toBe(true);
    }
    for (const status of RECRUITMENT_STATUSES) expect(Object.hasOwn(ALLOWED_TRANSITIONS, status)).toBe(true);
  });
  it("aceita o caminho principal e rejeita pular para ativa", () => {
    const path: RecruitmentStatus[] = ["LEAD", "PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "ENTREVISTA", "REFERENCIA", "PRE_APROVADA", "DOCUMENTACAO", "ONBOARDING", "TESTE_OPERACIONAL", "EM_VALIDACAO", "ATIVA"];
    path.slice(1).forEach((to, index) => expect(transitionRecruitmentStatus(path[index]!, to).ok).toBe(true));
    expect(transitionRecruitmentStatus("PRE_CADASTRO", "ATIVA").ok).toBe(false);
  });
  it("permite recuperação e bloqueia estados terminais", () => {
    expect(transitionRecruitmentStatus("ENTREVISTA", "LIGACAO_SOLICITADA").ok).toBe(true);
    expect(transitionRecruitmentStatus("LIGACAO_SOLICITADA", "ENTREVISTA").ok).toBe(true);
    expect(transitionRecruitmentStatus("DESISTIU", "PRE_CADASTRO").ok).toBe(false);
  });
});

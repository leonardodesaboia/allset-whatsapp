export function registrationSummary(lead: {
  fullName: string | null;
  serviceRegions: string | null;
  neighborhood: string | null;
  hasProfessionalExperience: boolean | null;
  hasInformalExperience: boolean | null;
  availabilityDays: unknown;
}): string {
  const experience =
    lead.hasProfessionalExperience === true
      ? lead.hasInformalExperience === null
        ? "Já trabalhou com limpeza"
        : lead.hasInformalExperience
          ? "Como diarista"
          : "Com carteira ou em empresa"
      : lead.hasInformalExperience === true
        ? "Experiência informal"
        : lead.hasProfessionalExperience === false
          ? "Ainda não"
          : "Não informada";
  const days = Array.isArray(lead.availabilityDays)
    ? lead.availabilityDays
        .filter((day): day is string => typeof day === "string")
        .join("; ")
    : "Não informada";
  return `Confira seu cadastro:\nNome: ${lead.fullName ?? "Não informado"}\nRegiões: ${lead.serviceRegions ?? lead.neighborhood ?? "Não informadas"}\nExperiência: ${experience}\nDisponibilidade: ${days}`;
}

const ELIGIBLE_STATUSES = new Set(["ATIVA", "PREFERENCIAL"]);

// Mapa normalizado (sem acentos) → dia da semana (0=dom, 1=seg, …, 6=sáb)
const DAY_MAP: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, seg: 1,
  terca: 2, ter: 2,
  quarta: 3, qua: 3,
  quinta: 4, qui: 4,
  sexta: 5, sex: 5,
  sabado: 6, sab: 6,
};

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Retorna Set de dias disponíveis, ou null se não foi possível parsear nenhum dia
// (campo não preenchido → não filtra por dia).
function parseDays(raw: unknown): Set<number> | null {
  if (!Array.isArray(raw)) return null;
  const days = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const n = normalizeText(entry);
    // Detecta range "X a Y" (ex: "segunda a sexta")
    const rangeMatch = n.match(/(\w+)\s+a\s+(\w+)/);
    if (rangeMatch) {
      const startKey = rangeMatch[1] ?? "";
      const endKey = rangeMatch[2] ?? "";
      const start = DAY_MAP[startKey];
      const end = DAY_MAP[endKey];
      if (start !== undefined && end !== undefined) {
        for (let d = Math.min(start, end); d <= Math.max(start, end); d++) days.add(d);
        continue;
      }
    }
    // Extrai palavras individuais
    for (const word of n.split(/[\s,/;-]+/)) {
      if (DAY_MAP[word] !== undefined) days.add(DAY_MAP[word]);
    }
  }
  return days.size > 0 ? days : null;
}

function sameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export interface OpportunityInfo {
  neighborhood: string;
  scheduledAt: Date;
  durationMinutes: number;
}

export interface LeadInfo {
  status: string;
  neighborhood: string | null;
  canServeInitialArea: "SIM" | "TALVEZ" | "NAO" | null;
  availabilityDays: unknown;
  phoneE164: string | null;
}

export function isEligibleForOpportunity(
  lead: LeadInfo,
  opportunity: OpportunityInfo,
  acceptedSlotDates: Date[],
): boolean {
  if (!ELIGIBLE_STATUSES.has(lead.status)) return false;
  if (!lead.phoneE164) return false;

  const area = lead.canServeInitialArea;
  if (!area || area === "NAO") return false;
  if (area === "TALVEZ" && lead.neighborhood !== opportunity.neighborhood) return false;

  const days = parseDays(lead.availabilityDays);
  if (days !== null && !days.has(opportunity.scheduledAt.getUTCDay())) return false;

  for (const slot of acceptedSlotDates) {
    if (sameUTCDay(slot, opportunity.scheduledAt)) return false;
  }

  return true;
}

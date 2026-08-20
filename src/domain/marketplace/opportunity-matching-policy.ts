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

function daysInWeeklyRange(start: number, end: number): number[] {
  const length = start <= end ? end - start + 1 : 7 - start + end + 1;
  return Array.from({ length }, (_, offset) => (start + offset) % 7);
}

// Retorna Set de dias disponíveis, ou null se não foi possível parsear nenhum dia
// (campo não preenchido → não filtra por dia).
function parseDays(raw: unknown): Set<number> | null {
  if (!Array.isArray(raw)) return null;
  const days = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const n = normalizeText(entry);
    // Detecta range "X a Y" — aceita nomes compostos como "segunda-feira a sexta-feira".
    const rangeMatch = n.match(/(\w+(?:-\w+)*)\s+a\s+(\w+(?:-\w+)*)/);
    if (rangeMatch) {
      // Usa apenas o primeiro token (ex: "segunda" de "segunda-feira").
      const startKey = (rangeMatch[1] ?? "").split("-")[0] ?? "";
      const endKey = (rangeMatch[2] ?? "").split("-")[0] ?? "";
      const start = DAY_MAP[startKey];
      const end = DAY_MAP[endKey];
      if (start !== undefined && end !== undefined) {
        for (const day of daysInWeeklyRange(start, end)) days.add(day);
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

const FORTALEZA_TIME_ZONE = "America/Fortaleza";
const weekdayByShortName: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fortalezaParts = new Intl.DateTimeFormat("en-US", {
  timeZone: FORTALEZA_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function fortalezaDate(date: Date): { weekday: number; year: string; month: string; day: string } | null {
  try {
    const parts = Object.fromEntries(fortalezaParts.formatToParts(date).map((part) => [part.type, part.value]));
    const weekday = weekdayByShortName[parts.weekday ?? ""];
    if (weekday === undefined || !parts.year || !parts.month || !parts.day) return null;
    return { weekday, year: parts.year, month: parts.month, day: parts.day };
  } catch {
    return null;
  }
}

function sameFortalezaDay(a: Date, b: Date): boolean {
  const left = fortalezaDate(a);
  const right = fortalezaDate(b);
  if (!left || !right) return false;
  return left.year === right.year && left.month === right.month && left.day === right.day;
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
  const oppDay = fortalezaDate(opportunity.scheduledAt);
  if (!oppDay) return false;
  if (days !== null && !days.has(oppDay.weekday)) return false;

  for (const slot of acceptedSlotDates) {
    if (sameFortalezaDay(slot, opportunity.scheduledAt)) return false;
  }

  return true;
}

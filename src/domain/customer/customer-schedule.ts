const FORTALEZA_TIME_ZONE = "America/Fortaleza";
const FORTALEZA_OFFSET = "-03:00";
const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

export type CustomerScheduleDateChoice = {
  value: string;
  label: string;
};

export type CustomerScheduleTimeChoice = {
  value: string;
  label: string;
};

export const CUSTOMER_SCHEDULE_TIME_CHOICES: readonly CustomerScheduleTimeChoice[] = [
  { value: "08:00", label: "08:00" },
  { value: "09:00", label: "09:00" },
  { value: "13:00", label: "13:00" },
  { value: "14:00", label: "14:00" },
];

function fortalezaDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FORTALEZA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = (type: string) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Missing ${type} in formatted date`);
    return Number(part);
  };

  return { year: value("year"), month: value("month"), day: value("day") };
}

function isoDateFromFortalezaOffset(baseDate: Date, offsetDays: number): string {
  const base = fortalezaDateParts(baseDate);
  const utcNoon = new Date(Date.UTC(base.year, base.month - 1, base.day + offsetDays, 12));
  return [
    utcNoon.getUTCFullYear(),
    String(utcNoon.getUTCMonth() + 1).padStart(2, "0"),
    String(utcNoon.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function shortDateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

export function customerScheduleDateChoices(baseDate = new Date()): readonly CustomerScheduleDateChoice[] {
  return [
    { value: isoDateFromFortalezaOffset(baseDate, 1), label: `Amanhã (${shortDateLabel(isoDateFromFortalezaOffset(baseDate, 1))})` },
    { value: isoDateFromFortalezaOffset(baseDate, 2), label: `Depois de amanhã (${shortDateLabel(isoDateFromFortalezaOffset(baseDate, 2))})` },
    { value: isoDateFromFortalezaOffset(baseDate, 3), label: shortDateLabel(isoDateFromFortalezaOffset(baseDate, 3)) },
    { value: isoDateFromFortalezaOffset(baseDate, 4), label: shortDateLabel(isoDateFromFortalezaOffset(baseDate, 4)) },
    { value: isoDateFromFortalezaOffset(baseDate, 5), label: shortDateLabel(isoDateFromFortalezaOffset(baseDate, 5)) },
  ];
}

export function parseScheduleDateChoice(text: string, baseDate = new Date()): string | undefined {
  const trimmed = text.trim();
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric)) return customerScheduleDateChoices(baseDate)[numeric - 1]?.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return undefined;
}

export function parseScheduleTimeChoice(text: string): string | undefined {
  const trimmed = text.trim();
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric)) return CUSTOMER_SCHEDULE_TIME_CHOICES[numeric - 1]?.value;
  if (CUSTOMER_SCHEDULE_TIME_CHOICES.some((choice) => choice.value === trimmed)) return trimmed;
  return undefined;
}

/**
 * Accepts a short natural-language slot such as "amanhã às 14h" while
 * preserving the fixed, operationally available time slots.
 */
export function parseScheduleDateTime(text: string, baseDate = new Date()): { date: string; time: string } | undefined {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const timeMatch = normalized.match(/(?:as?|às?)?\s*(0?[89]|13|14)(?:h|:00)?\b/);
  if (!timeMatch) return undefined;
  const hour = Number(timeMatch[1]);
  const time = `${String(hour).padStart(2, "0")}:00`;
  if (!CUSTOMER_SCHEDULE_TIME_CHOICES.some((choice) => choice.value === time)) return undefined;

  let date: string | undefined;
  if (/\bhoje\b/.test(normalized)) date = isoDateFromFortalezaOffset(baseDate, 0);
  else if (/\bdepois de amanha\b/.test(normalized)) date = isoDateFromFortalezaOffset(baseDate, 2);
  else if (/\bamanha\b/.test(normalized)) date = isoDateFromFortalezaOffset(baseDate, 1);
  else {
    const iso = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    const brazilian = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (iso) date = iso;
    else if (brazilian) {
      const current = fortalezaDateParts(baseDate);
      const year = brazilian[3] ? Number(brazilian[3]) : current.year;
      date = `${year}-${String(Number(brazilian[2])).padStart(2, "0")}-${String(Number(brazilian[1])).padStart(2, "0")}`;
    } else {
      const weekday = Object.entries(WEEKDAY_INDEX).find(([name]) => new RegExp(`\\b${name}(?:-feira)?\\b`).test(normalized))?.[0];
      if (weekday) {
        const current = fortalezaDateParts(baseDate);
        const currentWeekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
        const targetWeekday = WEEKDAY_INDEX[weekday];
        if (targetWeekday !== undefined) {
          const offset = (targetWeekday - currentWeekday + 7) % 7;
          date = isoDateFromFortalezaOffset(baseDate, offset);
        }
      }
    }
  }
  return date ? { date, time } : undefined;
}

export function scheduledAtFromFortalezaLocal(isoDate: string, time: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = isoDate.split("-").map(Number);
  const [hour = Number.NaN, minute = Number.NaN] = time.split(":").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 || minute > 59
  ) return undefined;
  return new Date(`${isoDate}T${time}:00${FORTALEZA_OFFSET}`);
}

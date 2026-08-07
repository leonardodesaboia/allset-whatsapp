const FORTALEZA_TIME_ZONE = "America/Fortaleza";
const FORTALEZA_OFFSET = "-03:00";

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

export function scheduledAtFromFortalezaLocal(isoDate: string, time: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const scheduledAt = new Date(`${isoDate}T${time}:00${FORTALEZA_OFFSET}`);
  return Number.isNaN(scheduledAt.getTime()) ? undefined : scheduledAt;
}

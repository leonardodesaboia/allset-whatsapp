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

/**
 * The customer picks any time; the professional decides whether she can make
 * it. The window only rejects obvious mistakes such as "3h" (madrugada).
 */
export const CUSTOMER_SCHEDULE_EARLIEST_HOUR = 6;
export const CUSTOMER_SCHEDULE_LATEST_HOUR = 22;

function fortalezaDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
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

function isoDateFromFortalezaOffset(
  baseDate: Date,
  offsetDays: number
): string {
  const base = fortalezaDateParts(baseDate);
  const utcNoon = new Date(
    Date.UTC(base.year, base.month - 1, base.day + offsetDays, 12)
  );
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

export function customerScheduleDateChoices(
  baseDate = new Date()
): readonly CustomerScheduleDateChoice[] {
  return [
    {
      value: isoDateFromFortalezaOffset(baseDate, 1),
      label: `Amanhã (${shortDateLabel(isoDateFromFortalezaOffset(baseDate, 1))})`,
    },
    {
      value: isoDateFromFortalezaOffset(baseDate, 2),
      label: `Depois de amanhã (${shortDateLabel(isoDateFromFortalezaOffset(baseDate, 2))})`,
    },
    {
      value: isoDateFromFortalezaOffset(baseDate, 3),
      label: shortDateLabel(isoDateFromFortalezaOffset(baseDate, 3)),
    },
    {
      value: isoDateFromFortalezaOffset(baseDate, 4),
      label: shortDateLabel(isoDateFromFortalezaOffset(baseDate, 4)),
    },
    {
      value: isoDateFromFortalezaOffset(baseDate, 5),
      label: shortDateLabel(isoDateFromFortalezaOffset(baseDate, 5)),
    },
  ];
}

export function parseScheduleDateChoice(
  text: string,
  baseDate = new Date()
): string | undefined {
  const trimmed = text.trim();
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric))
    return customerScheduleDateChoices(baseDate)[numeric - 1]?.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return undefined;
}

function normalizeScheduleText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type ClockTime = { hour: number; minute: number };

/**
 * Reads one clock time from text that no longer contains a date. Accepts
 * "14h", "14 h", "14hrs", "14 horas", "14:00", "14h30", "2 da tarde", "as 14"
 * and a bare "14". It never guesses: anything it cannot read yields undefined.
 */
function parseClockTime(text: string): ClockTime | undefined {
  const clock = text.match(
    /(?<![\d/:.])(\d{1,2})(?:\s*(?:h|hs|hr|hrs|hora|horas)(?![a-z])\s*(\d{2})?|:(\d{2}))(?![\d/])/
  );
  if (clock)
    return {
      hour: Number(clock[1]),
      minute: Number(clock[2] ?? clock[3] ?? 0),
    };
  const period = text.match(
    /(?<![\d/:.])(\d{1,2})\s*(?:da|de|pela|a)\s*(manha|tarde|noite)\b/
  );
  if (period) {
    const hour = Number(period[1]);
    return {
      hour: period[2] !== "manha" && hour < 12 ? hour + 12 : hour,
      minute: 0,
    };
  }
  if (/\bmeio[- ]?dia\b/.test(text)) return { hour: 12, minute: 0 };
  const afterPreposition = text.match(
    /\b(?:as|a|para|pras)\s+(\d{1,2})\b(?![\d/:])/
  );
  if (afterPreposition) return { hour: Number(afterPreposition[1]), minute: 0 };
  const bare = text.match(/^[^\d]*(\d{1,2})[^\d]*$/);
  if (bare) return { hour: Number(bare[1]), minute: 0 };
  return undefined;
}

function slotTime(clock: ClockTime): string | undefined {
  const minutes = clock.hour * 60 + clock.minute;
  if (
    clock.minute > 59 ||
    minutes < CUSTOMER_SCHEDULE_EARLIEST_HOUR * 60 ||
    minutes > CUSTOMER_SCHEDULE_LATEST_HOUR * 60
  )
    return undefined;
  return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

/** Time-step answer: a free time such as "14h", "14:30" or "2 da tarde". */
export function parseScheduleTimeChoice(text: string): string | undefined {
  const clock = parseClockTime(normalizeScheduleText(text));
  return clock ? slotTime(clock) : undefined;
}

export type ScheduleInterpretation =
  | { status: "slot"; date: string; time: string }
  | { status: "date_only"; date: string }
  | { status: "time_only"; time: string }
  | { status: "time_unavailable"; date?: string; hour: number; minute: number }
  | { status: "unknown" };

function isoFromParts(
  year: number,
  month: number,
  day: number
): string | undefined {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return scheduledAtFromFortalezaLocal(iso, "12:00") ? iso : undefined;
}

type DateExtraction = { date?: string; rest: string; invalid?: boolean };

/** Removes the first date expression (dd/mm, ISO, "dia 18", amanhã, weekday); returns what is left. */
function extractDate(normalized: string, baseDate: Date): DateExtraction {
  const today = fortalezaDateParts(baseDate);
  const todayIso = isoFromParts(today.year, today.month, today.day) ?? "";
  const cut = (match: RegExpMatchArray): string =>
    `${normalized.slice(0, match.index)} ${normalized.slice((match.index ?? 0) + match[0].length)}`
      .replace(/\s+/g, " ")
      .trim();

  const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? { date, rest: cut(iso) } : { rest: cut(iso), invalid: true };
  }
  const brazilian = normalized.match(
    /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/
  );
  if (brazilian) {
    const day = Number(brazilian[1]);
    const month = Number(brazilian[2]);
    let year = today.year;
    if (brazilian[3])
      year =
        brazilian[3].length === 2
          ? 2000 + Number(brazilian[3])
          : Number(brazilian[3]);
    let date = isoFromParts(year, month, day);
    // "18/10" typed after 18/10 already passed means next year's date.
    if (date && !brazilian[3] && date < todayIso)
      date = isoFromParts(year + 1, month, day);
    return date
      ? { date, rest: cut(brazilian) }
      : { rest: cut(brazilian), invalid: true };
  }
  const dayOfMonth = normalized.match(/\bdia\s+(\d{1,2})\b(?!\s*\/)/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    let date = isoFromParts(today.year, today.month, day);
    if (!date || date < todayIso) {
      const next =
        today.month === 12
          ? { year: today.year + 1, month: 1 }
          : { year: today.year, month: today.month + 1 };
      date = isoFromParts(next.year, next.month, day);
    }
    return date
      ? { date, rest: cut(dayOfMonth) }
      : { rest: cut(dayOfMonth), invalid: true };
  }
  const relative = normalized.match(/\b(depois de amanha|amanha|hoje)\b/);
  if (relative) {
    const offset =
      relative[1] === "hoje" ? 0 : relative[1] === "amanha" ? 1 : 2;
    return {
      date: isoDateFromFortalezaOffset(baseDate, offset),
      rest: cut(relative),
    };
  }
  for (const [name, targetWeekday] of Object.entries(WEEKDAY_INDEX)) {
    const weekday = normalized.match(new RegExp(`\\b${name}(?:-feira)?\\b`));
    if (!weekday) continue;
    const currentWeekday = new Date(
      Date.UTC(today.year, today.month - 1, today.day)
    ).getUTCDay();
    const offset = (targetWeekday - currentWeekday + 7) % 7 || 7;
    return {
      date: isoDateFromFortalezaOffset(baseDate, offset),
      rest: cut(weekday),
    };
  }
  return { rest: normalized };
}

/**
 * Interprets a free-text day/time answer and reports exactly what was
 * understood so the caller can confirm it or ask again. It never falls back
 * to a default slot.
 */
export function interpretScheduleReply(
  text: string,
  baseDate = new Date()
): ScheduleInterpretation {
  const normalized = normalizeScheduleText(text);
  if (!normalized) return { status: "unknown" };
  const choices = customerScheduleDateChoices(baseDate);

  if (/^\d$/.test(normalized)) {
    const choice = choices[Number(normalized) - 1];
    if (choice) return { status: "date_only", date: choice.value };
  }

  const extracted = extractDate(normalized, baseDate);
  if (extracted.invalid) return { status: "unknown" };
  let { date, rest } = extracted;

  // "3 14h" / "opcao 3 as 14": a day option followed by a time.
  if (!date) {
    const option = normalized.match(
      /^(?:opcao\s*|op\s*)?([1-5])(?!\d)\s*(?:[-,.:]|\be\b)?\s*(.+)$/
    );
    const chosen = option ? choices[Number(option[1]) - 1] : undefined;
    if (option && chosen && option[2] && parseClockTime(option[2])) {
      date = chosen.value;
      rest = option[2];
    }
  }

  if (!rest)
    return date ? { status: "date_only", date } : { status: "unknown" };
  const clock = parseClockTime(rest);
  if (!clock)
    return date && !/\d/.test(rest)
      ? { status: "date_only", date }
      : { status: "unknown" };
  const time = slotTime(clock);
  if (!time) {
    return {
      status: "time_unavailable",
      ...(date ? { date } : {}),
      hour: clock.hour,
      minute: clock.minute,
    };
  }
  return date ? { status: "slot", date, time } : { status: "time_only", time };
}

/** Day and time understood together, or undefined — never a partial guess. */
export function parseScheduleDateTime(
  text: string,
  baseDate = new Date()
): { date: string; time: string } | undefined {
  const interpreted = interpretScheduleReply(text, baseDate);
  return interpreted.status === "slot"
    ? { date: interpreted.date, time: interpreted.time }
    : undefined;
}

export function scheduledAtFromFortalezaLocal(
  isoDate: string,
  time: string
): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^\d{2}:\d{2}$/.test(time))
    return undefined;
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = isoDate
    .split("-")
    .map(Number);
  const [hour = Number.NaN, minute = Number.NaN] = time.split(":").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    return undefined;
  return new Date(`${isoDate}T${time}:00${FORTALEZA_OFFSET}`);
}

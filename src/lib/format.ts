const TIME_ZONE = "America/Fortaleza";

/** Formata E.164/dígitos brasileiros como +55 (85) 99999-9999; devolve o original se não reconhecer. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length === 11) return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `+55 (${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return value;
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TIME_ZONE });
}

/** "há 5 min", "há 3 h", "há 2 dias" — para listas; combine com formatDateTime no title. */
export function formatRelative(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "—";
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60_000);
  if (minutes < 1) return "agora";
  const days = Math.floor(minutes / (60 * 24));
  const text =
    minutes < 60 ? `${minutes} min`
    : minutes < 60 * 24 ? `${Math.floor(minutes / 60)} h`
    : `${days} ${days === 1 ? "dia" : "dias"}`;
  return future ? `em ${text}` : `há ${text}`;
}

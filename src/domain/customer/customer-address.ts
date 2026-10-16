const STREET_PREFIX =
  /^(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|al\.?|praca|estrada|rodovia|br|ce|beco|via|largo|passagem)\b/;
const UNIT_WORD =
  /\b(apto|apartamento|ap|bloco|casa|sala|lote|quadra|cep|condominio|edificio|ed)\b/;
const CITY_OR_STATE = new Set([
  "fortaleza",
  "caucaia",
  "maracanau",
  "eusebio",
  "aquiraz",
  "ce",
  "ceara",
  "brasil",
  "brazil",
  "cidade",
  "bairro",
]);

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function tidy(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed === collapsed.toLowerCase()
    ? collapsed.replace(
        /(^|\s)(\p{L})/gu,
        (_match, space: string, letter: string) => space + letter.toUpperCase()
      )
    : collapsed;
}

/**
 * Best-effort bairro extraction from a free-text address, e.g.
 * "Rua Silva Paulet, 1234, apto 501, Aldeota, Fortaleza - CE" -> "Aldeota".
 * Returns undefined when it cannot tell, so the caller can simply ask.
 */
export function extractNeighborhood(address: string): string | undefined {
  const explicit = address.match(
    /\bbairro\s*[:-]?\s*([^,;\n]+?)(?:\s+-\s+|[,;\n]|$)/i
  );
  const explicitName = explicit?.[1]?.trim();
  if (explicitName && explicitName.length >= 3 && explicitName.length <= 60)
    return tidy(explicitName);

  const segments = address
    .split(/[,;\n]|\s[-–]\s/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const normalized = normalize(segment);
    if (normalized.length < 3 || normalized.length > 60) continue;
    if (/\d/.test(normalized)) continue;
    if (STREET_PREFIX.test(normalized) || UNIT_WORD.test(normalized)) continue;
    if (CITY_OR_STATE.has(normalized)) continue;
    return tidy(segment);
  }
  return undefined;
}

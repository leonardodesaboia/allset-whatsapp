import { timingSafeEqual } from "node:crypto";

/** Compara dois segredos em tempo constante para evitar timing-attacks. */
export function compareSecret(expected: string | undefined, supplied: string | null): boolean {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

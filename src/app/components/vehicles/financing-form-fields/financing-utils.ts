/**
 * Converts a monetary value in reais to cents.
 * Returns null when the input is null, undefined or NaN.
 */
export function toCents(reais: number | null | undefined): number | null {
  if (reais == null) return null;
  const n = Number(reais);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

import { AbstractControl, ValidationErrors } from '@angular/forms';

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

/** Inverse of {@link toCents} — cents to reais, for prefilling the edit form. */
export function toReais(cents: number | null | undefined): number | null {
  if (cents == null) return null;
  return cents / 100;
}

/** `yyyy-MM-dd` de hoje, no fuso local (evita o shift de `toISOString()`). */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Regra de negócio do backend: `endDate` precisa ser posterior a `startDate`.
 * Aplicada no grupo para que a mensagem apareça antes do round-trip.
 */
export function insuranceDateRangeValidator(group: AbstractControl): ValidationErrors | null {
  const start = group.get('startDate')?.value;
  const end = group.get('endDate')?.value;
  if (!start || !end) return null;
  return end > start ? null : { insuranceDateRange: true };
}

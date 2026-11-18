import { Pipe, PipeTransform } from '@angular/core';

/** What the number means: an integer of cents (the API default) or reais. */
export type BrlUnit = 'cents' | 'reais';

/** Text of an absent amount. Zero is never absent: it reads "R$ 0,00". */
export const BRL_EMPTY = '—';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * THE money text of the app: full pt-BR with cents, "R$ 120.400,00" (owner rule, 18/11/2026).
 * Cards, tables, lists, chart tooltips and exports use it; only a chart axis may abbreviate
 * (`brl-cents-compact` in the KPI card formats).
 *
 * - `null`, `undefined`, `''` and anything that is not a finite number -> `BRL_EMPTY`;
 * - cents are rounded to the integer before dividing, so 1999.6 cents is "R$ 20,00";
 * - a value that rounds to zero is "R$ 0,00", never "-R$ 0,00".
 *
 * Numeric strings ("12345", what a BigDecimal can arrive as) are read as numbers.
 * The space after "R$" is the non-breaking one `Intl` writes, so the symbol never wraps alone.
 */
export function formatBrl(value: number | string | null | undefined, unit: BrlUnit = 'cents'): string {
  if (value === null || value === undefined || value === '') return BRL_EMPTY;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return BRL_EMPTY;
  const reais = unit === 'cents' ? Math.round(n) / 100 : n;
  const text = BRL.format(reais);
  // -0 and anything that rounds to it ("-R$ 0,00") is plain zero.
  return /^-R\$\s0,00$/.test(text) ? BRL.format(0) : text;
}

/**
 * `{{ cents | brl }}` -> "R$ 1.234,56"; `{{ reais | brl: 'reais' }}` for amounts in reais.
 * Absent -> "—". Pure: same input, same text. See `formatBrl` for the TypeScript side.
 */
@Pipe({ name: 'brl' })
export class BrlPipe implements PipeTransform {
  transform(value: number | string | null | undefined, unit: BrlUnit = 'cents'): string {
    return formatBrl(value, unit);
  }
}

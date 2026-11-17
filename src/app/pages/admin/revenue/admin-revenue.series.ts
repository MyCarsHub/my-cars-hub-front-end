import type { AdminRevenueMonth } from '../../../types/admin-revenue.types';
import type { BarDatum } from '../../../components/charts/bar-chart/bar-chart';

/**
 * Regras puras dos gráficos de receita do admin. O backend manda `null` onde o dado não existe; aqui
 * o nulo SAI do gráfico (nunca vira zero) e a tela diz desde quando o dado existe.
 */

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-11` -> `nov` ou, com ano, `nov/26`. */
export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS_PT[(m || 1) - 1] ?? month;
  return withYear ? `${name}/${String(y).slice(-2)}` : name;
}

/** A janela cruza a virada do ano: o rótulo leva o ano para `jan` de um ano não ser lido como o outro. */
export function spansYears(months: readonly AdminRevenueMonth[]): boolean {
  return new Set(months.map((m) => m.month.slice(0, 4))).size > 1;
}

/** `2026-11-05` -> `05/11/2026`. */
export function dateLabel(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export interface MonthSeries {
  readonly labels: string[];
  readonly values: number[];
}

/** Só os meses com valor, na ordem; o rótulo de cada ponto é o mês dele. */
export function presentSeries(
  months: readonly AdminRevenueMonth[],
  pick: (m: AdminRevenueMonth) => number | null,
): MonthSeries {
  const withYear = spansYears(months);
  const labels: string[] = [];
  const values: number[] = [];
  for (const m of months) {
    const v = pick(m);
    if (v === null || v === undefined) continue;
    labels.push(monthLabel(m.month, withYear));
    values.push(v);
  }
  return { labels, values };
}

/** Barras por mês (mais recente primeiro, como a lista de meses do painel), só com meses medidos. */
export function monthBars(
  months: readonly AdminRevenueMonth[],
  pick: (m: AdminRevenueMonth) => number | null,
): BarDatum[] {
  const withYear = spansYears(months);
  return months
    .filter((m) => pick(m) !== null && pick(m) !== undefined)
    .map((m) => ({ label: monthLabel(m.month, withYear), value: pick(m) as number }))
    .reverse();
}

/** Parte do esperado que já entrou, 0..1. Sem esperado não há barra. */
export function receivedShare(receivedCents: number, expectedCents: number): number | null {
  if (!(expectedCents > 0)) return null;
  return Math.max(0, Math.min(1, receivedCents / expectedCents));
}

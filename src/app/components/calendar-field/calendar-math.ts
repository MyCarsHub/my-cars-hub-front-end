/**
 * Conta do calendário em dias civis (`yyyy-MM-dd`), sem hora nem fuso: um `Date` UTC usado só
 * como data, então a troca de horário de verão do navegador nunca pula um dia.
 */

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DAY.test(value);
}

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** O mesmo dia `n` meses depois, preso ao último dia do mês quando ele não existe (31/01 + 1 = 28/02). */
export function addMonthsClamped(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))));
}

/** `yyyy-MM` do dia. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `yyyy-MM` deslocado `n` meses. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  return fromUtc(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}

/** Meses entre `a` e `b` (`yyyy-MM`): b − a. */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** "Novembro 2026". */
export function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function weekdayIndex(iso: string): number {
  return toUtc(iso).getUTCDay();
}

/** "terça". */
export function weekdayName(iso: string): string {
  return WEEKDAYS_LONG[weekdayIndex(iso)];
}

/** "terça, 24 de novembro de 2026" — o nome do dia para o leitor de tela. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${weekdayName(iso)}, ${d} de ${MONTHS[m - 1].toLowerCase()} de ${y}`;
}

/** `dd/mm/aaaa`, ou '' quando não é um dia. */
export function brDay(iso: string | null | undefined): string {
  return isDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
}

/** As semanas do mês (domingo primeiro); `null` nas casas antes do dia 1 e depois do último. */
export function monthWeeks(ym: string): (string | null)[][] {
  const first = `${ym}-01`;
  const lead = weekdayIndex(first);
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Fora de `min`/`max` (texto `yyyy-MM-dd` ordena como data). */
export function outOfBounds(iso: string, min: string | null, max: string | null): boolean {
  return (!!min && iso < min) || (!!max && iso > max);
}

/** Leva `iso` para dentro de `min`/`max`. */
export function clampDay(iso: string, min: string | null, max: string | null): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

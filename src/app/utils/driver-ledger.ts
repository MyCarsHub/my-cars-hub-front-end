import {
  DriverCategoryTotal,
  LedgerCategory,
  LedgerEntry,
  LedgerKind,
} from '../types/driver-ledger.types';

/**
 * Pure helpers of the driver's area: category catalogue, period math and the comparison
 * against the previous period. No Angular, no DOM — everything here is a function of its
 * arguments, so it is tested as such.
 */

// ---------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------

export interface LedgerCategoryMeta {
  readonly value: LedgerCategory;
  readonly kind: LedgerKind;
  readonly label: string;
}

/** The order here is the order of the chips and of the breakdown. */
export const LEDGER_CATEGORIES: readonly LedgerCategoryMeta[] = [
  { value: 'RIDES', kind: 'INCOME', label: 'Corridas' },
  { value: 'DELIVERIES', kind: 'INCOME', label: 'Entregas' },
  { value: 'OTHER_INCOME', kind: 'INCOME', label: 'Outros ganhos' },
  { value: 'FUEL', kind: 'EXPENSE', label: 'Combustível' },
  { value: 'MAINTENANCE', kind: 'EXPENSE', label: 'Manutenção' },
  { value: 'RENTAL_FEE', kind: 'EXPENSE', label: 'Aluguel do carro' },
  { value: 'FINE', kind: 'EXPENSE', label: 'Multa' },
  { value: 'FOOD', kind: 'EXPENSE', label: 'Alimentação' },
  { value: 'TOLL_PARKING', kind: 'EXPENSE', label: 'Pedágio e estacionamento' },
  { value: 'OTHER_EXPENSE', kind: 'EXPENSE', label: 'Outros custos' },
];

export const LEDGER_KIND_LABELS: Readonly<Record<LedgerKind, string>> = {
  INCOME: 'Ganho',
  EXPENSE: 'Custo',
};

/** Categories of one kind, in display order. */
export function categoriesOf(kind: LedgerKind): readonly LedgerCategoryMeta[] {
  return LEDGER_CATEGORIES.filter((c) => c.kind === kind);
}

/** Pt-BR label of a category. An unknown value falls back to the raw one, never to blank. */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return '—';
  return LEDGER_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

/** The kind a category belongs to, or `null` for a value this build does not know. */
export function kindOfCategory(category: string): LedgerKind | null {
  return LEDGER_CATEGORIES.find((c) => c.value === category)?.kind ?? null;
}

/** `true` when `category` is a legal category of `kind` — the form never sends a mismatch. */
export function categoryBelongsToKind(category: string, kind: LedgerKind): boolean {
  return kindOfCategory(category) === kind;
}

// ---------------------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------------------

export interface BreakdownBar {
  readonly category: LedgerCategory;
  readonly label: string;
  readonly totalCents: number;
  readonly count: number;
  /** 0..100, relative to the biggest bar of the SAME kind — never to the other kind. */
  readonly widthPct: number;
  /** Share of the kind's total, 0..100, rounded to an integer. */
  readonly sharePct: number;
}

/**
 * Bars of one kind, biggest first. The width is relative to the biggest bar so that the
 * leader fills the track: a share-of-total width would make a 12% category a sliver.
 * Zero and negative totals are dropped — a bar with nothing to show is noise.
 */
export function breakdownFor(
  rows: readonly DriverCategoryTotal[],
  kind: LedgerKind,
): BreakdownBar[] {
  const ofKind = rows.filter((r) => r.kind === kind && r.totalCents > 0);
  const sum = ofKind.reduce((acc, r) => acc + r.totalCents, 0);
  const max = ofKind.reduce((acc, r) => Math.max(acc, r.totalCents), 0);
  if (sum === 0 || max === 0) return [];

  return [...ofKind]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((r) => ({
      category: r.category,
      label: categoryLabel(r.category),
      totalCents: r.totalCents,
      count: r.entryCount,
      widthPct: Math.max(2, Math.round((r.totalCents / max) * 100)),
      sharePct: Math.round((r.totalCents / sum) * 100),
    }));
}

// ---------------------------------------------------------------------------------------
// Period math
// ---------------------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since the epoch for an ISO date, in UTC so DST and the browser zone never leak in. */
function toDayNumber(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  // Rejects 2026-02-31 and friends: Date.UTC would silently roll them into March.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / DAY_MS);
}

function fromDayNumber(day: number): string {
  const d = new Date(day * DAY_MS);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** `iso` moved by `delta` calendar days (negative goes back); `null` for a bad date. */
export function addDaysIso(iso: string, delta: number): string | null {
  const day = toDayNumber(iso);
  return day === null ? null : fromDayNumber(day + delta);
}

/**
 * `iso` moved back by whole `years`, clamping to the month's last day (29 Feb minus one year
 * is 28 Feb) — the same rule as `LocalDate.minusYears`, which is what the server applies to
 * the oldest date a ledger entry may carry. `null` for a bad date.
 */
export function minusYearsIso(iso: string, years: number): string | null {
  if (toDayNumber(iso) === null) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const targetYear = y - years;
  const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(targetYear).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface IsoRange {
  readonly from: string;
  readonly to: string;
}

/** Number of calendar days in `from..to`, both ends included; `null` for a bad range. */
export function daysInRange(range: IsoRange): number | null {
  const a = toDayNumber(range.from);
  const b = toDayNumber(range.to);
  if (a === null || b === null || b < a) return null;
  return b - a + 1;
}

/** The dashboard does not answer for more than a year at once (`MAX_SPAN_DAYS` on the server). */
export const MAX_PERIOD_DAYS = 366;

/**
 * `true` when `range` is longer than the server accepts. A bad or inverted range is NOT
 * "too long": the picker already refuses those, and this must not hide that message.
 */
export function periodTooLong(range: IsoRange): boolean {
  const days = daysInRange(range);
  return days !== null && days > MAX_PERIOD_DAYS;
}

/**
 * Days of `range` that have ALREADY happened as of `today` — the divisor of "por dia".
 *
 * The month-to-date chip ends on the last day of the month, so dividing by the full month
 * would show a driver who earned R$ 900 in the first three days as "R$ 30 per day".
 * Before the period starts there is nothing to average: `null`.
 */
export function elapsedDays(range: IsoRange, today: string): number | null {
  const from = toDayNumber(range.from);
  const to = toDayNumber(range.to);
  const now = toDayNumber(today);
  if (from === null || to === null || now === null || to < from) return null;
  if (now < from) return null;
  return Math.min(to, now) - from + 1;
}

/** Integer cents per day, rounded half up; `null` without a divisor. */
export function perDayCents(totalCents: number, days: number | null): number | null {
  if (days === null || days <= 0) return null;
  return Math.round(totalCents / days);
}

// ---------------------------------------------------------------------------------------
// Comparison with the previous period
// ---------------------------------------------------------------------------------------

export interface PeriodDelta {
  /** `+12,3%` / `-8,0%` / `novo`; `null` when there is nothing to compare. */
  readonly label: string | null;
  readonly direction: 'up' | 'down' | 'flat';
}

/**
 * Current against previous, in percent with one decimal.
 *
 * Zero on both sides is "nothing to compare" (no label), and growth from zero is "novo"
 * rather than an infinite percentage. The base is `|previous|`: a net result that went
 * from -100 to -50 is an improvement and must read as `+50%`, which dividing by the signed
 * previous would flip into a decline.
 */
export function comparePeriods(current: number, previous: number): PeriodDelta {
  if (previous === 0 && current === 0) return { label: null, direction: 'flat' };
  if (previous === 0) return { label: 'novo', direction: current > 0 ? 'up' : 'down' };

  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return { label: '0%', direction: 'flat' };

  const sign = rounded > 0 ? '+' : '';
  const text = rounded.toFixed(1).replace('.', ',');
  return { label: `${sign}${text}%`, direction: rounded > 0 ? 'up' : 'down' };
}

/**
 * The caption under a KPI: arrow + percentage + "vs período anterior", or a neutral line.
 * `short` is for the half-width cards of a phone, where the long form is truncated.
 */
export function deltaCaption(delta: PeriodDelta, short = false): string {
  if (delta.label === null) return short ? 'sem comparação' : 'sem dados no período anterior';
  const arrow = delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : '';
  return `${arrow}${delta.label} vs ${short ? 'anterior' : 'período anterior'}`;
}

// ---------------------------------------------------------------------------------------
// Optimistic list refresh
// ---------------------------------------------------------------------------------------

/**
 * Puts a saved entry into an already-loaded list WITHOUT waiting for the refetch: an edit
 * replaces the row in place, a new entry is placed by date (newest first, ahead of the others of the same day). An entry that
 * falls outside the list's period is left out — the list is "the entries of this period",
 * and showing a row the filter would not return is a lie the next refetch has to undo.
 * The list never grows past `limit` (the dashboard's "recentes" is a window, not a page).
 */
export function mergeEntry(
  list: readonly LedgerEntry[],
  entry: LedgerEntry,
  options: { from?: string | null; to?: string | null; limit: number },
): LedgerEntry[] {
  const without = list.filter((e) => e.id !== entry.id);
  const inRange =
    (!options.from || entry.occurredOn >= options.from) &&
    (!options.to || entry.occurredOn <= options.to);
  if (!inRange) return without.slice(0, options.limit);

  const merged = [entry, ...without].sort((a, b) =>
    a.occurredOn === b.occurredOn ? 0 : a.occurredOn < b.occurredOn ? 1 : -1,
  );
  return merged.slice(0, options.limit);
}

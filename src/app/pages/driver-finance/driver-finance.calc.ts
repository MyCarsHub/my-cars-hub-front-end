import { formatPtBrNumber } from '../../utils/ptbr-number';
import { ExpenseCategory, LedgerItem, RideApp } from './driver-finance.types';

/*
 * Pure helpers of the driver's finance screens: dates as ISO strings (no time zone can
 * shift a day), money as integer cents, and the aggregates every screen derives from the
 * ledger. Nothing here touches Angular, so every number a screen shows is testable alone.
 */

// ---------------------------------------------------------------- labels

export const RIDE_APPS: readonly RideApp[] = ['UBER', '99', 'INDRIVE', 'OUTRO'];

export const RIDE_APP_LABEL: Record<RideApp, string> = {
  UBER: 'Uber',
  '99': '99',
  INDRIVE: 'inDrive',
  OUTRO: 'Outro',
};

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'FUEL',
  'WASH',
  'TOLL',
  'MAINTENANCE',
  'PARKING',
  'OTHER',
];

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  FUEL: 'Combustível',
  WASH: 'Lavagem',
  TOLL: 'Pedágio',
  MAINTENANCE: 'Manutenção',
  PARKING: 'Estacionamento',
  OTHER: 'Outros',
};

/**
 * Categories other screens (or the server) may have written that this UI has no chip for.
 * They are SHOWN with their own name and kept on edit — never folded into "Outros".
 */
const OTHER_CATEGORY_LABEL: Record<string, string> = {
  FOOD: 'Alimentação',
  FINE: 'Multa',
  RENTAL_FEE: 'Aluguel',
  TOLL_PARKING: 'Pedágio e estacionamento',
  CAR_WASH: 'Lavagem',
  OTHER_EXPENSE: 'Outros',
  RIDES: 'Corridas',
  DELIVERIES: 'Entregas',
  OTHER_INCOME: 'Outros ganhos',
};

export function expenseLabel(category: string): string {
  return EXPENSE_LABEL[category as ExpenseCategory] ?? OTHER_CATEGORY_LABEL[category] ?? 'Outros';
}

/** Rent the driver typed himself as a cost; the Dashboard then does not debit it again. */
export const RENT_EXPENSE_CATEGORY = 'RENTAL_FEE';

export function appLabel(app: RideApp | null): string {
  return app ? RIDE_APP_LABEL[app] : 'Sem app';
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAY_LONG = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];
export const WEEKDAY_PLURAL = [
  'domingos',
  'segundas',
  'terças',
  'quartas',
  'quintas',
  'sextas',
  'sábados',
];

// ---------------------------------------------------------------- dates

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(iso: string): number {
  return toUtc(iso).getUTCDay();
}

/** The Monday of the ISO week that holds `iso`. */
export function mondayOf(iso: string): string {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  const d = toUtc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromUtc(d);
}

export function addMonths(iso: string, months: number): string {
  const d = toUtc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUtc(d);
}

export function minIso(...values: string[]): string {
  return values.reduce((a, b) => (b < a ? b : a));
}

export function maxIso(...values: string[]): string {
  return values.reduce((a, b) => (b > a ? b : a));
}

/** `10/10`. */
export function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** `10/10/2026`. */
export function ddmmyyyy(iso: string): string {
  return `${ddmm(iso)}/${iso.slice(0, 4)}`;
}

/** `Outubro de 2026`. */
export function monthLabel(iso: string): string {
  const name = MONTHS[Number(iso.slice(5, 7)) - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} de ${iso.slice(0, 4)}`;
}

/** `Sábado, 10 de outubro`. */
export function longDate(iso: string): string {
  return `${WEEKDAY_LONG[weekdayOf(iso)]}, ${Number(iso.slice(8, 10))} de ${
    MONTHS[Number(iso.slice(5, 7)) - 1]
  }`;
}

/** `Hoje`, `Ontem`, or `qua, 07/10` — how a list row names its day. */
export function relativeDay(iso: string, today: string): string {
  const ago = daysBetween(iso, today);
  if (ago === 0) return 'Hoje';
  if (ago === 1) return 'Ontem';
  return `${WEEKDAY_SHORT[weekdayOf(iso)]}, ${ddmm(iso)}`;
}

// ---------------------------------------------------------------- numbers

/** `R$ 1.234,56` (`-R$ 12,00` when negative). */
export function brl(cents: number): string {
  const rounded = Math.round(cents);
  const body = formatPtBrNumber(Math.abs(rounded), 2);
  return `${rounded < 0 ? '-R$' : 'R$'} ${body}`;
}

/** `R$ 1.235` — whole reais, for goals. */
export function brl0(cents: number): string {
  const reais = Math.round(cents / 100);
  return `${reais < 0 ? '-R$' : 'R$'} ${formatPtBrNumber(Math.abs(reais), 0)}`;
}

/** `R$1,2k` / `R$186` — the compact label above a bar. */
export function brlShort(cents: number): string {
  const reais = cents / 100;
  if (reais >= 1000) return `R$${(reais / 1000).toFixed(1).replace('.', ',')}k`;
  return `R$${Math.round(reais)}`;
}

/** `6,5` — quantities keep only the decimals they have. */
export function decimal(value: number, decimals = 1): string {
  return formatPtBrNumber(Math.round(value * 10 ** decimals), decimals, { trailingZeros: false });
}

/** `48.320`. */
export function integer(value: number): string {
  return formatPtBrNumber(Math.round(value), 0);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

// ---------------------------------------------------------------- periods

export type DashboardPreset =
  | 'monthCurrent'
  | 'today'
  | '7d'
  | '30d'
  | '90d'
  | 'monthPast'
  | 'year'
  | 'custom';

export const DASHBOARD_PRESETS: readonly { key: DashboardPreset; label: string }[] = [
  { key: 'monthCurrent', label: 'Mês atual' },
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'monthPast', label: 'Mês passado' },
  { key: 'year', label: 'Este ano' },
  { key: 'custom', label: 'Personalizado' },
];

export function presetRange(
  preset: DashboardPreset,
  today: string,
  custom: { from: string; to: string },
): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'monthPast': {
      const start = addMonths(today, -1);
      return { from: start, to: monthEnd(start) };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom':
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
    default:
      return { from: monthStart(today), to: monthEnd(today) };
  }
}

/** The three list periods of Ganhos and Custos. */
export type ListPeriod = 'today' | '7' | '30';

export const LIST_PERIODS: readonly { key: ListPeriod; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7', label: '7 dias' },
  { key: '30', label: '30 dias' },
];

export function listPeriodFrom(period: ListPeriod, today: string): string {
  return period === 'today' ? today : addDays(today, period === '7' ? -6 : -29);
}

// ---------------------------------------------------------------- aggregates

export interface Totals {
  gross: number;
  expenses: number;
  rides: number;
  hours: number;
  km: number;
  /** Days of the window that already happened (the future does not dilute averages). */
  days: number;
}

export function inRange(item: LedgerItem, from: string, to: string): boolean {
  return item.date >= from && item.date <= to;
}

export function totals(items: readonly LedgerItem[], from: string, to: string, today: string): Totals {
  const t: Totals = { gross: 0, expenses: 0, rides: 0, hours: 0, km: 0, days: 0 };
  for (const item of items) {
    if (!inRange(item, from, to)) continue;
    if (item.type === 'INCOME') {
      t.gross += item.amount;
      t.rides += item.rides ?? 0;
      t.hours += item.hours ?? 0;
      t.km += item.km ?? 0;
    } else {
      t.expenses += item.amount;
    }
  }
  const last = minIso(to, today);
  t.days = last < from ? 0 : daysBetween(from, last) + 1;
  return t;
}

/** Income and expense of each day, keyed by ISO date. */
export function byDay(items: readonly LedgerItem[]): Map<string, { income: number; expense: number }> {
  const map = new Map<string, { income: number; expense: number }>();
  for (const item of items) {
    const day = map.get(item.date) ?? { income: 0, expense: 0 };
    if (item.type === 'INCOME') day.income += item.amount;
    else day.expense += item.amount;
    map.set(item.date, day);
  }
  return map;
}

/** Newest first, then by id so equal days keep a stable order. */
export function newestFirst(a: LedgerItem, b: LedgerItem): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Weekly goal = daily × days; monthly = weekly × 4 (the prototype's rule). */
export function goalTargets(dailyGoal: number, workDaysPerWeek: number) {
  const week = dailyGoal * workDaysPerWeek;
  return { day: dailyGoal, week, month: week * 4 };
}

/** Rent that falls on one day of a rental billed `periodAmount` every `periodDays`. */
export function rentPerDay(periodAmount: number, periodDays: number): number {
  return periodDays > 0 ? periodAmount / periodDays : 0;
}

import { InjectionToken } from '@angular/core';
import { DriverCharge } from '../../../types/driver-charges.types';
import {
  RentalBillingFrequency,
  RentalResponseDto,
  RentalStatus,
  chargeStatusInfo,
  effectiveChargeStatus,
} from '../../../types/rental.types';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { groupDriverCharges, paidDayOf } from '../../../utils/driver-charges';

/**
 * The ONE clock of the driver's rental screens: list, detail and the pay sheet read "today"
 * from here, never from `new Date()`. Specs and the local demo replace it to freeze a day.
 */
export const DRIVER_RENTAL_TODAY = new InjectionToken<() => string>('DRIVER_RENTAL_TODAY', {
  providedIn: 'root',
  factory: () => () => todayInBusinessTz(),
});

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Cents to "R$ 650,00". */
export function money(cents: number): string {
  return BRL.format(cents / 100);
}

/** "1 dia" / "3 dias". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `yyyy-MM-dd` to "13/10". Anything else comes back empty, never "undefined/undefined". */
export function dayMonth(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}` : '';
}

/** `yyyy-MM-dd` to "13/10/2026". */
export function fullDate(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Day of the week of a calendar date. Read in UTC on purpose: the string IS the business
 * day already, and a local-time `Date` would move it back one day west of Greenwich.
 */
function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "terça". */
export function weekday(iso: string): string {
  return WEEKDAYS[weekdayIndex(iso)];
}

/** Whole days from `from` to `to` (both `yyyy-MM-dd`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const PERIOD_WORDS: Record<RentalBillingFrequency, { adjective: string; unit: string; per: string }> =
  {
    DAILY: { adjective: 'diário', unit: 'dia', per: 'por dia' },
    WEEKLY: { adjective: 'semanal', unit: 'semana', per: 'por semana' },
    MONTHLY: { adjective: 'mensal', unit: 'mês', per: 'por mês' },
  };

/** "Aluguel semanal · semana 10", "Caução", "Multa por atraso". */
export function chargeTitle(charge: DriverCharge, frequency: RentalBillingFrequency | null): string {
  switch (charge.kind) {
    case 'CAUCAO':
      return 'Caução';
    case 'OVERDUE_FEE':
      return 'Multa por atraso';
    case 'RENTAL_PERIOD': {
      const words = frequency ? PERIOD_WORDS[frequency] : null;
      if (!words) return 'Aluguel';
      // `periodIndex` is 0-based on the wire; the operator's schedule shows it +1 too.
      return charge.periodIndex != null
        ? `Aluguel ${words.adjective} · ${words.unit} ${charge.periodIndex + 1}`
        : `Aluguel ${words.adjective}`;
    }
    default:
      return 'Aluguel';
  }
}

const OPEN_STATUSES = new Set(['PENDING', 'PAST_DUE']);

/**
 * Something the driver can still pay from the app: open, and issued in the gateway. The
 * server only sends `checkoutUrl` for such a charge, so it is also the "has Pix" signal; a
 * local charge (no gateway) is paid as agreed with the rental company.
 */
export function isPayable(charge: DriverCharge, today: string): boolean {
  return OPEN_STATUSES.has(effectiveChargeStatus(charge, today)) && !!charge.checkoutUrl;
}

export function isOverdue(charge: DriverCharge, today: string): boolean {
  return effectiveChargeStatus(charge, today) === 'PAST_DUE';
}

// ------------------------------------------------------------------ charges card

export interface ChargeRow {
  readonly charge: DriverCharge;
  readonly title: string;
  readonly sub: string;
  readonly overdue: boolean;
  readonly amount: string;
  readonly chipLabel: string;
  readonly chipClass: string;
  readonly payable: boolean;
}

export interface ChargeList {
  /** Open first (oldest due first), then paid (most recent first). */
  readonly rows: readonly ChargeRow[];
  readonly openCount: number;
  readonly paidCount: number;
}

/** How many open and paid rows the collapsed card shows (the prototype's 2 + 3). */
export const COLLAPSED_OPEN = 2;
export const COLLAPSED_PAID = 3;

function rowSub(charge: DriverCharge, today: string): string {
  const status = effectiveChargeStatus(charge, today);
  if (status === 'REFUNDED') return 'Devolvido';
  if (status === 'PAID') {
    if (charge.dueDate) return `Pago · venc. ${fullDate(charge.dueDate)}`;
    const day = paidDayOf(charge.paidAt);
    return day ? `Pago em ${fullDate(day)}` : 'Pago';
  }
  if (!charge.dueDate) return 'Sem data de vencimento';
  if (status === 'PAST_DUE') return `Venceu em ${fullDate(charge.dueDate)}`;
  if (charge.dueDate === today) return `Vence hoje, ${fullDate(charge.dueDate)}`;
  return `Vence ${weekday(charge.dueDate)}, ${fullDate(charge.dueDate)}`;
}

/**
 * The rows of the "Cobranças" card. FAILED, CANCELED, RELEASED and DISPUTED are the
 * operator's business and have nothing the driver can act on, so they are not drawn
 * (the same cut `groupDriverCharges` makes).
 */
export function buildChargeList(
  charges: readonly DriverCharge[],
  today: string,
  frequency: RentalBillingFrequency | null,
): ChargeList {
  const groups = groupDriverCharges([...charges], today);
  const open = [...groups.overdue, ...(groups.next ? [groups.next] : []), ...groups.upcoming];
  const toRow = (charge: DriverCharge): ChargeRow => {
    const chip = chargeStatusInfo(charge, today);
    return {
      charge,
      title: chargeTitle(charge, frequency),
      sub: rowSub(charge, today),
      overdue: isOverdue(charge, today),
      amount: money(charge.amount),
      chipLabel: chip.label,
      chipClass: chip.chip,
      payable: isPayable(charge, today),
    };
  };
  return {
    rows: [...open.map(toRow), ...groups.history.map(toRow)],
    openCount: open.length,
    paidCount: groups.history.length,
  };
}

/** The collapsed card: the first open ones and the latest paid ones. */
export function collapsedRows(list: ChargeList): readonly ChargeRow[] {
  const open = list.rows.slice(0, list.openCount).slice(0, COLLAPSED_OPEN);
  const paid = list.rows.slice(list.openCount).slice(0, COLLAPSED_PAID);
  return [...open, ...paid];
}

// ------------------------------------------------------------------------- hero

export type HeroTone = 'overdue' | 'next' | 'clear' | 'ended';

export interface Hero {
  readonly tone: HeroTone;
  readonly label: string;
  readonly value: string;
  /** True when `value` is money (drawn in the mono face). */
  readonly valueIsMoney: boolean;
  readonly sub: string;
  /** The charge the block is about (oldest overdue, or the next one); `null` otherwise. */
  readonly charge: DriverCharge | null;
  /** The charge "Pagar agora" opens, or `null` when there is nothing to pay from here. */
  readonly payCharge: DriverCharge | null;
}

const ENDED: readonly RentalStatus[] = ['COMPLETED', 'CANCELED'];

/** "Vence terça, 13/10 · em 3 dias" / "· hoje". */
function dueSentence(dueDate: string | null, today: string): string {
  if (!dueDate) return 'Sem data de vencimento definida.';
  const days = daysBetween(today, dueDate);
  const when = days === 0 ? ' · hoje' : days > 0 ? ` · em ${plural(days, 'dia', 'dias')}` : '';
  return `Vence ${weekday(dueDate)}, ${dayMonth(dueDate)}${when}`;
}

const NO_LINK = ' O pagamento desta cobrança é combinado com a locadora.';

/**
 * The colored block at the top of the detail. Order of precedence:
 * 1. something overdue (rose) — even on an ended rental: the debt is what matters;
 * 2. something open (orange) — the next RENTAL charge; the caução only when it is the only
 *    open thing (a reserved rental shows its first weekly charge, as in the prototype);
 * 3. the rental ended with nothing open (neutral);
 * 4. nothing open on a live rental (green).
 *
 * Late fees are NOT computed here: the backend does not send them, so the copy only warns
 * that the amount may include them.
 */
export function buildHero(
  status: RentalStatus,
  charges: readonly DriverCharge[],
  today: string,
  period: { startDate: string; endDate: string },
): Hero {
  const groups = groupDriverCharges([...charges], today);

  if (groups.overdue.length > 0) {
    const oldest = groups.overdue[0];
    const days = oldest.dueDate ? daysBetween(oldest.dueDate, today) : 0;
    const many = groups.overdue.length > 1;
    const since = oldest.dueDate
      ? `${many ? 'A mais antiga venceu' : 'Venceu'} em ${dayMonth(oldest.dueDate)} (${plural(days, 'dia', 'dias')} de atraso). `
      : '';
    const payable = isPayable(oldest, today);
    return {
      tone: 'overdue',
      label: many ? plural(groups.overdue.length, 'cobrança atrasada', 'cobranças atrasadas') : 'Cobrança atrasada',
      value: money(oldest.amount),
      valueIsMoney: true,
      sub: `${since}Pode incluir multa e juros por atraso.${payable ? '' : NO_LINK}`,
      charge: oldest,
      payCharge: payable ? oldest : null,
    };
  }

  const open = [...(groups.next ? [groups.next] : []), ...groups.upcoming];
  const next = open.find((c) => c.kind !== 'CAUCAO') ?? open[0] ?? null;
  if (next) {
    const payable = isPayable(next, today);
    return {
      tone: 'next',
      label: status === 'RESERVED' ? 'Primeira cobrança' : 'Próxima cobrança',
      value: money(next.amount),
      valueIsMoney: true,
      sub: `${dueSentence(next.dueDate, today)}${payable ? '' : `.${NO_LINK}`}`,
      charge: next,
      payCharge: payable ? next : null,
    };
  }

  if (ENDED.includes(status)) {
    return {
      tone: 'ended',
      label: 'Aluguel encerrado',
      value: 'Tudo quitado',
      valueIsMoney: false,
      sub: `${fullDate(period.startDate)} a ${fullDate(period.endDate)}`,
      charge: null,
      payCharge: null,
    };
  }

  return {
    tone: 'clear',
    label: 'Cobranças',
    value: 'Tudo em dia',
    valueIsMoney: false,
    sub: 'Nenhuma cobrança em aberto.',
    charge: null,
    payCharge: null,
  };
}

/** The info banner of a reserved rental, or empty. */
export function reservedBanner(
  status: RentalStatus,
  startDate: string,
  charges: readonly DriverCharge[],
  today: string,
): string {
  if (status !== 'RESERVED') return '';
  const caucaoOpen = charges.some(
    (c) => c.kind === 'CAUCAO' && OPEN_STATUSES.has(effectiveChargeStatus(c, today)),
  );
  return `Seu aluguel começa em ${fullDate(startDate)}. ${
    caucaoOpen
      ? 'Pague a caução e faça a vistoria de retirada para pegar o carro.'
      : 'Faça a vistoria de retirada para pegar o carro.'
  }`;
}

// ------------------------------------------------------------- "O que foi combinado"

export interface Term {
  readonly label: string;
  readonly value: string;
  /** Takes the whole row of the two-column grid. */
  readonly wide: boolean;
  /** Money: drawn in the mono face. */
  readonly mono: boolean;
}

const FULL_WEEKDAYS = [
  'Todo domingo',
  'Toda segunda-feira',
  'Toda terça-feira',
  'Toda quarta-feira',
  'Toda quinta-feira',
  'Toda sexta-feira',
  'Todo sábado',
];

/** "Toda terça-feira" / "Todo dia 13" / "Todo dia", from the first rental charge's due date. */
function billingDay(rental: RentalResponseDto, charges: readonly DriverCharge[]): string {
  const firstPeriod = charges
    .filter((c) => c.kind === 'RENTAL_PERIOD' && c.dueDate)
    .sort((a, b) => (a.periodIndex ?? 0) - (b.periodIndex ?? 0))[0];
  const anchor = firstPeriod?.dueDate ?? rental.firstPaymentDate;
  switch (rental.billingFrequency) {
    case 'DAILY':
      return 'Todo dia';
    case 'WEEKLY':
      return anchor ? FULL_WEEKDAYS[weekdayIndex(anchor)] : '';
    case 'MONTHLY':
      return anchor ? `Todo dia ${Number(anchor.slice(8, 10))}` : '';
    default:
      return '';
  }
}

const PERCENT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** "Multa de 2% + juros de 1% ao mês", from what the operator configured. Empty when nothing. */
export function lateTerms(rental: RentalResponseDto): string {
  const parts: string[] = [];
  if (rental.lateFineType === 'PERCENT' && rental.lateFineValue) {
    parts.push(`multa de ${PERCENT.format(rental.lateFineValue / 100)}%`);
  } else if (rental.lateFineType === 'FIXED' && rental.lateFineValue) {
    parts.push(`multa de ${money(rental.lateFineValue)}`);
  }
  if (rental.lateInterestPercentPerMonth) {
    parts.push(`juros de ${PERCENT.format(rental.lateInterestPercentPerMonth)}% ao mês`);
  } else if (rental.dailyInterestAmount) {
    parts.push(`juros de ${money(rental.dailyInterestAmount)} por dia`);
  }
  const text = parts.join(' + ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function caucaoState(
  rental: RentalResponseDto,
  charges: readonly DriverCharge[],
  today: string,
): string {
  const refunded = paidDayOf(rental.caucaoRefundedAt ?? null);
  if (refunded) return `Devolvida em ${fullDate(refunded)}`;
  const charge = charges.find((c) => c.kind === 'CAUCAO');
  const status = charge ? effectiveChargeStatus(charge, today) : null;
  if (rental.caucaoPaid || status === 'PAID') return 'Paga';
  if (status && OPEN_STATUSES.has(status)) return 'Aguardando pagamento';
  return '';
}

/** What was agreed, in the order of the prototype. A term with no value is left out. */
export function buildTerms(
  rental: RentalResponseDto,
  charges: readonly DriverCharge[],
  today: string,
): readonly Term[] {
  const rateLabel = { DAILY: 'Valor diário', WEEKLY: 'Valor semanal', MONTHLY: 'Valor mensal' }[
    rental.billingFrequency
  ];
  const caucao =
    rental.caucaoAmount > 0
      ? [money(rental.caucaoAmount), caucaoState(rental, charges, today)].filter(Boolean).join(' · ')
      : '';
  const terms: Term[] = [
    { label: rateLabel ?? 'Valor', value: money(rental.periodRate), wide: false, mono: true },
    { label: 'Cobrança', value: billingDay(rental, charges), wide: false, mono: false },
    { label: 'Início', value: fullDate(rental.startDate), wide: false, mono: false },
    { label: 'Fim previsto', value: fullDate(rental.endDate), wide: false, mono: false },
    { label: 'Caução', value: caucao, wide: true, mono: false },
    {
      label: 'Km por dia',
      value: rental.franchiseKm ? `${rental.franchiseKm.toLocaleString('pt-BR')} km` : '',
      wide: false,
      mono: false,
    },
    { label: 'Combustível', value: rental.returnFuelPolicy?.trim() ?? '', wide: false, mono: false },
    { label: 'Atraso no pagamento', value: lateTerms(rental), wide: true, mono: false },
  ];
  return terms.filter((t) => t.value);
}

// ------------------------------------------------------------------------- list

export interface ListAlert {
  readonly text: string;
  readonly tone: 'danger' | 'warning';
}

/** The one line a list card warns with, or `null`. */
export function listAlert(
  status: RentalStatus,
  startDate: string,
  charges: readonly DriverCharge[] | null,
  today: string,
): ListAlert | null {
  if (charges) {
    const groups = groupDriverCharges([...charges], today);
    if (groups.overdue.length > 0) {
      return {
        text: plural(groups.overdue.length, 'cobrança atrasada', 'cobranças atrasadas'),
        tone: 'danger',
      };
    }
    const next = [...(groups.next ? [groups.next] : []), ...groups.upcoming].find(
      (c) => c.kind !== 'CAUCAO' && c.dueDate,
    );
    if (status === 'ACTIVE' && next?.dueDate) {
      return { text: `Próxima cobrança em ${dayMonth(next.dueDate)}`, tone: 'warning' };
    }
  }
  if (status === 'RESERVED') return { text: `Começa em ${dayMonth(startDate)}`, tone: 'warning' };
  return null;
}

/**
 * "R$ 650,00 por semana". The list row carries no `periodRate`, so the rate is read from
 * the rental charges themselves: the amount most of them have (a prorated last week does
 * not win). No rental charge, no line.
 */
export function rateLine(
  charges: readonly DriverCharge[] | null,
  frequency: RentalBillingFrequency,
): string {
  const counts = new Map<number, number>();
  for (const c of charges ?? []) {
    if (c.kind === 'RENTAL_PERIOD') counts.set(c.amount, (counts.get(c.amount) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [amount, count] of counts) {
    if (count > bestCount) {
      best = amount;
      bestCount = count;
    }
  }
  return best === null ? '' : `${money(best)} ${PERIOD_WORDS[frequency].per}`;
}

import {
  ChargePlanDto,
  ChargePlanInstalment,
  ChargeStatus,
  RentalBillingFrequency,
  RentalChargeDto,
} from '../../../types/rental.types';
import { isOpenChargeStatus } from '../../../utils/rental-charges';

/**
 * FEAT-0573 — Cobranças flexíveis: regras PURAS da interface (sem IO, sem Angular).
 *
 * Dinheiro em centavos, datas `yyyy-MM-dd`. A conta que vale é a do backend (prévia); estas
 * funções só montam o pedido e mostram a mesma conta antes da resposta chegar.
 */

/** Mínimo por cobrança que vai ao Asaas (contrato B2: R$ 5,00). */
export const MIN_GATEWAY_CENTS = 500;
/** Faixa do `defaultSplit.intervalDays` no contrato B2. */
export const MAX_SPLIT_INTERVAL_DAYS = 31;

export type IntervalUnit = 'DAYS' | 'WEEKS' | 'MONTHS';

/** G5 — "x dias, x semanas ou x meses". Mês = 30 dias, a mesma regra do aluguel MENSAL. */
export const INTERVAL_UNIT_OPTIONS: ReadonlyArray<{ value: IntervalUnit; singular: string; plural: string }> = [
  { value: 'DAYS', singular: 'dia', plural: 'dias' },
  { value: 'WEEKS', singular: 'semana', plural: 'semanas' },
  { value: 'MONTHS', singular: 'mês', plural: 'meses' },
];

export function intervalToDays(n: number, unit: IntervalUnit): number {
  const safe = Math.max(0, Math.trunc(n));
  if (unit === 'WEEKS') return safe * 7;
  if (unit === 'MONTHS') return safe * 30;
  return safe;
}

export function intervalLabel(n: number, unit: IntervalUnit): string {
  const opt = INTERVAL_UNIT_OPTIONS.find((o) => o.value === unit) ?? INTERVAL_UNIT_OPTIONS[0];
  return `${n} ${n === 1 ? opt.singular : opt.plural}`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Soma dias a uma data ISO em UTC (sem fuso: a data é civil). */
export function addDaysIso(iso: string, days: number): string {
  const m = DAY.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && DAY.test(value);
}

/** `dd/mm/aaaa`. */
export function brDate(iso: string | null | undefined): string {
  if (!isIsoDay(iso)) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** `dd/mm`. */
export function brDayMonth(iso: string | null | undefined): string {
  if (!isIsoDay(iso)) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function brl(cents: number | null | undefined): string {
  // `Intl` usa espaço não separável entre "R$" e o número; normalizado para espaço comum
  // para a cópia (e os testes) lerem como o resto do app escreve.
  return BRL.format((cents ?? 0) / 100).replace(/ /g, ' ');
}

/**
 * Divide `total` em `count` parcelas iguais; os centavos que sobram vão na ÚLTIMA (B2:
 * `floor(A/count)` em cada uma, a última leva `A − (count−1) × floor`).
 */
export function splitEvenly(total: number, count: number): number[] {
  const n = Math.max(1, Math.trunc(count));
  const base = Math.floor(total / n);
  const out = Array.from({ length: n }, () => base);
  out[n - 1] = total - base * (n - 1);
  return out;
}

/** Parcelas de `total`: a 1ª em `firstDue`, as demais a cada `intervalDays`. */
export function buildInstalments(
  total: number,
  count: number,
  firstDue: string,
  intervalDays: number,
): ChargePlanInstalment[] {
  return splitEvenly(total, count).map((amountCents, i) => ({
    dueDate: addDaysIso(firstDue, i * intervalDays),
    amountCents,
  }));
}

export interface InstalmentProblem {
  index: number;
  message: string;
}

/**
 * O que a interface já sabe recusar antes do backend (mesmos textos do contrato B2). A
 * lista volta vazia quando está tudo certo; o backend revalida tudo de qualquer jeito.
 */
export function instalmentProblems(
  instalments: readonly ChargePlanInstalment[],
  options: { expectedTotal: number; today: string; minCents: number },
): string[] {
  const problems: string[] = [];
  const sum = instalments.reduce((acc, i) => acc + i.amountCents, 0);
  if (sum !== options.expectedTotal) {
    problems.push(`As parcelas somam ${brl(sum)}, mas o valor da cobrança é ${brl(options.expectedTotal)}.`);
  }
  const low = instalments.findIndex((i) => i.amountCents < options.minCents);
  if (low >= 0) {
    problems.push(
      options.minCents >= MIN_GATEWAY_CENTS
        ? `Cada parcela precisa ser de pelo menos ${brl(options.minCents)}. A parcela ${low + 1} ficou com ${brl(instalments[low].amountCents)}.`
        : `A parcela ${low + 1} precisa ter valor.`,
    );
  }
  if (instalments.some((i) => !isIsoDay(i.dueDate) || i.dueDate < options.today)) {
    problems.push('As datas das parcelas precisam ser de hoje em diante.');
  }
  for (let i = 1; i < instalments.length; i++) {
    if (instalments[i].dueDate < instalments[i - 1].dueDate) {
      problems.push('As datas das parcelas precisam estar em ordem.');
      break;
    }
  }
  return problems;
}

/** Desconto de UMA cobrança: valor fixo, ou % arredondado HALF_UP no centavo (G4). */
export function discountFor(rateCents: number, type: 'AMOUNT' | 'PERCENT', value: number): number {
  if (type === 'AMOUNT') return Math.min(rateCents, Math.max(0, value));
  return Math.min(rateCents, Math.max(0, Math.round((rateCents * value) / 10000)));
}

/** Texto do % ("10" ou "12,5") em basis points; `null` quando não é número válido. */
export function percentTextToBps(text: string | null | undefined): number | null {
  const raw = (text ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (raw === '' || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  return Math.round(Number(raw) * 100);
}

// ---------------------------------------------------------------------------
// Plano da criação (journeys A, B, C, H)
// ---------------------------------------------------------------------------

export interface PlanDiscountState {
  type: 'AMOUNT' | 'PERCENT';
  /** AMOUNT: centavos; PERCENT: basis points. `null` = campo vazio/ilegível. */
  value: number | null;
  firstPeriods: number;
}

export interface PlanState {
  discount: PlanDiscountState | null;
  /** "Todas as semanas": mesmo parcelamento para cada período. */
  splitAll: { count: number; intervalDays: number } | null;
  /** "Só algumas": parcelas por período (índice 0-based). */
  periodOverrides: ReadonlyArray<{ periodIndex: number; instalments: ChargePlanInstalment[] }>;
  /** "Dividir a caução": as partes. */
  caucaoParts: ChargePlanInstalment[] | null;
}

export const EMPTY_PLAN: PlanState = {
  discount: null,
  splitAll: null,
  periodOverrides: [],
  caucaoParts: null,
};

/**
 * O `ChargePlanDto` que viaja no create e na prévia. `null` = sem plano, e então a chave
 * `chargePlan` nem vai no corpo (o backend faz exatamente o de hoje).
 */
export function buildChargePlan(state: PlanState): ChargePlanDto | null {
  const discount =
    state.discount && state.discount.value !== null && state.discount.value > 0
      ? {
          type: state.discount.type,
          value: state.discount.value,
          firstPeriods: Math.max(1, Math.trunc(state.discount.firstPeriods)),
        }
      : null;
  const defaultSplit =
    state.splitAll && state.splitAll.count >= 2
      ? { count: state.splitAll.count, intervalDays: state.splitAll.intervalDays }
      : null;
  const overrides = [
    ...(state.caucaoParts && state.caucaoParts.length >= 2
      ? [{ target: 'CAUCAO' as const, periodIndex: null, instalments: state.caucaoParts }]
      : []),
    ...state.periodOverrides
      .filter((o) => o.instalments.length >= 2)
      .map((o) => ({ target: 'PERIOD' as const, periodIndex: o.periodIndex, instalments: o.instalments })),
  ];
  if (!discount && !defaultSplit && overrides.length === 0) return null;
  return { discount, defaultSplit, overrides: overrides.length > 0 ? overrides : null };
}

// ---------------------------------------------------------------------------
// Rótulos das linhas (detalhe, motorista)
// ---------------------------------------------------------------------------

/** "Semana", "Mês" ou "Dia" — a palavra do período no idioma da locadora. */
export function periodWord(frequency: RentalBillingFrequency | null | undefined): string {
  if (frequency === 'WEEKLY') return 'Semana';
  if (frequency === 'MONTHLY') return 'Mês';
  if (frequency === 'DAILY') return 'Dia';
  return 'Período';
}

export function periodWordPlural(frequency: RentalBillingFrequency | null | undefined): string {
  if (frequency === 'WEEKLY') return 'semanas';
  if (frequency === 'MONTHLY') return 'meses';
  if (frequency === 'DAILY') return 'dias';
  return 'períodos';
}

type LabelSource = Pick<
  RentalChargeDto,
  'kind' | 'periodIndex' | 'instalmentIndex' | 'instalmentCount' | 'agreementSeq'
>;

/** A cobrança é uma parte de algo maior (parcela de período, parte de caução ou de acordo)? */
export function isSplitCharge(c: LabelSource): boolean {
  return (c.instalmentCount ?? 1) > 1 || c.kind === 'AGREEMENT';
}

/** "Acordo" ou "Acordo 2": o número só aparece a partir do segundo acordo do aluguel. */
export function agreementName(seq: number | null | undefined): string {
  return seq && seq > 1 ? `Acordo ${seq}` : 'Acordo';
}

/**
 * Rótulo FEAT-0573 da linha, ou `null` quando a cobrança é inteira (1 de 1, sem acordo) — o
 * chamador então usa o rótulo de sempre, e a tela sem plano fica exatamente como hoje.
 */
export function flexChargeLabel(
  c: LabelSource,
  frequency: RentalBillingFrequency | null | undefined,
): string | null {
  const count = c.instalmentCount ?? 1;
  const index = c.instalmentIndex ?? 1;
  if (c.kind === 'AGREEMENT') {
    return `${agreementName(c.agreementSeq)}, parcela ${index} de ${count}`;
  }
  if (count <= 1) return null;
  if (c.kind === 'CAUCAO') return `Caução, parte ${index} de ${count}`;
  if (c.kind === 'RENTAL_PERIOD' && c.periodIndex != null) {
    return `${periodWord(frequency)} ${c.periodIndex + 1}, parcela ${index} de ${count}`;
  }
  return `Parcela ${index} de ${count}`;
}

/** Fontes aceitas num acordo (G7). */
const RENEGOTIABLE_KINDS: ReadonlySet<string> = new Set([
  'RENTAL_PERIOD',
  'RENTAL_TOTAL',
  'CAUCAO',
  'AGREEMENT',
]);

export function isRenegotiableCharge(c: Pick<RentalChargeDto, 'kind' | 'status'>): boolean {
  return RENEGOTIABLE_KINDS.has(c.kind) && isOpenChargeStatus(c.status);
}

/** Tipos aceitos em "Recebida por fora" (B6). */
export function isReceivableOutsideCharge(c: Pick<RentalChargeDto, 'kind' | 'status'>): boolean {
  return RENEGOTIABLE_KINDS.has(c.kind) && isOpenChargeStatus(c.status);
}

/** Soma do que saiu de cobrança por acordo — o cartão "Renegociado". */
export function renegotiatedTotalCents(charges: readonly Pick<RentalChargeDto, 'status' | 'amount'>[]): number {
  return charges
    .filter((c) => c.status === ('RENEGOTIATED' satisfies ChargeStatus))
    .reduce((acc, c) => acc + c.amount, 0);
}

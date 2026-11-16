import {
  ChargePlanDto,
  ChargePlanInstalment,
  ChargePlanOverride,
  RentalBillingFrequency,
} from '../../../types/rental.types';
import {
  IntervalUnit,
  MIN_GATEWAY_CENTS,
  addDaysIso,
  discountFor,
  intervalToDays,
  isIsoDay,
  splitEvenly,
} from '../charges-flex/charges-flex';

/**
 * Novo aluguel passo a passo: a conta PURA (sem Angular, sem IO).
 *
 * Espelha o backend (`RentalPeriodPlanner` e `ChargePlanExpander`): fim exclusivo, período de
 * 1/7/30 dias, o período k vence na 1ª cobrança + k períodos, desconto nos primeiros, parcelas
 * com os centavos na última e mês = 30 dias. Serve ao resumo ao vivo de cada passo; no Confira
 * quem manda é a prévia do servidor (`charge-preview`).
 */

export const STEP_DAYS: Readonly<Record<RentalBillingFrequency, number>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
};

/** Limites do contrato B2 (o backend recusa fora deles). */
export const SPLIT_COUNT_MIN = 2;
export const SPLIT_COUNT_MAX = 12;
export const INTERVAL_MAX: Readonly<Record<IntervalUnit, number>> = { DAYS: 31, WEEKS: 4, MONTHS: 12 };
export const OFFSET_MAX_DAYS = 31;
export const CAUCAO_PARTS_MAX = 24;
/** Juros de mora: o dono decidiu o teto de 11% ao mês. */
export const INTEREST_MAX_PERCENT = 11;

/** Dias cobrados com fim exclusivo; piso de 1 (`billableDays` do backend). 0 = datas incoerentes. */
export function billableDays(start: string | null, end: string | null): number {
  if (!isIsoDay(start) || !isIsoDay(end) || end < start) return 0;
  const diff = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return Math.max(1, diff);
}

export function periodCount(start: string | null, end: string | null, freq: RentalBillingFrequency): number {
  const days = billableDays(start, end);
  return days === 0 ? 0 : Math.max(1, Math.ceil(days / STEP_DAYS[freq]));
}

/** Vencimento do período `index` (0-based): a 1ª cobrança + `index` períodos. */
export function periodDue(firstDue: string, index: number, freq: RentalBillingFrequency): string {
  return addDaysIso(firstDue, index * STEP_DAYS[freq]);
}

export interface WizardDiscount {
  type: 'AMOUNT' | 'PERCENT';
  /** AMOUNT: centavos; PERCENT: basis points. */
  value: number;
  firstPeriods: number;
}

export interface WizardSplit {
  count: number;
  intervalN: number;
  unit: IntervalUnit;
  /** Dias entre o vencimento do período e a 1ª parcela (0 = no mesmo dia). */
  offsetDays: number;
  scope: 'ALL' | 'SOME';
  /** Índices 0-based dos períodos escolhidos em "Só algumas". */
  selected: readonly number[];
}

export interface WizardInput {
  frequency: RentalBillingFrequency;
  startDate: string;
  periods: number;
  firstDue: string;
  rateCents: number;
  /** Hoje, no fuso do negócio: período vencido fica só registrado e nunca é parcelado. */
  today: string;
  discount: WizardDiscount | null;
  split: WizardSplit | null;
  caucaoCents: number;
  caucaoPaid: boolean;
  /** Partes da caução (≥ 2) ou `null` = inteira. */
  caucaoParts: readonly ChargePlanInstalment[] | null;
}

export interface WizardCharge {
  kind: 'RENTAL_PERIOD' | 'CAUCAO';
  /** Período 0-based (caução = 0). */
  index: number;
  dueDate: string;
  amountCents: number;
  instalmentIndex: number;
  instalmentCount: number;
}

/** Valor de cada período depois do desconto. */
export function periodAmounts(input: Pick<WizardInput, 'periods' | 'rateCents' | 'discount'>): number[] {
  const d = input.discount;
  return Array.from({ length: input.periods }, (_, i) =>
    d && i < d.firstPeriods ? input.rateCents - discountFor(input.rateCents, d.type, d.value) : input.rateCents,
  );
}

/** A caução vence em max(início, 1ª cobrança) — mesma regra do `RentalChargePlanner`. */
export function caucaoDue(startDate: string, firstDue: string): string {
  return firstDue > startDate ? firstDue : startDate;
}

/** Os períodos que recebem parcelas (os já vencidos nunca: o backend os registra inteiros). */
export function splitIndices(input: Pick<WizardInput, 'periods' | 'firstDue' | 'frequency' | 'today' | 'split'>): number[] {
  const s = input.split;
  if (!s || s.count < SPLIT_COUNT_MIN) return [];
  const all = Array.from({ length: input.periods }, (_, i) => i);
  const chosen = s.scope === 'ALL' ? all : all.filter((i) => s.selected.includes(i));
  return chosen.filter((i) => periodDue(input.firstDue, i, input.frequency) >= input.today);
}

export function splitStepDays(split: WizardSplit): number {
  return intervalToDays(split.intervalN, split.unit);
}

/** Parcelas de um período: centavos que sobram na última; 1ª em vencimento + deslocamento. */
export function periodInstalments(due: string, amountCents: number, split: WizardSplit): ChargePlanInstalment[] {
  const step = splitStepDays(split);
  const first = addDaysIso(due, split.offsetDays);
  return splitEvenly(amountCents, split.count).map((amount, i) => ({
    dueDate: addDaysIso(first, i * step),
    amountCents: amount,
  }));
}

/**
 * Todas as cobranças, na ordem do vencimento (empate: caução antes, depois período e parcela).
 * É a conta do resumo; a lista do Confira vem da prévia do servidor.
 */
export function localCharges(input: WizardInput): WizardCharge[] {
  const amounts = periodAmounts(input);
  const split = splitIndices(input);
  const out: WizardCharge[] = [];
  amounts.forEach((amount, i) => {
    const due = periodDue(input.firstDue, i, input.frequency);
    if (input.split && split.includes(i)) {
      const list = periodInstalments(due, amount, input.split);
      list.forEach((p, k) =>
        out.push({ kind: 'RENTAL_PERIOD', index: i, dueDate: p.dueDate, amountCents: p.amountCents, instalmentIndex: k + 1, instalmentCount: list.length }),
      );
    } else {
      out.push({ kind: 'RENTAL_PERIOD', index: i, dueDate: due, amountCents: amount, instalmentIndex: 1, instalmentCount: 1 });
    }
  });
  if (input.caucaoCents > 0 && !input.caucaoPaid) {
    const parts = input.caucaoParts && input.caucaoParts.length >= 2 ? input.caucaoParts : null;
    if (parts) {
      parts.forEach((p, k) =>
        out.push({ kind: 'CAUCAO', index: 0, dueDate: p.dueDate, amountCents: p.amountCents, instalmentIndex: k + 1, instalmentCount: parts.length }),
      );
    } else {
      out.push({ kind: 'CAUCAO', index: 0, dueDate: caucaoDue(input.startDate, input.firstDue), amountCents: input.caucaoCents, instalmentIndex: 1, instalmentCount: 1 });
    }
  }
  return out.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      (a.kind === b.kind ? 0 : a.kind === 'CAUCAO' ? -1 : 1) ||
      a.index - b.index ||
      a.instalmentIndex - b.instalmentIndex,
  );
}

export interface WizardTotals {
  rentCents: number;
  caucaoCents: number;
  totalCents: number;
  count: number;
}

export function totalsOf(charges: readonly { kind: string; amountCents: number }[]): WizardTotals {
  let rent = 0;
  let caucao = 0;
  for (const c of charges) {
    if (c.kind === 'CAUCAO') caucao += c.amountCents;
    else rent += c.amountCents;
  }
  return { rentCents: rent, caucaoCents: caucao, totalCents: rent + caucao, count: charges.length };
}

/**
 * O `chargePlan` do corpo — o mesmo formato do editor de hoje (contrato B2 + `intervalUnit`).
 *
 * - "Todas", 1ª parcela no vencimento: `defaultSplit` (o servidor parcela cada período).
 * - "Só algumas", ou 1ª parcela deslocada: um `PERIOD` por período, com as parcelas prontas.
 * - Caução em partes: um `CAUCAO`.
 *
 * `null` = valor cheio: a chave `chargePlan` nem vai no corpo.
 */
export function buildWizardPlan(input: WizardInput): ChargePlanDto | null {
  const discount = input.discount && input.discount.value > 0 && input.discount.firstPeriods >= 1 ? input.discount : null;
  const split = input.split && input.split.count >= SPLIT_COUNT_MIN ? input.split : null;
  const useDefault = !!split && split.scope === 'ALL' && split.offsetDays === 0;
  const overrides: ChargePlanOverride[] = [];
  if (input.caucaoCents > 0 && !input.caucaoPaid && input.caucaoParts && input.caucaoParts.length >= 2) {
    overrides.push({ target: 'CAUCAO', periodIndex: null, instalments: input.caucaoParts.map((p) => ({ ...p })) });
  }
  if (split && !useDefault) {
    const amounts = periodAmounts({ ...input, discount });
    for (const i of splitIndices(input)) {
      overrides.push({
        target: 'PERIOD',
        periodIndex: i,
        instalments: periodInstalments(periodDue(input.firstDue, i, input.frequency), amounts[i], split),
      });
    }
  }
  const defaultSplit = useDefault && split ? { count: split.count, intervalDays: split.intervalN, intervalUnit: split.unit } : null;
  if (!discount && !defaultSplit && overrides.length === 0) return null;
  return {
    discount: discount ? { type: discount.type, value: discount.value, firstPeriods: discount.firstPeriods } : null,
    defaultSplit,
    overrides: overrides.length > 0 ? overrides : null,
  };
}

/** Mínimo por cobrança: R$ 5,00 quando vai por Pix, 1 centavo quando é só anotada. */
export function minChargeCents(automatic: boolean): number {
  return automatic ? MIN_GATEWAY_CENTS : 1;
}

/** Menor parcela que o plano gera (para o aviso de mínimo); `null` sem parcelas. */
export function smallestInstalment(input: WizardInput): number | null {
  if (!input.split) return null;
  const amounts = periodAmounts(input);
  const idx = splitIndices(input);
  if (idx.length === 0) return null;
  return Math.min(...idx.map((i) => Math.floor(amounts[i] / input.split!.count)));
}

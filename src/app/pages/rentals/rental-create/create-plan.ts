import {
  ChargePlanDto,
  ChargePlanInstalment,
  ChargePlanOverride,
  RentalBillingFrequency,
} from '../../../types/rental.types';
import { addDaysIso, splitEvenly } from '../charges-flex/charges-flex';
import { STEP_DAYS, WizardCharge, caucaoDue, periodDue } from '../rental-wizard/wizard-math';

/**
 * A conta PURA dos cards 3 (Caução) e 4 (Cobranças) e o `chargePlan` que vai no corpo.
 *
 * Espelha o backend (`ChargePlanExpander`, origin/develop): desconto em valor nos N primeiros
 * períodos, nunca na caução; `defaultSplit` divide cada período que vai ao gateway com
 * `floor(A/n)` e o resto na última, a parcela i em vencimento + i × passo; `overrides` levam as
 * parcelas prontas (2 a 24, soma exata, datas em ordem e de hoje em diante); período vencido
 * nunca é parcelado.
 *
 * O desconto da caução é só da tela (decisão do dono, 20/11): o corpo leva a caução líquida.
 */

/** Partes de cada período: o contrato do `defaultSplit` (2 a 12). */
export const PERIOD_PARTS_MIN = 2;
export const PERIOD_PARTS_MAX = 12;
/** O `defaultSplit` em dias aceita intervalo de 1 a 31 (`INTERVAL_DAYS_MAX`). */
export const DEFAULT_SPLIT_INTERVAL_MAX = 31;

/** Uma parte do período: o valor (sobre o valor cheio) e quantos dias depois do vencimento. */
export interface PeriodPart {
  amountCents: number;
  offsetDays: number;
}

export interface CreatePlanInput {
  frequency: RentalBillingFrequency;
  startDate: string;
  periods: number;
  firstDue: string;
  rateCents: number;
  /** Hoje, no fuso do negócio: período vencido fica inteiro. */
  today: string;
  /** Desconto em valor (centavos) nos `firstPeriods` primeiros. */
  discount: { valueCents: number; firstPeriods: number } | null;
  split: { scope: 'ALL' | 'SOME'; selected: readonly number[]; parts: readonly PeriodPart[] } | null;
  /** Caução LÍQUIDA (já com o desconto da tela). */
  caucaoCents: number;
  caucaoPaid: boolean;
  /** Partes da caução (≥ 2) ou `null` = inteira. */
  caucaoParts: readonly ChargePlanInstalment[] | null;
}

// ------------------------------------------------------------------ as três caixas
export interface ChecksState {
  descOn: boolean;
  splitOn: boolean;
}

/**
 * "Valor cheio" exclui as outras duas; "Dar desconto" e "Parcelar" vão juntas; sem nenhuma
 * das duas, volta o "Valor cheio" (que é só a ausência das duas).
 */
export function toggleCheck(state: ChecksState, which: 'full' | 'desc' | 'split'): ChecksState {
  if (which === 'full') return { descOn: false, splitOn: false };
  if (which === 'desc') return { ...state, descOn: !state.descOn };
  return { ...state, splitOn: !state.splitOn };
}

export function isFullValue(state: ChecksState): boolean {
  return !state.descOn && !state.splitOn;
}

// ------------------------------------------------------------------ caução
/** A caução que é cobrada: com "Recebi por fora", o valor cheio anotado; senão, menos o desconto. */
export function caucaoNet(grossCents: number, discountOn: boolean, discountCents: number, paid: boolean): number {
  if (paid || !discountOn) return grossCents;
  return Math.max(0, grossCents - Math.max(0, discountCents));
}

// ------------------------------------------------------------------ períodos
/** Valor de cada período depois do desconto. */
export function createPeriodAmounts(input: Pick<CreatePlanInput, 'periods' | 'rateCents' | 'discount'>): number[] {
  const d = input.discount;
  return Array.from({ length: input.periods }, (_, i) =>
    d && i < d.firstPeriods ? input.rateCents - Math.min(input.rateCents, d.valueCents) : input.rateCents,
  );
}

/** Os períodos que recebem partes: os escolhidos (ou todos) que ainda não venceram. */
export function splitPeriodIndices(
  input: Pick<CreatePlanInput, 'periods' | 'firstDue' | 'frequency' | 'today' | 'split'>,
): number[] {
  const s = input.split;
  if (!s || s.parts.length < PERIOD_PARTS_MIN) return [];
  const all = Array.from({ length: input.periods }, (_, i) => i);
  const chosen = s.scope === 'ALL' ? all : all.filter((i) => s.selected.includes(i));
  return chosen.filter((i) => periodDue(input.firstDue, i, input.frequency) >= input.today);
}

/**
 * O `defaultSplit` quando ele diz exatamente as partes: todas as semanas, valores iguais (a
 * divisão do servidor), a 1ª no dia do vencimento e o mesmo intervalo (1 a 31 dias) entre elas.
 * `null` = as partes vão como `overrides`.
 */
export function defaultSplitFor(
  parts: readonly PeriodPart[],
  rateCents: number,
  scope: 'ALL' | 'SOME',
): { count: number; intervalDays: number; intervalUnit: 'DAYS' } | null {
  const n = parts.length;
  if (scope !== 'ALL' || n < PERIOD_PARTS_MIN || n > PERIOD_PARTS_MAX) return null;
  const even = splitEvenly(rateCents, n);
  if (parts.some((p, i) => p.amountCents !== even[i])) return null;
  if (parts[0].offsetDays !== 0) return null;
  const step = parts[1].offsetDays - parts[0].offsetDays;
  if (step < 1 || step > DEFAULT_SPLIT_INTERVAL_MAX) return null;
  for (let i = 1; i < n; i++) if (parts[i].offsetDays - parts[i - 1].offsetDays !== step) return null;
  return { count: n, intervalDays: step, intervalUnit: 'DAYS' };
}

/**
 * N1 (23/11) — as partes são digitadas sobre o valor do 1º período parcelado (com desconto, se
 * ele tem); um período de OUTRO valor (o sem desconto) recebe as partes na mesma proporção
 * (centavos que sobram na última), que é a divisão do servidor quando as partes são iguais. A
 * tela mostra esse outro valor por extenso: nada é refeito em silêncio.
 */
export function partsTotal(parts: readonly PeriodPart[]): number {
  return parts.reduce((a, p) => a + p.amountCents, 0);
}

/** O valor sobre o qual as partes são digitadas: o do 1º período parcelado (com o desconto dele). */
export function partsTargetCents(input: CreatePlanInput): number {
  const first = splitPeriodIndices(input)[0];
  if (first === undefined) return input.rateCents;
  return createPeriodAmounts(input)[first];
}

export function scaleParts(parts: readonly PeriodPart[], rateCents: number, amountCents: number): number[] {
  if (amountCents === rateCents || rateCents <= 0) return parts.map((p) => p.amountCents);
  const head = parts.slice(0, -1).map((p) => Math.floor((p.amountCents * amountCents) / rateCents));
  return [...head, amountCents - head.reduce((a, b) => a + b, 0)];
}

/** Parcelas de um período: `defaultSplit` → a divisão do servidor; senão, as partes digitadas. */
function periodInstalments(input: CreatePlanInput, index: number, amountCents: number): ChargePlanInstalment[] {
  const split = input.split;
  if (!split) return [];
  const due = periodDue(input.firstDue, index, input.frequency);
  const base = partsTotal(split.parts);
  const def = defaultSplitFor(split.parts, base, split.scope);
  if (def) {
    return splitEvenly(amountCents, def.count).map((amount, i) => ({
      dueDate: addDaysIso(due, i * def.intervalDays),
      amountCents: amount,
    }));
  }
  const amounts = scaleParts(split.parts, base, amountCents);
  return split.parts.map((p, i) => ({ dueDate: addDaysIso(due, p.offsetDays), amountCents: amounts[i] }));
}

/**
 * O `chargePlan` do corpo. `null` = valor cheio, caução inteira: a chave nem vai no corpo.
 * - desconto: sempre em valor (`AMOUNT`);
 * - partes do período: `defaultSplit` quando ele as diz, senão um `PERIOD` por período;
 * - caução em partes: um `CAUCAO`.
 */
export function buildCreatePlan(input: CreatePlanInput): ChargePlanDto | null {
  const d = input.discount;
  const discount =
    d && d.valueCents > 0 && d.firstPeriods >= 1
      ? { type: 'AMOUNT' as const, value: d.valueCents, firstPeriods: Math.min(d.firstPeriods, input.periods) }
      : null;
  const overrides: ChargePlanOverride[] = [];
  if (input.caucaoCents > 0 && !input.caucaoPaid && input.caucaoParts && input.caucaoParts.length >= 2) {
    overrides.push({ target: 'CAUCAO', periodIndex: null, instalments: input.caucaoParts.map((p) => ({ ...p })) });
  }
  const split = input.split && input.split.parts.length >= PERIOD_PARTS_MIN ? input.split : null;
  const def = split ? defaultSplitFor(split.parts, partsTotal(split.parts), split.scope) : null;
  if (split && !def) {
    const amounts = createPeriodAmounts(input);
    for (const i of splitPeriodIndices(input)) {
      overrides.push({ target: 'PERIOD', periodIndex: i, instalments: periodInstalments(input, i, amounts[i]) });
    }
  }
  if (!discount && !def && overrides.length === 0) return null;
  return { discount, defaultSplit: def, overrides: overrides.length > 0 ? overrides : null };
}

/** Todas as cobranças, na ordem do vencimento (a caução antes no empate) — a prévia na hora. */
export function createCharges(input: CreatePlanInput): WizardCharge[] {
  const amounts = createPeriodAmounts(input);
  const split = new Set(splitPeriodIndices(input));
  const out: WizardCharge[] = [];
  amounts.forEach((amount, i) => {
    if (split.has(i)) {
      const list = periodInstalments(input, i, amount);
      list.forEach((p, k) =>
        out.push({ kind: 'RENTAL_PERIOD', index: i, dueDate: p.dueDate, amountCents: p.amountCents, instalmentIndex: k + 1, instalmentCount: list.length }),
      );
    } else {
      const due = periodDue(input.firstDue, i, input.frequency);
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

/** Último dia coberto pelo período `index` (fim exclusivo): "Semana 1 · até 30/11". */
export function periodLastDay(startDate: string, endDate: string, index: number, freq: RentalBillingFrequency): string {
  const next = addDaysIso(startDate, (index + 1) * STEP_DAYS[freq]);
  const stop = next < endDate ? next : endDate;
  return addDaysIso(stop, -1);
}

/** Até quantos dias depois do vencimento uma parte pode vencer (dentro do período; por dia, uma semana). */
export function partOffsetMax(freq: RentalBillingFrequency): number {
  return freq === 'MONTHLY' ? 29 : 6;
}

import { RentalBillingFrequency } from '../../../types/rental.types';
import { isDay, weekdayIndex } from '../../../components/calendar-field/calendar-math';
import { ptBrMoneyCents } from '../../../utils/validators/ptbr-money.validator';
import { periodCount } from '../rental-wizard/wizard-math';
import {
  PeriodWords,
  brl,
  dShort,
  intOf,
  listPeriods,
  periodWords,
  plural,
  weekdayLong,
} from '../rental-wizard/wizard-format';
import { caucaoNet, partOffsetMax } from './create-plan';

/**
 * Regras dos cards 1 e 2 do Novo aluguel, as mesmas do passo a passo (`rental-wizard.ts`,
 * passos "Motorista e carro" e "Quando"), em funções puras: a página, a barra de etapas e os
 * specs leem a mesma resposta.
 */

export interface DriverVehicleValue {
  driverId: string;
  vehicleId: string;
}

export interface PeriodValue {
  startDate: string;
  pickupTime: string;
  pickupOtherDay: boolean;
  pickupDay: string;
  endDate: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function driverVehicleErrors(v: DriverVehicleValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.driverId) e['driverId'] = 'Escolha quem vai levar o carro.';
  if (!v.vehicleId) e['vehicleId'] = 'Escolha o carro.';
  return e;
}

export function periodErrors(v: PeriodValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.startDate) e['startDate'] = 'Escolha o dia em que ele pega o carro.';
  if (!TIME.test(v.pickupTime ?? '')) e['pickupTime'] = 'Hora inválida. Use horas:minutos, por exemplo 09:00.';
  if (!v.endDate) e['endDate'] = 'Escolha o dia da devolução.';
  else if (v.startDate && v.endDate <= v.startDate) e['endDate'] = 'A devolução precisa ser depois da retirada.';
  if (v.pickupOtherDay) {
    const d = v.pickupDay ?? '';
    if (!d) e['pickupDay'] = 'Escolha o dia da retirada.';
    else if (v.startDate && v.endDate && (d < v.startDate || d > v.endDate)) {
      e['pickupDay'] = `A retirada precisa ser entre ${dShort(v.startDate)} e ${dShort(v.endDate)}.`;
    }
  }
  return e;
}

/** "na" + "terça, 24/11" / "no" + "sábado, 28/11" (o rodapé do calendário põe o dia em negrito). */
export function onWeekday(iso: string): { article: 'na' | 'no'; day: string } | null {
  const day = weekdayLong(iso);
  if (!day) return null;
  return { article: day === 'sábado' || day === 'domingo' ? 'no' : 'na', day: `${day}, ${dShort(iso)}` };
}

export interface PeriodSentence {
  /** "24/11 a 22/12" */
  range: string;
  /** "terça, 22/12" */
  endLong: string;
  /** "4 semanas" */
  length: string;
}

/** As partes de "De 24/11 a 22/12. São 4 semanas." — `null` sem um período válido. */
export function periodSentence(
  start: string,
  end: string,
  freq: RentalBillingFrequency,
): PeriodSentence | null {
  if (!start || !end || end <= start) return null;
  const n = periodCount(start, end, freq);
  if (!n) return null;
  const w = periodWords(freq);
  return {
    range: `${dShort(start)} a ${dShort(end)}`,
    endLong: `${weekdayLong(end)}, ${dShort(end)}`,
    length: plural(n, w.lower, w.lowerMany),
  };
}

// ================================================================== card 3 · Caução
export interface CaucaoRulesValue {
  caucaoReais: string;
  caucaoPaid: boolean;
  caucaoDescOn: boolean;
  caucaoDiscount: string;
  caucaoSplit: boolean;
  parts: ReadonlyArray<{ amount: string; due: string }>;
}

/** Valores da caução: bruto, desconto e líquido (o que é cobrado). */
export function caucaoAmounts(v: CaucaoRulesValue): { gross: number; discount: number; net: number } {
  const gross = ptBrMoneyCents(v.caucaoReais) ?? 0;
  const discount = v.caucaoDescOn && !v.caucaoPaid ? (ptBrMoneyCents(v.caucaoDiscount) ?? 0) : 0;
  return { gross, discount, net: caucaoNet(gross, v.caucaoDescOn, discount, v.caucaoPaid) };
}

export function caucaoErrors(v: CaucaoRulesValue, ctx: { today: string; minCents: number }): Record<string, string> {
  const e: Record<string, string> = {};
  if ((v.caucaoReais ?? '').trim() !== '' && ptBrMoneyCents(v.caucaoReais) === null) {
    e['caucaoReais'] = 'Digite um valor válido, por exemplo 1.500,00. Ou deixe 0 se não cobra.';
  }
  if (v.caucaoPaid) return e;
  const { gross, net } = caucaoAmounts(v);
  if (v.caucaoDescOn) {
    const d = ptBrMoneyCents(v.caucaoDiscount);
    if (gross <= 0) e['caucaoDiscount'] = 'Digite o valor da caução antes do desconto.';
    else if (d === null || d <= 0 || d >= gross) {
      e['caucaoDiscount'] = `O desconto precisa ser maior que zero e menor que ${brl(gross)}, o valor da caução.`;
    }
  }
  // A cobrança da caução (inteira) respeita o mínimo do servidor: R$ 5,00 por Pix, 1 centavo
  // só anotada (`minChargeCents`). Partes são conferidas uma a uma, abaixo.
  if (!v.caucaoSplit && net > 0 && net < ctx.minCents) {
    if (v.caucaoDescOn && !e['caucaoDiscount']) {
      e['caucaoDiscount'] = `Com esse desconto a caução ficaria abaixo de ${brl(ctx.minCents)}.`;
    } else if (!e['caucaoReais']) {
      e['caucaoReais'] = `A caução precisa ser de pelo menos ${brl(ctx.minCents)}. Ou 0 se não cobra.`;
    }
  }
  if (v.caucaoSplit) {
    if (net <= 0) {
      e['caucaoPartsSum'] = 'Digite o valor da caução antes de parcelar.';
      return e;
    }
    let sum = 0;
    v.parts.forEach((p, i) => {
      const a = ptBrMoneyCents(p.amount);
      sum += a ?? 0;
      if (a === null || a <= 0) e[`cauPart${i}`] = 'Digite o valor desta parte.';
      else if (a < ctx.minCents) e[`cauPart${i}`] = `Cada parte precisa ser de pelo menos ${brl(ctx.minCents)}.`;
      const due = p.due ?? '';
      const prev = i > 0 ? (v.parts[i - 1].due ?? '') : '';
      if (!due) e[`cauDue${i}`] = 'Escolha a data.';
      else if (due < ctx.today) e[`cauDue${i}`] = 'A data precisa ser de hoje em diante.';
      else if (prev && due < prev) e[`cauDue${i}`] = 'Precisa vencer no mesmo dia ou depois da parte anterior.';
    });
    if (sum !== net) e['caucaoPartsSum'] = `As partes somam ${brl(sum)}. Precisam somar ${brl(net)}, a caução.`;
  }
  return e;
}

// ================================================================== card 4 · Cobranças
export interface ChargesRulesValue {
  periodRateReais: string;
  descOn: boolean;
  discountN: string;
  discountValue: string;
  parcOn: boolean;
  splitScope: 'ALL' | 'SOME';
  parts: ReadonlyArray<{ amount: string; offset: number }>;
}

export interface ChargesRulesContext {
  words: PeriodWords;
  periods: number;
  minCents: number;
  /** Escolha de "Só algumas" que vale (na frequência de agora). */
  selected: readonly number[];
  /** Escolhas que deixaram de existir (o fim ou a frequência mudou). */
  stale: readonly number[];
  /** Escolhas já vencidas. */
  past: readonly number[];
  /** Menor parte que o plano gera (`null` sem partes). */
  smallestPart: number | null;
}

export function chargesErrors(v: ChargesRulesValue, ctx: ChargesRulesContext): Record<string, string> {
  const e: Record<string, string> = {};
  const w = ctx.words;
  const rate = ptBrMoneyCents(v.periodRateReais) ?? 0;
  const of = `d${w.fem ? 'a' : 'o'} ${w.lower}`;
  if (rate <= 0) e['periodRateReais'] = `Digite quanto ele paga ${w.per.toLowerCase()}, por exemplo 600,00.`;
  else if (rate < ctx.minCents) e['periodRateReais'] = `Cada cobrança precisa ser de pelo menos ${brl(ctx.minCents)}.`;
  if (v.descOn) {
    const n = intOf(v.discountN);
    if (ctx.periods <= 0) e['discountN'] = 'Escolha as datas no card Período.';
    else if (!n || n < 1 || n > ctx.periods) e['discountN'] = `Escolha de 1 a ${ctx.periods}.`;
    const c = ptBrMoneyCents(v.discountValue);
    if (c === null || c <= 0 || (rate > 0 && c >= rate)) {
      e['discountValue'] =
        rate > 0
          ? `O desconto precisa ser maior que zero e menor que ${brl(rate)}, o valor ${of}.`
          : 'Digite o desconto, por exemplo 100,00.';
    } else if (rate - c < ctx.minCents) {
      e['discountValue'] = `Com esse desconto a cobrança ficaria abaixo de ${brl(ctx.minCents)}.`;
    }
  }
  if (v.parcOn) {
    let sum = 0;
    v.parts.forEach((p, i) => {
      const a = ptBrMoneyCents(p.amount);
      sum += a ?? 0;
      if (a === null || a <= 0) e[`perPart${i}`] = 'Digite o valor desta parte.';
      if (i > 0 && p.offset < v.parts[i - 1].offset) {
        e[`perDue${i}`] = 'Precisa vencer no mesmo dia ou depois da parte anterior.';
      }
    });
    if (rate > 0 && sum !== rate) {
      e['periodPartsSum'] = `As partes somam ${brl(sum)}. Precisam somar ${brl(rate)}, o valor ${of}.`;
    } else if (ctx.smallestPart !== null && ctx.smallestPart < ctx.minCents) {
      e['periodPartsSum'] = `Cada parte precisa ser de pelo menos ${brl(ctx.minCents)}. A menor ficou com ${brl(ctx.smallestPart)}.`;
    }
    if (v.splitScope === 'SOME') {
      if (ctx.stale.length) {
        e['splitSel'] = `${listPeriods(ctx.stale, w)} não ${ctx.stale.length === 1 ? 'existe' : 'existem'} mais: as datas ou a frequência mudaram. Escolha de novo.`;
      } else if (ctx.selected.length === 0) {
        e['splitSel'] = `Escolha pelo menos ${w.fem ? 'uma' : 'um'} ${w.lower}.`;
      } else if (ctx.past.length) {
        const one = ctx.past.length === 1;
        const ending = w.fem ? (one ? 'a' : 'as') : one ? 'o' : 'os';
        e['splitSel'] = `${listPeriods(ctx.past, w)} já ${one ? 'venceu e não pode' : 'venceram e não podem'} ser parcelad${ending}. Tire da escolha.`;
      }
    }
  }
  return e;
}

/** "Vence toda terça, a partir de 24/11. São 4 semanas." */
export function rateHint(freq: RentalBillingFrequency, firstDue: string, periods: number): string {
  const w = periodWords(freq);
  const len = periods ? ` São ${plural(periods, w.lower, w.lowerMany)}.` : '';
  if (!firstDue) return `Vence no dia da retirada.${len}`;
  if (freq === 'WEEKLY') return `Vence toda ${weekdayLong(firstDue)}, a partir de ${dShort(firstDue)}.${len}`;
  if (freq === 'MONTHLY') return `Vence a cada 30 dias, a partir de ${dShort(firstDue)}.${len}`;
  return `Vence todo dia, a partir de ${dShort(firstDue)}.${len}`;
}

/** "As 2 primeiras saem por R$ 500,00. As outras, R$ 600,00." */
export function discountHint(
  freq: RentalBillingFrequency,
  n: number,
  periods: number,
  rate: number,
  discount: number,
): string {
  const w = periodWords(freq);
  const low = brl(rate - discount);
  if (periods > 0 && n >= periods) return `${w.fem ? 'Todas' : 'Todos'} saem por ${low}.`;
  const lead =
    n === 1
      ? `${w.fem ? 'A primeira' : 'O primeiro'} sai por ${low}.`
      : `${w.fem ? 'As' : 'Os'} ${n} ${w.fem ? 'primeiras' : 'primeiros'} saem por ${low}.`;
  return `${lead} ${w.fem ? 'As outras' : 'Os outros'}, ${brl(rate)}.`;
}

/** Opções de "Em quantas": "1ª", "2 primeiras", … (masculino para dia e mês). */
export function firstNOptions(freq: RentalBillingFrequency, periods: number): Array<{ value: string; label: string }> {
  const fem = periodWords(freq).fem;
  return Array.from({ length: Math.max(1, periods) }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? (fem ? '1ª' : '1º') : `${i + 1} ${fem ? 'primeiras' : 'primeiros'}`,
  }));
}

const WEEKDAY_TITLES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * Opções de "Vence na" de uma parte: por semana, o dia da semana (a partir do dia do
 * vencimento); por dia e por mês, quantos dias depois do vencimento.
 */
export function partDueOptions(freq: RentalBillingFrequency, firstDue: string): Array<{ value: number; label: string }> {
  const max = partOffsetMax(freq);
  const base = isDay(firstDue) ? weekdayIndex(firstDue) : -1;
  return Array.from({ length: max + 1 }, (_, d) => ({
    value: d,
    label:
      freq === 'WEEKLY' && base >= 0
        ? WEEKDAY_TITLES[(base + d) % 7]
        : d === 0
          ? 'No vencimento'
          : `${d} ${d === 1 ? 'dia' : 'dias'} depois`,
  }));
}

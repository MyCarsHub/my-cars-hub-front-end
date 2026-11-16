import { RentalBillingFrequency } from '../../../types/rental.types';
import { brDate, brDayMonth, brl, isIsoDay } from '../charges-flex/charges-flex';

/** Texto do passo a passo: datas e valores como o protótipo escreve. */

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function weekdayIndex(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** "seg, 16/11/2026". */
export function dLong(iso: string | null | undefined): string {
  if (!isIsoDay(iso)) return '—';
  return `${WEEKDAYS[weekdayIndex(iso)]}, ${brDate(iso)}`;
}

/** "segunda". */
export function weekdayLong(iso: string): string {
  return isIsoDay(iso) ? WEEKDAYS_LONG[weekdayIndex(iso)] : '';
}

export { brDayMonth as dShort, brl };

/** "R$ 750" quando redondo, senão "R$ 750,50". */
export function brlShort(cents: number): string {
  return cents % 100 === 0 ? `R$ ${(cents / 100).toLocaleString('pt-BR')}` : brl(cents);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Semana", "Dia", "Mês" e os plurais, com o gênero de cada um. */
export interface PeriodWords {
  one: string;
  many: string;
  /** "semana" / "dia" / "mês" no meio da frase. */
  lower: string;
  lowerMany: string;
  /** "Por semana". */
  per: string;
  /** feminino? (concordância de "primeira/primeiro"). */
  fem: boolean;
}

export function periodWords(freq: RentalBillingFrequency): PeriodWords {
  if (freq === 'DAILY') return { one: 'Dia', many: 'Dias', lower: 'dia', lowerMany: 'dias', per: 'Por dia', fem: false };
  if (freq === 'MONTHLY') return { one: 'Mês', many: 'Meses', lower: 'mês', lowerMany: 'meses', per: 'Por mês', fem: false };
  return { one: 'Semana', many: 'Semanas', lower: 'semana', lowerMany: 'semanas', per: 'Por semana', fem: true };
}

/** "Semana 1, Semana 2 e Semana 3" → "As semanas 1, 2 e 3". */
export function listPeriods(indices: readonly number[], w: PeriodWords): string {
  const n = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  if (n.length === 0) return '';
  if (n.length === 1) return `${w.fem ? 'A' : 'O'} ${w.lower} ${n[0]}`;
  return `${w.fem ? 'As' : 'Os'} ${w.lowerMany} ${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

/** pt-BR "2,5" → 2.5; `null` para o que não é número com até 2 casas. */
export function decimalOf(text: string | null | undefined): number | null {
  const t = String(text ?? '').trim();
  return /^\d+(,\d{1,2})?$/.test(t) ? Number(t.replace(',', '.')) : null;
}

/** "45.820" → 45820; `null` para o que não é inteiro. */
export function intOf(text: string | null | undefined): number | null {
  const t = String(text ?? '').trim().replace(/\./g, '');
  return /^\d+$/.test(t) ? parseInt(t, 10) : null;
}

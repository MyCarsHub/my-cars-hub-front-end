import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_MAX_AMOUNT_CENTS,
  Expense,
  ExpenseCategoryKey,
  expenseCategoryLabel,
} from '../types/expense.types';
import { ptBrMoneyCents, ptBrMoneyValidator } from './validators/ptbr-money.validator';

const MONTH_NAMES = [
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

/** `2026-11` -> `novembro de 2026`. */
export function monthName(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? m} de ${y}`;
}

/** `2026-11` -> `Novembro de 2026`, como o seletor de mês mostra. */
export function monthTitle(key: string): string {
  const name = monthName(key);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Mês anterior (`delta = -1`) ou seguinte (`+1`) de um `yyyy-MM`. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** O mês de uma data `yyyy-MM-dd`. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * Teto do valor do Gasto. Compõe o validador de dinheiro pt-BR (que lê TEXTO) com o teto do
 * back-end: sem isto um valor acima de R$ 100 milhões só falharia no servidor.
 */
export function expenseAmountValidator(): ValidatorFn {
  const base = ptBrMoneyValidator({ minCents: 1 });
  return (control: AbstractControl): ValidationErrors | null => {
    const baseError = base(control);
    if (baseError) return baseError;
    const cents = ptBrMoneyCents(control.value as string);
    if (cents !== null && cents > EXPENSE_MAX_AMOUNT_CENTS) return { max: true };
    return null;
  };
}

/**
 * Descrição obrigatória DE VERDADE: `Validators.required` aceita "   ", e o back-end recusa
 * (ele faz trim). Sem isto o erro só apareceria depois do envio.
 */
export function notBlankValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    typeof control.value === 'string' && control.value.trim() !== '' ? null : { required: true };
}

export interface CategoryCount {
  readonly value: ExpenseCategoryKey | 'ALL';
  readonly label: string;
  readonly count: number;
}

export interface MonthSummary {
  readonly totalCents: number;
  readonly count: number;
  /** Categoria de maior valor; `null` sem lançamentos. */
  readonly biggest: { label: string; cents: number; count: number } | null;
  /** Parte sem veículo (da locadora toda). */
  readonly companyWideCents: number;
}

export function summarize(items: readonly Expense[]): MonthSummary {
  let total = 0;
  let companyWide = 0;
  const byCategory = new Map<string, { cents: number; count: number }>();
  for (const e of items) {
    total += e.amountCents;
    if (!e.vehicleId) companyWide += e.amountCents;
    const cur = byCategory.get(e.category) ?? { cents: 0, count: 0 };
    byCategory.set(e.category, { cents: cur.cents + e.amountCents, count: cur.count + 1 });
  }
  let biggest: MonthSummary['biggest'] = null;
  for (const [key, v] of byCategory) {
    if (!biggest || v.cents > biggest.cents) {
      biggest = { label: expenseCategoryLabel(key), cents: v.cents, count: v.count };
    }
  }
  return { totalCents: total, count: items.length, biggest, companyWideCents: companyWide };
}

/** "Todas" + uma pílula por categoria, sempre as cinco, com a contagem do mês. */
export function categoryCounts(items: readonly Expense[]): CategoryCount[] {
  return [
    { value: 'ALL', label: 'Todas', count: items.length },
    ...EXPENSE_CATEGORY_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      count: items.filter((e) => e.category === o.value).length,
    })),
  ];
}

export interface ExpenseFilters {
  readonly category: ExpenseCategoryKey | 'ALL';
  readonly vehicleId: string;
  readonly query: string;
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Busca por descrição ou placa/modelo (o rótulo do veículo), sem acento nem caixa. */
export function filterExpenses(items: readonly Expense[], f: ExpenseFilters): Expense[] {
  const q = fold(f.query.trim());
  return items.filter((e) => {
    if (f.category !== 'ALL' && e.category !== f.category) return false;
    if (f.vehicleId && e.vehicleId !== f.vehicleId) return false;
    if (q && !fold(`${e.description} ${e.vehicleLabel ?? ''}`).includes(q)) return false;
    return true;
  });
}

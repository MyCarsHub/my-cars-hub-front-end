import type { ExpenseBreakdownDto } from '../types/dashboard.types';

export type ExpenseCategory = keyof ExpenseBreakdownDto;

export interface ExpenseRow {
  readonly key: ExpenseCategory;
  readonly label: string;
  readonly cents: number;
  /** Parte do total das linhas presentes, 0..1 (0 quando o total é zero). */
  readonly share: number;
}

/** Ordem fixa: a mesma em todas as telas, para o dono achar a categoria sem ler. */
const ORDER: readonly { key: ExpenseCategory; label: string }[] = [
  { key: 'maintenance', label: 'Manutenção' },
  { key: 'fines', label: 'Multas' },
  { key: 'ipva', label: 'IPVA' },
  { key: 'insurance', label: 'Seguro' },
  { key: 'financing', label: 'Financiamento' },
  { key: 'expenses', label: 'Gastos' },
];

/**
 * Linhas da quebra de despesas. Só entram as categorias que o backend MANDOU: uma ausente
 * (backend anterior) some da lista em vez de virar um R$ 0,00 que afirmaria um fato falso.
 */
export function expenseRows(breakdown: Partial<ExpenseBreakdownDto> | null | undefined): ExpenseRow[] {
  if (!breakdown) return [];
  const present = ORDER.filter(({ key }) => typeof breakdown[key] === 'number');
  const total = present.reduce((sum, { key }) => sum + (breakdown[key] ?? 0), 0);
  return present.map(({ key, label }) => {
    const cents = breakdown[key] ?? 0;
    return { key, label, cents, share: total > 0 ? cents / total : 0 };
  });
}

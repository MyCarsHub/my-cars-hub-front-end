/**
 * Gastos (FEAT-0423): despesas gerais da locadora, lançadas em `/v1/expenses`.
 *
 * O contrato é o do back-end (`ExpenseRequestDto` / `ExpenseResponseDto`): nada aqui foi
 * inventado. Manutenção, multa, IPVA, seguro e financiamento NÃO são categoria de Gasto, porque
 * têm tela própria e lançar de novo contaria duas vezes.
 */
export type ExpenseCategoryKey =
  | 'FUEL'
  | 'TAXES_AND_FEES'
  | 'WASHING'
  | 'ACCOUNTING_ADMIN'
  | 'OTHER';

export interface ExpenseCategoryOption {
  readonly value: ExpenseCategoryKey;
  readonly label: string;
}

/** Ordem do enum do back-end; os rótulos são os mesmos de `ExpenseCategoryEnum`. */
export const EXPENSE_CATEGORY_OPTIONS: readonly ExpenseCategoryOption[] = [
  { value: 'FUEL', label: 'Abastecimento' },
  { value: 'TAXES_AND_FEES', label: 'Impostos e taxas' },
  { value: 'WASHING', label: 'Lavagem' },
  { value: 'ACCOUNTING_ADMIN', label: 'Contador/administrativo' },
  { value: 'OTHER', label: 'Outros' },
];

/** Resposta de GET/POST/PUT. `category` chega como string crua; `categoryLabel` já em pt-BR. */
export interface Expense {
  id: string;
  createdDate: string | null;
  modifyDate: string | null;
  companyId: string;
  vehicleId: string | null;
  /** Placa e modelo já montados pelo back-end; `null` quando o gasto é da locadora toda. */
  vehicleLabel: string | null;
  category: string;
  categoryLabel: string;
  description: string;
  /** `yyyy-MM-dd`. */
  expenseDate: string;
  amountCents: number;
}

/** Corpo de criar e de editar (`PUT` leva o corpo inteiro). `vehicleId` é opcional. */
export interface ExpenseRequest {
  vehicleId: string | null;
  category: ExpenseCategoryKey;
  description: string;
  expenseDate: string;
  amountCents: number;
}

/**
 * Teto do valor: 10_000_000_000 centavos (R$ 100 milhões), o mesmo `@Max` do back-end. Acima
 * disso o back-end responde 400, então a tela recusa antes de enviar.
 */
export const EXPENSE_MAX_AMOUNT_CENTS = 10_000_000_000;

/** Tamanho máximo da descrição (`@Size(max = 300)`). */
export const EXPENSE_DESCRIPTION_MAX = 300;

export function expenseCategoryLabel(category: string | null | undefined): string {
  return EXPENSE_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category ?? '';
}

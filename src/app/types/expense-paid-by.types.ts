/**
 * V123 — quem pagou uma manutenção, sinistro ou multa.
 *
 * `COMPANY` (Locadora) entra nas despesas/resultado da empresa; `DRIVER`
 * (Motorista) e `OWNER` (Dono — dono/investidor do veículo) ficam registrados
 * mas fora do faturamento. O backend trata o campo
 * ausente como `COMPANY` no create e como "manter o gravado" no update.
 */
export type ExpensePaidBy = 'COMPANY' | 'DRIVER' | 'OWNER';

/** Ordem de exibição do controle. */
export const EXPENSE_PAID_BY_VALUES: readonly ExpensePaidBy[] = ['COMPANY', 'DRIVER', 'OWNER'];

export const EXPENSE_PAID_BY_DEFAULT: ExpensePaidBy = 'COMPANY';

export const EXPENSE_PAID_BY_LABELS: Readonly<Record<ExpensePaidBy, string>> = {
  COMPANY: 'Locadora',
  DRIVER: 'Motorista',
  OWNER: 'Dono',
};

/** Selo das listas/detalhes. Locadora é o normal e não tem selo. */
export const EXPENSE_PAID_BY_BADGES: Readonly<Partial<Record<ExpensePaidBy, string>>> = {
  DRIVER: 'Pago pelo motorista',
  OWNER: 'Pago pelo dono',
};

/** Normaliza o que veio do servidor: resposta antiga (sem o campo) = Locadora. */
export function paidByOrDefault(value: ExpensePaidBy | null | undefined): ExpensePaidBy {
  return value === 'DRIVER' || value === 'OWNER' ? value : EXPENSE_PAID_BY_DEFAULT;
}

/**
 * V123 — quem pagou uma manutenção, sinistro ou multa.
 *
 * `COMPANY` (Locadora) entra nas despesas/resultado da empresa; `DRIVER`
 * (Motorista) fica registrado mas fora do faturamento. O backend trata o campo
 * ausente como `COMPANY` no create e como "manter o gravado" no update.
 */
export type ExpensePaidBy = 'COMPANY' | 'DRIVER';

export const EXPENSE_PAID_BY_DEFAULT: ExpensePaidBy = 'COMPANY';

export const EXPENSE_PAID_BY_LABELS: Readonly<Record<ExpensePaidBy, string>> = {
  COMPANY: 'Locadora',
  DRIVER: 'Motorista',
};

/** Normaliza o que veio do servidor: resposta antiga (sem o campo) = Locadora. */
export function paidByOrDefault(value: ExpensePaidBy | null | undefined): ExpensePaidBy {
  return value === 'DRIVER' ? 'DRIVER' : EXPENSE_PAID_BY_DEFAULT;
}

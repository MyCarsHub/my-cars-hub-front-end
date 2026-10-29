import { AdminChargeListItem } from '../../../types/admin-charges.types';

/** Tipos que o admin pode registrar como recebidos por fora. */
export const RECEIVABLE_KINDS = ['CAUCAO', 'RENTAL_PERIOD', 'RENTAL_TOTAL'];

/**
 * "Recebida por fora" (só admin, dono 29/10/2026): caução ou parcela do aluguel, PENDENTE ou
 * ATRASADA. Multa e cobrança com falha não. O backend confere tudo de novo.
 */
export function canReceiveCharge(item: AdminChargeListItem): boolean {
  return RECEIVABLE_KINDS.includes(item.kind) && (item.status === 'PENDING' || item.status === 'PAST_DUE');
}

/** "Tentar de novo": FAILED e hoje ≤ vencimento (daysOverdue ≤ 0). Atrasada é prova: nunca. */
export function canRetryCharge(item: AdminChargeListItem): boolean {
  return item.status === 'FAILED' && item.dueDate !== null && item.daysOverdue <= 0;
}

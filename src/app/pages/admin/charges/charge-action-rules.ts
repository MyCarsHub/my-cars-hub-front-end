import { AdminChargeListItem } from '../../../types/admin-charges.types';

/** Tipos que o admin pode registrar como recebidos por fora. */
export const RECEIVABLE_KINDS = ['CAUCAO', 'RENTAL_PERIOD', 'RENTAL_TOTAL', 'AGREEMENT'];

/**
 * "Recebida por fora" (só admin, dono 29/10/2026): caução ou parcela do aluguel, PENDENTE ou
 * ATRASADA. Multa e cobrança com falha não. O backend confere tudo de novo.
 */
export function canReceiveCharge(item: AdminChargeListItem): boolean {
  return RECEIVABLE_KINDS.includes(item.kind) && (item.status === 'PENDING' || item.status === 'PAST_DUE');
}

/**
 * "Tentar de novo": FAILED e hoje ≤ vencimento (daysOverdue ≤ 0). Atrasada é prova: nunca.
 * Ajuste (V141) nunca: o back-end recusa com 409 e o dono decidiu que não há "Gerar de novo".
 */
export function canRetryCharge(item: AdminChargeListItem): boolean {
  if (item.kind === 'ADJUSTMENT') return false;
  return item.status === 'FAILED' && item.dueDate !== null && item.daysOverdue <= 0;
}

/** Quantos caracteres do id o admin digita para confirmar o cancelamento (igual ao servidor). */
export const CANCEL_CONFIRMATION_LENGTH = 8;

/** Cobrança em aberto (pendente, atrasada ou com falha) pode ser cancelada pelo Dono; paga/estornada/em disputa não. */
export function canCancelCharge(item: AdminChargeListItem): boolean {
  return item.status === 'PENDING' || item.status === 'PAST_DUE' || item.status === 'FAILED';
}

/** Vencida: PAST_DUE ou vencimento estritamente antes de hoje. Pede motivo e confirmação digitada. */
export function isOverdueCharge(item: AdminChargeListItem): boolean {
  return item.status === 'PAST_DUE' || (item.dueDate !== null && item.daysOverdue > 0);
}

/** Código digitado: os primeiros caracteres do id da cobrança, em minúsculas. */
export function cancelConfirmationCode(chargeId: string): string {
  return chargeId.slice(0, CANCEL_CONFIRMATION_LENGTH).toLowerCase();
}

export function cancelConfirmationMatches(chargeId: string, typed: string): boolean {
  return typed.trim().toLowerCase() === cancelConfirmationCode(chargeId);
}

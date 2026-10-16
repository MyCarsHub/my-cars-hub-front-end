import { AbstractControl } from '@angular/forms';
import { applyFieldErrors, parseApiError } from '../../services/api-error';

/**
 * A regra "multa fixa menor que a cobranca" e do BACKEND (LATE_FINE_NOT_BELOW_CHARGE,
 * conferida pelo preflight). Aqui so ficou o mapeamento do codigo do servidor para o
 * campo certo — nenhuma validacao local bloqueia o botao.
 */
const SERVER_CODES: Readonly<Record<string, { control: string; field: string }>> = {
  LATE_FINE_NOT_BELOW_CHARGE: { control: 'lateFineValueInput', field: 'lateFineValue' },
};

/**
 * O 400 do servidor com o code da regra cai no campo, com a mensagem do servidor.
 * `true` quando tratou o erro.
 */
export function applyFeeBelowChargeServerError(error: unknown, form: AbstractControl): boolean {
  const parsed = parseApiError(error);
  const target = parsed.code ? SERVER_CODES[parsed.code] : undefined;
  if (!target) return false;
  const message = parsed.fieldErrors[target.field] ?? parsed.message;
  if (!message) return false;
  const { applied } = applyFieldErrors(form, { [target.control]: message });
  return applied.length > 0;
}

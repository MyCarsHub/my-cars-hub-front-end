import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { applyFieldErrors, parseApiError } from '../../services/api-error';
import { ptBrMoneyCents } from '../../utils/validators/ptbr-money.validator';
import { formatPtBrMoney } from '../../utils/ptbr-number';

/**
 * FIX-0750: multa fixa (R$) tem que ser MENOR que o valor da cobranca
 * (`periodRateReais`). Espelha FIX-0749 do servidor. Percentual nunca entra: a
 * multa % tem outro limite. FIX-0754: o juros em R$/dia saiu da tela (agora e % ao
 * mes, conferido pelo preflight), entao so a multa fixa segue aqui.
 */
export const FEE_NOT_BELOW_CHARGE_KEY = 'feeNotBelowCharge';

export type FeeKind = 'LATE_FINE';

const SERVER_CODES: Readonly<Record<string, { control: string; field: string }>> = {
  LATE_FINE_NOT_BELOW_CHARGE: { control: 'lateFineValueInput', field: 'lateFineValue' },
};

/** `R$ 1.234,56` — mesma formatacao da mensagem do servidor. */
function reais(cents: number): string {
  return `R$ ${formatPtBrMoney(cents)}`;
}

/** Texto do erro inline; identico ao devolvido pelo servidor. */
export function feeBelowChargeMessage(feeCents: number, chargeCents: number): string {
  return `A multa fixa (${reais(feeCents)}) deve ser menor que o valor da cobrança (${reais(chargeCents)}).`;
}

/** Centavos do encargo e da cobranca quando a regra se aplica; senao `null`. */
export function feeAndCharge(
  kind: FeeKind,
  form: Pick<FormGroup, 'get'>,
): { fee: number; charge: number } | null {
  if (kind === 'LATE_FINE' && form.get('lateFineType')?.value !== 'FIXED') return null;
  const feeControl = form.get('lateFineValueInput');
  const raw: unknown = feeControl?.value;
  const fee = typeof raw === 'string' ? ptBrMoneyCents(raw) : null;
  const periodRaw: unknown = form.get('periodRateReais')?.value;
  const charge = typeof periodRaw === 'string' ? ptBrMoneyCents(periodRaw) : null;
  if (fee === null || charge === null || fee <= 0 || charge <= 0) return null;
  return { fee, charge };
}

export function feeBelowChargeValidator(kind: FeeKind): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const parent = control.parent;
    if (!parent) return null;
    const pair = feeAndCharge(kind, parent);
    return pair !== null && pair.fee >= pair.charge ? { [FEE_NOT_BELOW_CHARGE_KEY]: true } : null;
  };
}

/** Mensagem corrente do erro (ou `null`), para alimentar `[messages]` do campo. */
export function currentFeeMessage(kind: FeeKind, form: Pick<FormGroup, 'get'>): string | null {
  const pair = feeAndCharge(kind, form);
  return pair !== null && pair.fee >= pair.charge
    ? feeBelowChargeMessage(pair.fee, pair.charge)
    : null;
}

/**
 * Defesa em profundidade: o 400 do servidor com um dos codes de FIX-0749 cai no
 * MESMO campo, com a mensagem do servidor. `true` quando tratou o erro.
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

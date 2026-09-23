import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { parsePtBrMoneyCents } from '../ptbr-number';

/**
 * Validador dos campos de dinheiro em pt-BR (FIX-0261), irmão de
 * `ptbr-money-mask` — a máscara escreve a gramática, este validador a cobra.
 *
 * Existe porque a migração de `type="number"` para `type="text"` tirou do
 * navegador a validação que vinha de graça (`min`, `step`): o valor agora é
 * TEXTO, e quem decide se "45.000,00" é dinheiro é a gramática de
 * `utils/ptbr-number`, a mesma que `parsePtBrMoneyCents` usa para converter.
 * Validar por um caminho e converter por outro é como o defeito das telas
 * antigas nasceu (`Number("45.000,00")` → `NaN` → zero silencioso), então aqui
 * há uma única fonte da verdade.
 *
 * As chaves de erro são de propósito as MESMAS do Angular (`required`, `min`)
 * mais `moneyFormat`: os mapas de mensagem já escritos nas telas continuam
 * valendo sem reescrita, e só a mensagem nova precisa ser adicionada.
 */
export interface PtBrMoneyValidatorOptions {
  /** Campo que pode ficar vazio — o payload manda `null` nesse caso. */
  optional?: boolean;
  /** Mínimo aceito, EM CENTAVOS (`1` = "maior que zero"). */
  minCents?: number;
}

export function ptBrMoneyValidator(options: PtBrMoneyValidatorOptions = {}): ValidatorFn {
  const optional = options.optional === true;
  const minCents = options.minCents ?? 0;

  return (control: AbstractControl): ValidationErrors | null => {
    const raw = typeof control.value === 'string' ? control.value.trim() : '';
    if (raw === '') return optional ? null : { required: true };

    const { scaled, error } = parsePtBrMoneyCents(raw);
    if (error !== null || scaled === null) return { moneyFormat: true };
    if (scaled < minCents) return { min: { min: minCents / 100 } };
    return null;
  };
}

/**
 * Centavos do texto do campo — o ÚNICO caminho de conversão dos campos
 * mascarados no submit. `null` para vazio e para o que a gramática recusa (que
 * o validador já barrou antes de o submit acontecer).
 *
 * Substitui `toCents(Number(valor))` nesses campos: `Number` não entende
 * agrupamento pt-BR e transformaria "45.000,00" em `NaN`.
 */
export function ptBrMoneyCents(value: string | null | undefined): number | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return null;
  const { scaled, error } = parsePtBrMoneyCents(raw);
  return error !== null ? null : scaled;
}

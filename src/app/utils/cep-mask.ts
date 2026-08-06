import { AbstractControl } from '@angular/forms';
import { applyMaskedDocumentInput } from './document-mask';

/**
 * CEP helpers, no MESMO formato de `phone-mask.ts` e reusando o MESMO motor de
 * caret de `document-mask.ts`. Não há um segundo algoritmo de máscara aqui — só a
 * grade `00000-000` e as conversões de/para o valor cru.
 *
 * **Um CEP é SEMPRE string.** Nada aqui o converte para número: `Number('01001000')`
 * comeria o zero à esquerda de metade dos CEPs de São Paulo.
 *
 * Antes disto o projeto tinha CEP em dois lugares e nenhum reaproveitável: o
 * `formatCep()` de `pages/drivers/driver-detail.ts` é só exibição (não mascara
 * digitação) e o campo de `pages/drivers/driver-form.ts` valida por regex sem
 * máscara nenhuma. Ambos são candidatos naturais a migrar para cá quando o item de
 * consolidação de máscaras da fila for tocado.
 */

/** Comprimento do CEP cru. */
const CEP_LENGTH = 8;

/** Shape aceito: oito dígitos. */
const CEP_SHAPE = /^\d{8}$/;

/** Só dígitos, limitado ao comprimento do CEP. Zeros à esquerda sobrevivem. */
export function normalizeCep(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '').slice(0, CEP_LENGTH);
}

/**
 * Máscara progressiva `00000-000`. Compartilhada pelo handler de digitação e pelo
 * `patchValue` de hidratação, para que o valor vindo do backend renderize igual ao
 * que o usuário digitaria.
 */
export function maskCep(value: string | null | undefined): string {
  const digits = normalizeCep(value);
  if (digits.length > 5) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
}

/** `true` para vazio (omissão é válida) ou para um CEP de oito dígitos. */
export function isCepShapeValid(value: string | null | undefined): boolean {
  const digits = normalizeCep(value);
  return digits.length === 0 || CEP_SHAPE.test(digits);
}

/**
 * Re-formata o campo a cada tecla e devolve o caret para onde o usuário estava
 * digitando. Sem isso, reescrever o valor do controle joga o cursor para o fim da
 * string e editar no meio fica inviável no celular — que é onde este produto é
 * usado. Delega ao handler de documento, que é agnóstico de máscara (conta
 * alfanuméricos, e num CEP todo alfanumérico é dígito) e já trata o backspace em
 * cima do hífen, que de outra forma pareceria uma tecla morta.
 */
export function applyMaskedCepInput(event: Event, control: AbstractControl | null | undefined): void {
  applyMaskedDocumentInput(event, control, maskCep);
}

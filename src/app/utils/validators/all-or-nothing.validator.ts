import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * "Tudo ou nada" para um grupo de campos que viaja como bloco único.
 *
 * Regra: grupo INTEIRO em branco é válido (é assim que o usuário apaga o bloco);
 * a partir do momento em que QUALQUER campo tem valor, todos os outros passam a ser
 * obrigatórios — menos os listados em `exempt`, que continuam livres para sempre.
 *
 * ## Por que validador de grupo, e não onze `Validators.required`
 *
 * A obrigatoriedade aqui é condicional ao estado dos IRMÃOS, não ao próprio campo.
 * Um `required` por controle nunca conseguiria deixar o bloco todo em branco passar,
 * e um validador por controle que lesse o pai teria o problema clássico: quando o
 * campo A muda, o Angular re-roda os validadores de A e do GRUPO, nunca os dos irmãos
 * — B ficaria com o erro velho na tela até ser tocado. Um único validador no grupo
 * roda a cada mudança de qualquer filho, então enxerga sempre o estado completo.
 *
 * ## Por que ele escreve o erro nos filhos
 *
 * A mensagem tem que aparecer NO campo que falta, não num banner no rodapé de um
 * formulário longo — no celular o usuário não veria. `app-form-field` lê
 * `control.errors`, então o erro precisa estar no controle. A chave usada é a
 * `required` padrão do Angular, de propósito: `resolveValidationMessage` já a conhece
 * e cada tela pode trocar a cópia pelo mapa `messages`.
 *
 * ## Por que `setErrors` aqui dentro não entra em laço
 *
 * `setErrors` NÃO re-roda validadores: ele grava `errors`, recalcula o próprio status
 * e sobe pela árvore recalculando status (`_updateControlsErrors`), sem chamar
 * `updateValueAndValidity` de novo. Verificado em `@angular/forms` 21.x. Ainda assim
 * este validador só chama `setErrors` na TRANSIÇÃO (ver `applyRequired`), para não
 * emitir evento de status a cada tecla em onze controles.
 *
 * Filho que re-roda os próprios validadores apaga a chave `required` de `errors` — mas
 * essa passada termina em `parent.updateValueAndValidity()`, que executa este
 * validador e a repõe. O erro do servidor (`serverError`) e os validadores locais do
 * campo são preservados: a chave é somada/removida, nunca substitui o mapa inteiro.
 */

/** Chave padrão do Angular — `resolveValidationMessage` já sabe traduzi-la. */
const REQUIRED_KEY = 'required';

/** Vazio é `''`, só espaço, `null` ou `undefined`. */
function isFilled(control: AbstractControl): boolean {
  const value: unknown = control.value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/** Soma ou remove `required` sem tocar nas outras chaves — e só quando muda de fato. */
function applyRequired(control: AbstractControl, required: boolean): void {
  const errors = control.errors;
  const alreadyFlagged = errors !== null && REQUIRED_KEY in errors;
  if (required === alreadyFlagged) return;

  if (required) {
    control.setErrors({ ...(errors ?? {}), [REQUIRED_KEY]: true });
    return;
  }

  const rest = Object.fromEntries(
    Object.entries(errors ?? {}).filter(([key]) => key !== REQUIRED_KEY),
  );
  control.setErrors(Object.keys(rest).length > 0 ? rest : null);
}

/**
 * @param exempt nomes de controles que nunca ficam obrigatórios (ex.: complemento de
 *   endereço, que boa parte dos imóveis simplesmente não tem). Eles continuam contando
 *   como "bloco começou" se forem preenchidos.
 * @returns `{ blockIncomplete: { missing } }` no grupo enquanto faltar campo, `null`
 *   quando o bloco está inteiro preenchido OU inteiro em branco.
 */
export function allOrNothingBlock(exempt: readonly string[] = []): ValidatorFn {
  const exemptNames = new Set(exempt);

  return (group: AbstractControl): ValidationErrors | null => {
    if (!(group instanceof FormGroup)) return null;

    const controls: Record<string, AbstractControl> = group.controls;
    // Desabilitado fica de fora dos DOIS laços. Um controle `DISABLED` não pode ser
    // preenchido, então marcá-lo de `required` seria um erro permanente: o grupo
    // ficaria com `blockIncomplete` para sempre e a tela não mostraria nada — o
    // `app-form-field` não renderiza mensagem de controle desabilitado. Formulário
    // impossível de salvar e sem motivo visível. Também não conta como "bloco
    // começou": `getRawValue()` até levaria o valor dele adiante, mas quem decide
    // desabilitar o campo é quem decide que ele não participa da regra.
    const entries = Object.entries(controls).filter(([, control]) => !control.disabled);
    const blockStarted = entries.some(([, control]) => isFilled(control));
    const missing: string[] = [];

    for (const [name, control] of entries) {
      const required = blockStarted && !exemptNames.has(name) && !isFilled(control);
      if (required) missing.push(name);
      applyRequired(control, required);
    }

    return missing.length > 0 ? { blockIncomplete: { missing } } : null;
  };
}

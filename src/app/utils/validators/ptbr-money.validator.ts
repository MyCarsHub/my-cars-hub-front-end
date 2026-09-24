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

/**
 * FIX-0538 — AUSENTE e TIPO ERRADO nao sao a mesma coisa.
 *
 * Esta funcao abria com uma coercao (`typeof value === 'string' ? ... : ''`) que
 * jogava TODO nao-texto no mesmo ramo do campo vazio. Em campo obrigatorio ainda
 * saia `required`, o que ao menos recusava; em campo OPCIONAL saia `null`, ou
 * seja, ACEITAVA — e no submit `ptBrMoneyCents` fazia a mesma coercao e devolvia
 * `null`, entao o valor era DESCARTADO EM SILENCIO.
 *
 * Opcional vale para AUSENTE, nao para valor de tipo errado. A regra vem do
 * FIX-0538, que a estabeleceu nos validadores de manutencao; este arquivo se
 * chama fonte unica da verdade e nao pode contradiz-la.
 */
type RawKind = 'absent' | 'not-text' | 'text';

function classifyRaw(value: unknown): RawKind {
  if (value === null || value === undefined) return 'absent';
  if (typeof value !== 'string') return 'not-text';
  return value.trim() === '' ? 'absent' : 'text';
}

export function ptBrMoneyValidator(options: PtBrMoneyValidatorOptions = {}): ValidatorFn {
  const optional = options.optional === true;
  const minCents = options.minCents ?? 0;

  return (control: AbstractControl): ValidationErrors | null => {
    const kind = classifyRaw(control.value);
    if (kind === 'absent') return optional ? null : { required: true };
    // Opcional vale para AUSENTE, nao para lixo: nao-texto e invalido nos dois modos.
    if (kind === 'not-text') return { moneyFormat: true };

    const raw = (control.value as string).trim();
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
  // Mesma classificacao do validador, para os dois nunca discordarem sobre o que
  // e "vazio". Nao-texto nao chega aqui: o validador o recusa com `moneyFormat`
  // antes do submit. Devolver `null` seria justamente o descarte silencioso que a
  // distincao existe para impedir — a recusa e la, nao aqui.
  if (classifyRaw(value) !== 'text') return null;
  const { scaled, error } = parsePtBrMoneyCents((value as string).trim());
  return error !== null ? null : scaled;
}

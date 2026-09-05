import { formatPtBrNumber, MONEY_DECIMALS } from './ptbr-number';

/**
 * Máscara de milhar DURANTE A DIGITAÇÃO para campos de dinheiro pt-BR (FIX-0261).
 *
 * Segue o padrão das outras máscaras do projeto (`cep-mask`, `document-mask`):
 * funções puras + um aplicador fino de DOM. O agrupamento em si é delegado a
 * `formatPtBrNumber` — o inverso exato de `parsePtBrNumber` — para que o valor
 * reescrito no campo seja, por construção, aceito de volta pelo parser. É por
 * isso que `Intl`/`formatBRL` NUNCA entram aqui: o round-trip deles não é
 * garantido, e um campo que mostra o que depois recusa é o defeito original que
 * `utils/ptbr-number` existe para matar.
 *
 * ## Dois modos, decididos pelo TIPO do evento
 *
 * - **Digitação/apagar** (`insertText`, `deleteContent*`…): os pontos presentes
 *   no campo foram postos por ESTA máscara, então é seguro descartá-los e
 *   reagrupar do zero. Tecla "." é morta — o milhar é automático — e a terceira
 *   casa decimal também (dinheiro tem 2). O reflow ao apagar um dígito no meio
 *   de um grupo ("1.500" → apaga o 5 → "100") só é possível neste modo.
 * - **Colagem** (`insertFromPaste`/`insertFromDrop`, ou evento sem `inputType`):
 *   os pontos vieram de FORA e podem ser decimais en-US ("45.99"). Aqui a regra
 *   é estrita: só reformata o que já é gramática pt-BR válida (com `R$` e
 *   espaços tolerados, como no parser). O que não é — "45.99", "1.23.456",
 *   três casas decimais — fica INTACTO no campo, para a validação inline
 *   recusar em voz alta. Coagir "45.99" para "4.599" seria o erro de 100x
 *   silencioso que este módulo não pode reintroduzir.
 *
 * ## Caret
 *
 * A posição é preservada contando os caracteres SIGNIFICATIVOS (dígitos e a
 * vírgula) antes do caret — os pontos são regenerados e não contam. Editar no
 * meio do valor não joga o cursor para o fim, que é o que inviabiliza edição
 * no celular. Backspace e Delete em cima de um ponto também são tratados: como
 * o reagrupo o recolocaria, a tecla pareceria morta; quando a remoção só levou
 * pontuação, o dígito vizinho cai junto — o anterior no backspace, o seguinte
 * no delete (mesma regra de `document-mask`, estendida).
 */

export interface PtBrMoneyMaskResult {
  /** O valor a escrever de volta no campo. */
  value: string;
  /** Posição do caret dentro de `value`. */
  caret: number;
}

export interface PtBrMoneyMaskContext {
  /**
   * O valor do campo ANTES desta edição (no diálogo, o que está no signal).
   * Necessário só para detectar o backspace que removeu apenas um ponto.
   */
  previous?: string;
  /** `true` quando o evento foi `deleteContentBackward`. */
  deletedBackwards?: boolean;
  /** `true` quando o evento foi `deleteContentForward` (tecla Delete). */
  deletedForwards?: boolean;
  /**
   * `true` quando o texto veio de fora (colagem/drop) ou quando não dá para
   * saber (evento sem `inputType`). Liga o modo estrito descrito acima.
   */
  pasted?: boolean;
}

/** Parte inteira agrupada válida — mesma gramática de `parsePtBrNumber`. */
const GROUPED_INTEGER = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const PLAIN_INTEGER = /^\d+$/;

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Dígitos E vírgula: o que o usuário digitou de próprio punho. Serve para
 * distinguir "o backspace comeu um ponto nosso" (contagem igual → tecla morta)
 * de "o backspace comeu a vírgula" (contagem menor → edição real).
 */
function significantOf(value: string): string {
  return value.replace(/[^\d,]/g, '');
}

/**
 * Agrupa a parte inteira reusando `formatPtBrNumber` com 0 casas — o caminho
 * cujo round-trip com o parser é um teorema, não uma coincidência. Dígitos
 * demais para um inteiro seguro ficam sem agrupar: o parser vai recusar esse
 * valor de qualquer forma, e agrupar errado seria pior que não agrupar.
 */
function groupInteger(digits: string): string {
  if (digits === '') return '';
  const whole = Number(digits);
  if (!Number.isSafeInteger(whole)) return digits;
  return formatPtBrNumber(whole, 0);
}

/** Índice em `value` logo após o `count`-ésimo caractere significativo. */
function caretAfterSignificant(value: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (/[\d,]/.test(value[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return value.length;
}

/**
 * O modo estrito da colagem: normaliza como o parser (`R$` e espaços fora) e
 * só aceita reformatar o que já é gramática pt-BR — inteiro puro ou agrupado,
 * vírgula opcional, até 2 casas (parciais valem: "1.234," e "1.234,5" são
 * estados legítimos de digitação). Devolve `null` para "não mexa".
 */
function strictReformat(raw: string): string | null {
  const text = raw.replace(/^\s*R\$/i, '').replace(/\s/g, '');
  if (text === '') return '';

  const parts = text.split(',');
  if (parts.length > 2) return null;

  const integerText = parts[0];
  const hasComma = parts.length === 2;
  const fractionText = hasComma ? parts[1] : '';

  if (integerText === '') {
    if (!hasComma) return null;
  } else if (!PLAIN_INTEGER.test(integerText) && !GROUPED_INTEGER.test(integerText)) {
    return null;
  }
  if (fractionText !== '' && !/^\d+$/.test(fractionText)) return null;
  if (fractionText.length > MONEY_DECIMALS) return null;

  const grouped = groupInteger(digitsOf(integerText));
  return hasComma ? `${grouped},${fractionText}` : grouped;
}

/**
 * A função pura da máscara: recebe o valor cru como está no campo + a posição
 * do caret, devolve o valor formatado + o caret novo. Não toca DOM nenhum —
 * `applyPtBrMoneyMask` é quem faz isso.
 */
export function maskPtBrMoneyInput(
  raw: string,
  caret: number,
  context: PtBrMoneyMaskContext = {},
): PtBrMoneyMaskResult {
  const clamped = Math.max(0, Math.min(caret, raw.length));

  // Backspace/Delete que só removeu um ponto: sem isto o reagrupo devolve o
  // ponto e a tecla parece morta. O dígito do LADO da tecla cai junto, como o
  // usuário quis — o da esquerda no backspace, o da direita no delete.
  let source = raw;
  let position = clamped;
  const onlyPunctuationWentAway =
    context.previous !== undefined &&
    significantOf(source).length === significantOf(context.previous).length;
  if (context.deletedBackwards && onlyPunctuationWentAway && position > 0) {
    const before = source.slice(0, position);
    const lastDigit = before.search(/\d(?=\D*$)/);
    if (lastDigit >= 0) {
      source = source.slice(0, lastDigit) + source.slice(lastDigit + 1);
      position -= 1;
    }
  } else if (context.deletedForwards && onlyPunctuationWentAway && position < source.length) {
    const nextDigit = source.slice(position).search(/\d/);
    if (nextDigit >= 0) {
      const index = position + nextDigit;
      source = source.slice(0, index) + source.slice(index + 1);
    }
  }

  if (context.pasted) {
    const strict = strictReformat(source);
    if (strict === null) return { value: raw, caret: clamped };
    // Colagem substitui o conteúdo; o caret no fim é onde o navegador o deixa.
    return { value: strict, caret: caretAfterSignificant(strict, Number.MAX_SAFE_INTEGER) };
  }

  // Modo digitação: mantém dígitos e a PRIMEIRA vírgula (a segunda é tecla
  // morta), com a fração limitada às casas do dinheiro. Todo o resto — pontos
  // nossos, letras, símbolos — é descartado e o agrupamento renasce do zero.
  let kept = '';
  let beforeCaret = 0;
  let sawComma = false;
  let fractionCount = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    let keep = false;
    if (/\d/.test(ch)) {
      if (!sawComma) keep = true;
      else if (fractionCount < MONEY_DECIMALS) {
        keep = true;
        fractionCount++;
      }
    } else if (ch === ',' && !sawComma) {
      keep = true;
      sawComma = true;
    }
    if (keep) {
      kept += ch;
      if (i < position) beforeCaret++;
    }
  }

  const commaIndex = kept.indexOf(',');
  const integerDigits = commaIndex === -1 ? kept : kept.slice(0, commaIndex);
  const fractionDigits = commaIndex === -1 ? '' : kept.slice(commaIndex + 1);

  // Zero à esquerda não sobrevive ("045" → "45"): "0.450" seria recusado pelo
  // parser, e a máscara não pode fabricar um valor que o campo recusa.
  const trimmed = integerDigits.replace(/^0+(?=\d)/, '');
  const removedZeros = integerDigits.length - trimmed.length;
  beforeCaret -= Math.min(removedZeros, beforeCaret);

  const grouped = groupInteger(trimmed);
  const value = commaIndex === -1 ? grouped : `${grouped},${fractionDigits}`;
  return { value, caret: caretAfterSignificant(value, beforeCaret) };
}

/**
 * O aplicador de DOM: lê o evento, decide o modo pelo `inputType`, chama a
 * função pura e reescreve valor + caret no próprio elemento. Devolve o
 * resultado para o chamador guardar no seu estado (no diálogo, o signal
 * `amount`). `previous` é o valor que o chamador tinha ANTES do evento.
 */
export function applyPtBrMoneyMask(event: Event, previous: string): PtBrMoneyMaskResult {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return { value: previous, caret: previous.length };

  const raw = target.value;
  const caret = target.selectionStart ?? raw.length;
  const inputType = event instanceof InputEvent ? event.inputType : '';
  const result = maskPtBrMoneyInput(raw, caret, {
    previous,
    deletedBackwards: inputType === 'deleteContentBackward',
    deletedForwards: inputType === 'deleteContentForward',
    pasted: inputType === '' || inputType.startsWith('insertFrom'),
  });

  target.value = result.value;
  target.setSelectionRange(result.caret, result.caret);
  return result;
}

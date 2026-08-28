/**
 * O primitivo numérico pt-BR: UMA gramática que governa INPUT, DISPLAY e PARSE.
 *
 * ## Por que este arquivo existe
 *
 * O defeito que ele elimina era este: a tela ENSINAVA um formato e RECUSAVA lê-lo de
 * volta. O detalhe da manutenção mostrava `1.000`; ao redigitar `1.000` no formulário,
 * o parser lia `1` — e, em `1.500`, lia `1,5`. Nos campos de dinheiro era pior: eles
 * eram `<input type="number">`, então `1.500` passava por `parseFloat` e virava `1.5`,
 * gravando R$ 1,50 onde a pessoa quis dizer R$ 1.500,00. Sem recusa, sem mensagem.
 *
 * A causa raiz não é o parser: é INPUT, DISPLAY e PARSE seguirem gramáticas
 * diferentes. Corrigir só o parser recria o defeito em outro lugar. Por isso este
 * módulo é a única fonte das três coisas, e `formatPtBrNumber` é o inverso exato de
 * `parsePtBrNumber` — construído com aritmética inteira, não delegado ao `Intl`,
 * justamente para que o round-trip seja um teorema e não uma coincidência.
 *
 * ## A gramática — uma frase
 *
 * **Vírgula separa as casas decimais. Ponto separa milhar, sempre em grupos de 3.**
 * Exatamente o que a tela mostra.
 *
 * Aceito: `1500` · `1500,50` · `1.500` · `1.500,50` · `45,99` · `1.234.567,89` · `,50`
 * Recusado: `45.99` · `3.5` · `0.001` · `1.23.456` · `1500,555` (para 2 casas) · `-1`
 *
 * ## A ambiguidade `45.99` — a decisão, escrita onde o próximo leitor tropeça nela
 *
 * Um grupo de milhar pt-BR tem 3 dígitos, então `45.99` não é agrupamento válido.
 * Havia duas saídas defensáveis: aceitá-lo como decimal (compatibilidade com quem
 * digita no padrão en-US) ou tratá-lo como erro. **Escolhemos erro.** Três razões, em
 * ordem de peso:
 *
 * 1. **A regra permissiva é INSEGURA na precisão 3.** Ela seria "ponto seguido de
 *    exatamente 3 dígitos é milhar, caso contrário é decimal". Aplicada à quantidade,
 *    que aceita 3 casas decimais, `0.001` — um milésimo, caso real de óleo — cairia na
 *    regra de milhar e viraria `1`. Erro de 1000x, silencioso, idêntico ao defeito que
 *    estamos matando. Nenhuma regra em que o significado do ponto dependa da contagem
 *    de dígitos sobrevive a um campo de 3 casas.
 * 2. **É a única regra em que "o que a tela mostra" e "o que o campo aceita" são o
 *    mesmo conjunto**, que é o critério de aceite deste conserto.
 * 3. **É explicável em uma frase** para o usuário e para quem estender isto aos outros
 *    campos de dinheiro do app. "Ponto é milhar" cabe numa mensagem de erro; "ponto é
 *    milhar quando vierem 3 dígitos e decimal caso contrário" não cabe, e é justamente
 *    o tipo de regra que o próximo dev implementa errado.
 *
 * O custo é real e assumido: quem digitar `45.99` é RECUSADO. Mas é recusado **em voz
 * alta**, com uma mensagem que mostra o que digitar. A recusa visível é o oposto do
 * defeito; a coerção silenciosa é o defeito.
 *
 * ## Por que nada aqui arredonda
 *
 * Casas decimais a mais são **erro**, não arredondamento — `1500,555` num campo de 2
 * casas é dedo trocado, não uma intenção de R$ 1.500,56. Isso preserva o contrato que
 * a quantidade já tinha (`3,5555` é recusado) e dispensa qualquer aviso de
 * arredondamento: não existe entrada que este módulo altere em silêncio. Toda entrada
 * ou vira o número que a pessoa escreveu, ou vira uma mensagem.
 */

/** Motivo da recusa. `format` = fora da gramática; `decimals` = casas decimais demais. */
export type PtBrNumberError = 'format' | 'decimals';

export interface PtBrNumberParse {
  /**
   * O valor em unidades da menor casa: centavos quando `decimals = 2`, milésimos
   * quando `decimals = 3`. Inteiro, sempre — nenhuma multiplicação em ponto flutuante
   * acontece no caminho do dinheiro. `null` quando a entrada é inválida.
   */
  scaled: number | null;
  /** `null` quando `scaled` é válido. */
  error: PtBrNumberError | null;
}

/**
 * Parte inteira COM agrupamento. O primeiro grupo é `[1-9]\d{0,2}`: um número agrupado
 * é necessariamente ≥ 1000, então zero à esquerda (`0.001`, `01.234`) é malformado —
 * e essa é exatamente a guarda que impede um milésimo de ser lido como milhar.
 */
const GROUPED_INTEGER = /^[1-9]\d{0,2}(?:\.\d{3})+$/;

/** Parte inteira SEM agrupamento: dígitos puros, sem nenhum ponto. */
const PLAIN_INTEGER = /^\d+$/;

const DIGITS_ONLY = /^\d+$/;

/**
 * Tira o que é enfeite, nunca o que é significado.
 *
 * Remove o prefixo `R$` e todo espaço. O `\s` do JS já cobre o NBSP (U+00A0) e o
 * narrow NBSP (U+202F) — este último é o separador que o `Intl` põe em `R$ 1.500,50`,
 * e é por isso que um replace de espaço comum não bastaria. Sem isso, colar da
 * tela de detalhe seria recusado, e o round-trip display→input que este módulo promete
 * valeria só para a quantidade. Espaço não é separador decimal nem de milhar em pt-BR,
 * então removê-lo não cria nenhuma segunda leitura possível.
 */
function normalize(raw: string): string {
  return raw.replace(/^\s*R\$/i, '').replace(/\s/g, '');
}

function fail(error: PtBrNumberError): PtBrNumberParse {
  return { scaled: null, error };
}

/**
 * Lê um número pt-BR e devolve inteiro escalado por `10^decimals`.
 *
 * Não trata "vazio" como caso especial: vazio é `format`, e quem chama decide se isso
 * é `required` (campo obrigatório) ou simplesmente ausência.
 */
export function parsePtBrNumber(raw: string | null | undefined, decimals: number): PtBrNumberParse {
  if (raw === null || raw === undefined) return fail('format');

  const text = normalize(String(raw));
  if (!text) return fail('format');

  const parts = text.split(',');
  // Duas vírgulas nunca são um número; é colagem torta ou formato de outro locale.
  if (parts.length > 2) return fail('format');

  const integerText = parts[0];
  const hasFraction = parts.length === 2;
  const fractionText = hasFraction ? parts[1] : '';

  // `,50` = 0,50. A parte inteira vazia só é aceita quando existe parte decimal, e não
  // gera ambiguidade nenhuma: nenhum outro número pt-BR começa com vírgula.
  if (integerText !== '') {
    if (!PLAIN_INTEGER.test(integerText) && !GROUPED_INTEGER.test(integerText)) {
      return fail('format');
    }
  } else if (!hasFraction) {
    return fail('format');
  }

  if (hasFraction) {
    if (!DIGITS_ONLY.test(fractionText)) return fail('format');
    // Recusa, não arredonda — ver o cabeçalho.
    if (fractionText.length > decimals) return fail('decimals');
  }

  const whole = integerText === '' ? 0 : Number(integerText.replace(/\./g, ''));
  if (!Number.isSafeInteger(whole)) return fail('format');

  const scale = 10 ** decimals;
  const fraction = fractionText === '' ? 0 : Number(fractionText.padEnd(decimals, '0'));
  const scaled = whole * scale + fraction;
  if (!Number.isSafeInteger(scaled)) return fail('format');

  return { scaled, error: null };
}

export interface PtBrFormatOptions {
  /**
   * `true` (padrão) mantém as casas fixas — `1500` com 2 casas vira `"15,00"`, que é
   * como dinheiro se escreve. `false` corta zeros à direita, que é como quantidade se
   * escreve (`3,5`, não `3,500`).
   */
  trailingZeros?: boolean;
}

/**
 * O inverso exato de `parsePtBrNumber`: para todo `scaled ≥ 0` e todo `decimals`,
 * `parsePtBrNumber(formatPtBrNumber(scaled, d), d).scaled === scaled`.
 *
 * Feito com aritmética de string sobre inteiros em vez de `Intl.NumberFormat` de
 * propósito: a promessa deste módulo é que a gramática exibida É a gramática aceita, e
 * essa promessa não pode depender do comportamento de agrupamento de uma biblioteca
 * externa que ninguém aqui controla.
 */
export function formatPtBrNumber(
  scaled: number,
  decimals: number,
  options: PtBrFormatOptions = {},
): string {
  const scale = 10 ** decimals;
  const negative = scaled < 0;
  const absolute = Math.abs(Math.trunc(scaled));

  const whole = Math.floor(absolute / scale);
  let fraction = String(absolute % scale).padStart(decimals, '0');
  if (options.trailingZeros === false) fraction = fraction.replace(/0+$/, '');

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = fraction === '' ? grouped : `${grouped},${fraction}`;
  return negative ? `-${body}` : body;
}

/** Casas decimais do dinheiro. Centavos, sempre. */
export const MONEY_DECIMALS = 2;

/** Atalho tipado para dinheiro: texto pt-BR → centavos inteiros. */
export function parsePtBrMoneyCents(raw: string | null | undefined): PtBrNumberParse {
  return parsePtBrNumber(raw, MONEY_DECIMALS);
}

/** Atalho tipado para dinheiro: centavos inteiros → texto pt-BR editável (`"1.500,50"`). */
export function formatPtBrMoney(cents: number | null | undefined): string {
  return formatPtBrNumber(cents ?? 0, MONEY_DECIMALS);
}

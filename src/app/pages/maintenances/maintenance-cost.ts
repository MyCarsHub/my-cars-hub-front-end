/**
 * Aritmética de custo da manutenção — pura, sem Angular, sem formatação de tela.
 *
 * ## Por que quantidade é inteiro de milésimos aqui dentro
 *
 * O backend guarda `quantity` como `NUMERIC(10,3)`: até 3 casas decimais (3,5 litros
 * de óleo é o caso motivador). Fazer `3.5 * 1050` em ponto flutuante e arredondar
 * depois é o caminho curto para o total da tela discordar do total gravado — que é
 * exatamente o defeito que esta seção existe para eliminar.
 *
 * Por isso a quantidade circula como **milésimos inteiros** (`3,5` → `3500`) e o
 * total da linha sai de aritmética inteira. Nenhuma multiplicação em `number`
 * fracionário acontece no caminho do dinheiro.
 *
 * ## O arredondamento é POR LINHA, HALF_UP
 *
 * Mesma regra do backend. Arredondar a soma em vez de cada linha produz um número
 * diferente sempre que duas linhas caem em `.5`, e a tela passaria a mentir sobre o
 * que foi gravado.
 *
 * ## A gramática de entrada e de saída mora em `utils/ptbr-number`
 *
 * Ler e imprimir quantidade são a mesma decisão vista de dois lados, então saem do
 * mesmo módulo. Enquanto não eram, a tela imprimia `1.000` e recusava `1.000`.
 */

import { formatPtBrNumber, parsePtBrNumber } from '../../utils/ptbr-number';

/** Casas decimais aceitas em `quantity` — espelha `NUMERIC(10,3)` no banco. */
export const QUANTITY_DECIMALS = 3;

/** Milésimos por unidade inteira. */
const QUANTITY_UNIT = 1000;

/** Teto de quantidade: espelha `chk_maintenance_items_quantity_max` (V64). */
export const QUANTITY_MAX = 10_000;

/** Teto de preço unitário em centavos (R$ 1.000.000,00) — regra de serviço do backend. */
export const UNIT_PRICE_MAX_CENTS = 100_000_000;

/** Teto de peças por manutenção — guarda-corpo técnico, NUNCA limite comercial. */
export const ITEMS_MAX = 50;

/**
 * Converte a quantidade digitada em milésimos inteiros, na gramática pt-BR única de
 * `utils/ptbr-number` — vírgula decimal, ponto de milhar em grupos de 3.
 *
 * Aceita `3`, `3,5`, `0,001`, `1.500` (mil e quinhentos). Recusa `3.5` e `0.001`:
 * o ponto é separador de MILHAR, e essa é exatamente a correção. A regra anterior
 * tratava ponto e vírgula como decimais intercambiáveis, então `1.500` — que é o que
 * a própria tela de detalhe imprime para mil e quinhentos — voltava como `1,5`.
 *
 * Recusa a 4ª casa decimal de propósito: `3,5555` é erro de digitação, não caso de
 * arredondamento — e o backend o recusa com 400.
 *
 * Retorna `null` para qualquer recusa; o validador do formulário é quem transforma
 * isso na mensagem visível. Nada aqui coage em silêncio.
 */
export function parseQuantityMilli(raw: string | null | undefined): number | null {
  return parsePtBrNumber(raw, QUANTITY_DECIMALS).scaled;
}

/** Milésimos inteiros de volta para o decimal que vai no payload (`3500` → `3.5`). */
export function quantityMilliToNumber(milli: number): number {
  return milli / QUANTITY_UNIT;
}

/** Decimal vindo da API para milésimos inteiros (`3.5` → `3500`). */
export function quantityNumberToMilli(value: number): number {
  return Math.round(value * QUANTITY_UNIT);
}

/**
 * Quantidade para leitura em pt-BR, sem zeros à direita (`3.5` → `"3,5"`).
 *
 * Sai do MESMO módulo que `parseQuantityMilli` lê, e é por isso que o round-trip
 * fecha: o que esta função imprime, aquela função aceita de volta, sempre.
 *
 * Antes isto era um `Intl.NumberFormat`, com agrupamento ligado por padrão — imprimia
 * `1.000` para mil, e o parser da época devolvia `1`. Não era o agrupamento que estava
 * errado (é assim que se escreve mil em pt-BR): era o parser não conhecer a gramática
 * que a própria tela ensinava. Com a gramática unificada o agrupamento pode ficar.
 */
export function formatQuantity(value: number | null | undefined): string {
  return formatPtBrNumber(quantityNumberToMilli(value ?? 0), QUANTITY_DECIMALS, {
    trailingZeros: false,
  });
}

/**
 * Total da linha em centavos, arredondado HALF_UP.
 *
 * `quantityMilli * unitPriceCents` é um inteiro em milésimos de centavo; somar 500
 * antes de dividir por 1000 é o HALF_UP feito sem tocar em ponto flutuante. Ambos os
 * fatores são não-negativos por contrato, então `Math.floor` é o truncamento certo.
 */
export function lineTotalCents(quantityMilli: number, unitPriceCents: number): number {
  if (quantityMilli <= 0 || unitPriceCents <= 0) return 0;
  const milliCents = quantityMilli * unitPriceCents;
  return Math.floor((milliCents + QUANTITY_UNIT / 2) / QUANTITY_UNIT);
}

export interface MaintenanceCostLine {
  quantityMilli: number;
  unitPriceCents: number;
}

export interface MaintenanceCostParts {
  lines: readonly MaintenanceCostLine[];
  labourCents: number;
  discountCents: number;
  surchargeCents: number;
}

export interface MaintenanceCostBreakdown {
  /** Total de cada linha, na mesma ordem recebida. */
  lineTotals: number[];
  /** Soma das peças. Zero quando não há nenhuma — nunca `null`. */
  itemsCents: number;
  labourCents: number;
  discountCents: number;
  surchargeCents: number;
  /** `peças + mão de obra − desconto + acréscimos`. */
  totalCents: number;
  /** Base contra a qual o backend valida o desconto. */
  discountBaseCents: number;
}

/**
 * A fórmula única do total, espelhando `MaintenanceService` no backend.
 * Sem peça nenhuma o total é `mão de obra − desconto + acréscimos`.
 */
export function computeCostBreakdown(parts: MaintenanceCostParts): MaintenanceCostBreakdown {
  const lineTotals = parts.lines.map((line) =>
    lineTotalCents(line.quantityMilli, line.unitPriceCents),
  );
  const itemsCents = lineTotals.reduce((sum, cents) => sum + cents, 0);
  const discountBaseCents = itemsCents + parts.labourCents + parts.surchargeCents;

  return {
    lineTotals,
    itemsCents,
    labourCents: parts.labourCents,
    discountCents: parts.discountCents,
    surchargeCents: parts.surchargeCents,
    totalCents: discountBaseCents - parts.discountCents,
    discountBaseCents,
  };
}

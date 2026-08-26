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
 */

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
 * Aceita `3`, `3,5`, `3.5`, `0,001`. Recusa uma 4ª casa decimal de propósito:
 * `3,5555` é erro de digitação, não caso de arredondamento.
 */
const QUANTITY_PATTERN = /^(\d+)(?:[.,](\d{1,3}))?$/;

/**
 * Converte a quantidade digitada em milésimos inteiros.
 * Retorna `null` quando o texto não é uma quantidade válida — incluindo o caso da
 * 4ª casa decimal, que o backend recusa com 400.
 */
export function parseQuantityMilli(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const match = QUANTITY_PATTERN.exec(text);
  if (!match) return null;

  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) return null;

  const fraction = (match[2] ?? '').padEnd(QUANTITY_DECIMALS, '0');
  return whole * QUANTITY_UNIT + Number(fraction);
}

/** Milésimos inteiros de volta para o decimal que vai no payload (`3500` → `3.5`). */
export function quantityMilliToNumber(milli: number): number {
  return milli / QUANTITY_UNIT;
}

/** Decimal vindo da API para milésimos inteiros (`3.5` → `3500`). */
export function quantityNumberToMilli(value: number): number {
  return Math.round(value * QUANTITY_UNIT);
}

const QUANTITY_FORMATTER = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: QUANTITY_DECIMALS,
});

/** Quantidade para leitura em pt-BR, sem zeros à direita (`3.5` → `"3,5"`). */
export function formatQuantity(value: number | null | undefined): string {
  return QUANTITY_FORMATTER.format(value ?? 0);
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

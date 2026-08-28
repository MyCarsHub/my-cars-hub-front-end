import { describe, it, expect } from 'vitest';

import {
  computeCostBreakdown,
  formatQuantity,
  lineTotalCents,
  parseQuantityMilli,
  quantityMilliToNumber,
  quantityNumberToMilli,
} from './maintenance-cost';

describe('parseQuantityMilli', () => {
  it('aceita inteiro', () => {
    expect(parseQuantityMilli('3')).toBe(3000);
  });

  it('aceita vírgula decimal pt-BR', () => {
    expect(parseQuantityMilli('3,5')).toBe(3500);
  });

  /**
   * Esta expectativa era o DEFEITO escrito como contrato: enquanto `3.5` valesse 3,5,
   * o ponto era separador decimal — e então `1.500`, que é como a tela de detalhe
   * imprime mil e quinhentos, voltava como 1,5. As duas leituras não cabem na mesma
   * gramática, e a que a tela ensina é a que vale.
   */
  it('recusa o PONTO como separador decimal — ele separa milhar', () => {
    expect(parseQuantityMilli('3.5')).toBeNull();
    expect(parseQuantityMilli('45.99')).toBeNull();
  });

  it('lê o ponto como MILHAR, que é o que a tela imprime', () => {
    expect(parseQuantityMilli('1.500')).toBe(1_500_000);
    expect(parseQuantityMilli('1.000')).toBe(1_000_000);
    expect(parseQuantityMilli('10.000')).toBe(10_000_000);
  });

  /**
   * O milésimo é o caso real (óleo). A regra permissiva — "ponto com 3 dígitos é
   * milhar" — leria `0.001` como 1 e erraria 1000x em silêncio. Aqui ele é recusado.
   */
  it('recusa 0.001 e aceita 0,001', () => {
    expect(parseQuantityMilli('0.001')).toBeNull();
    expect(parseQuantityMilli('0,001')).toBe(1);
  });

  it('aceita as três casas decimais do NUMERIC(10,3)', () => {
    expect(parseQuantityMilli('0,001')).toBe(1);
    expect(parseQuantityMilli('1,234')).toBe(1234);
  });

  it('recusa a 4ª casa decimal — é erro de digitação, não arredondamento', () => {
    expect(parseQuantityMilli('3,5555')).toBeNull();
  });

  it('recusa texto, vazio e negativo', () => {
    expect(parseQuantityMilli('abc')).toBeNull();
    expect(parseQuantityMilli('')).toBeNull();
    expect(parseQuantityMilli('   ')).toBeNull();
    expect(parseQuantityMilli('-1')).toBeNull();
    expect(parseQuantityMilli(null)).toBeNull();
    expect(parseQuantityMilli(undefined)).toBeNull();
  });

  it('ignora espaços em volta', () => {
    expect(parseQuantityMilli('  2,25  ')).toBe(2250);
  });
});

describe('conversão de quantidade', () => {
  it('vai e volta entre milésimos e decimal', () => {
    expect(quantityMilliToNumber(3500)).toBe(3.5);
    expect(quantityNumberToMilli(3.5)).toBe(3500);
    expect(quantityNumberToMilli(0.001)).toBe(1);
  });

  it('formata em pt-BR sem zeros à direita', () => {
    expect(formatQuantity(3.5)).toBe('3,5');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(null)).toBe('0');
    expect(formatQuantity(1000)).toBe('1.000');
  });

  /**
   * O critério de aceite do conserto, na quantidade: o que `formatQuantity` imprime na
   * tela de detalhe, `parseQuantityMilli` lê de volta como o mesmo número. Antes,
   * ler-copiar-colar `1.000` devolvia 1.
   */
  it('fecha o round-trip tela → formulário', () => {
    for (const value of [1000, 1500, 3.5, 0.001, 2, 10_000]) {
      expect(parseQuantityMilli(formatQuantity(value))).toBe(quantityNumberToMilli(value));
    }
  });
});

describe('lineTotalCents', () => {
  it('multiplica quantidade fracionária pelo preço unitário', () => {
    // 3,5 × R$ 10,50 = R$ 36,75
    expect(lineTotalCents(3500, 1050)).toBe(3675);
  });

  it('arredonda HALF_UP', () => {
    // 0,5 × 5 centavos = 2,5 centavos → 3
    expect(lineTotalCents(500, 5)).toBe(3);
    // 0,5 × 3 centavos = 1,5 centavos → 2
    expect(lineTotalCents(500, 3)).toBe(2);
    // 0,5 × 4 centavos = 2 centavos exatos → 2
    expect(lineTotalCents(500, 4)).toBe(2);
  });

  it('não sofre erro de ponto flutuante em quantidades de 3 casas', () => {
    // 0,001 × R$ 100.000,00 = R$ 100,00
    expect(lineTotalCents(1, 10_000_000)).toBe(10_000);
  });

  it('devolve zero para linha incompleta', () => {
    expect(lineTotalCents(0, 1050)).toBe(0);
    expect(lineTotalCents(3500, 0)).toBe(0);
  });
});

describe('computeCostBreakdown', () => {
  it('soma peças, mão de obra, desconto e acréscimo', () => {
    const result = computeCostBreakdown({
      lines: [
        { quantityMilli: 2000, unitPriceCents: 5000 }, // R$ 100,00
        { quantityMilli: 1000, unitPriceCents: 2500 }, // R$ 25,00
      ],
      labourCents: 8000,
      discountCents: 1000,
      surchargeCents: 500,
    });

    expect(result.itemsCents).toBe(12_500);
    expect(result.discountBaseCents).toBe(21_000);
    expect(result.totalCents).toBe(20_000);
    expect(result.lineTotals).toEqual([10_000, 2500]);
  });

  it('sem nenhuma peça o total é mão de obra − desconto + acréscimo, nunca null', () => {
    const result = computeCostBreakdown({
      lines: [],
      labourCents: 15_000,
      discountCents: 0,
      surchargeCents: 0,
    });

    expect(result.itemsCents).toBe(0);
    expect(result.totalCents).toBe(15_000);
  });

  it('arredonda POR LINHA, não sobre a soma', () => {
    // Duas linhas de 2,5 centavos. Por linha: 3 + 3 = 6.
    // Sobre a soma seria round(5) = 5 — é essa divergência que a regra evita.
    const result = computeCostBreakdown({
      lines: [
        { quantityMilli: 500, unitPriceCents: 5 },
        { quantityMilli: 500, unitPriceCents: 5 },
      ],
      labourCents: 0,
      discountCents: 0,
      surchargeCents: 0,
    });

    expect(result.lineTotals).toEqual([3, 3]);
    expect(result.itemsCents).toBe(6);
  });

  it('deixa o total negativo aparecer quando o desconto excede a base', () => {
    const result = computeCostBreakdown({
      lines: [],
      labourCents: 1000,
      discountCents: 5000,
      surchargeCents: 0,
    });

    expect(result.discountBaseCents).toBe(1000);
    expect(result.totalCents).toBe(-4000);
  });
});

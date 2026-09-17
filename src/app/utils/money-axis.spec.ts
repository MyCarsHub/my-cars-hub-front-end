import { describe, it, expect } from 'vitest';

import { MONEY_AXIS_FLOOR_CENTS, moneyAxisTopFor } from './money-axis';

describe('moneyAxisTopFor', () => {
  /**
   * O DEFEITO ORIGINAL: o eixo era o proprio pico, entao a barra mais alta
   * encostava sempre no teto e R$ 150 desenhava a mesma montanha que R$ 150.000.
   */
  it('o pico NAO encosta no teto', () => {
    const top = moneyAxisTopFor([1_500_00]);

    expect(top).toBe(2_000_00);
    expect(top).toBeGreaterThan(1_500_00);
  });

  it('serie pequena e serie grande ganham escalas de grandezas diferentes', () => {
    expect(moneyAxisTopFor([150_00])).toBe(200_00);
    expect(moneyAxisTopFor([150_000_00])).toBe(200_000_00);
  });

  /** Serie zerada tinha `max = 1` — um eixo que nao significava nada. */
  describe('piso', () => {
    it('serie inteiramente zerada recebe o piso, nao 1', () => {
      expect(moneyAxisTopFor([0, 0, 0, 0, 0, 0])).toBe(MONEY_AXIS_FLOOR_CENTS);
    });

    it('serie vazia tambem recebe o piso', () => {
      expect(moneyAxisTopFor([])).toBe(MONEY_AXIS_FLOOR_CENTS);
    });

    /** Sem piso, R$ 5 encheria o grafico como se fosse um mes cheio. */
    it('valor irrisorio nao enche o grafico', () => {
      const top = moneyAxisTopFor([5_00]);

      expect(top).toBe(MONEY_AXIS_FLOOR_CENTS);
      // 5 de 100 = 5% da altura: um risco no chao, que e a verdade.
      expect((5_00 / top) * 100).toBeLessThan(10);
    });

    it('o piso e R$ 100,00 — dezenas de reais e a menor grandeza que significa algo aqui', () => {
      expect(MONEY_AXIS_FLOOR_CENTS).toBe(100_00);
    });
  });

  describe('arredondamento redondo (1, 2 ou 5 x potencia de 10)', () => {
    const cases: ReadonlyArray<[number, number]> = [
      [101_00, 200_00],
      [250_00, 500_00],
      [600_00, 1_000_00],
      [1_000_00, 1_000_00],
      [4_300_00, 5_000_00],
      [12_000_00, 20_000_00],
    ];

    for (const [peak, expected] of cases) {
      it(`pico ${peak} → topo ${expected}`, () => {
        expect(moneyAxisTopFor([peak])).toBe(expected);
      });
    }

    it('o topo nunca fica abaixo do pico', () => {
      for (const peak of [1, 99_99, 100_01, 333_33, 7_777_77, 1_234_567_89]) {
        expect(moneyAxisTopFor([peak])).toBeGreaterThanOrEqual(peak);
      }
    });
  });

  it('considera o maior valor da serie, nao o ultimo', () => {
    expect(moneyAxisTopFor([1_500_00, 300_00, 900_00])).toBe(2_000_00);
  });

  /** Faturamento nao e negativo; se vier, nao pode encolher o eixo. */
  it('ignora valor negativo em vez de deixar o eixo desabar', () => {
    expect(moneyAxisTopFor([-5_000_00, 300_00])).toBe(500_00);
  });
});

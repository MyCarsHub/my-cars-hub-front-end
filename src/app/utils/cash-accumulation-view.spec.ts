import { describe, it, expect } from 'vitest';

import {
  CashAccumulationMonth,
  CashAccumulationResponse,
} from '../types/cash-accumulation.types';
import { cashAccumulationView } from './cash-accumulation-view';

/** Mes com acumulado subindo `perDay` centavos por dia ate `throughDay`. */
function month(
  iso: string,
  daysInMonth: number,
  throughDay: number,
  perDay: number,
): CashAccumulationMonth {
  const points = Array.from({ length: throughDay }, (_, i) => ({
    day: i + 1,
    dayCents: perDay,
    cumulativeCents: perDay * (i + 1),
  }));
  return {
    month: iso,
    daysInMonth,
    throughDay,
    points,
    totalCents: perDay * throughDay,
  };
}

function response(over: Partial<CashAccumulationResponse> = {}): CashAccumulationResponse {
  const current = month('2026-09', 30, 17, 20_000);
  const previous = month('2026-08', 31, 31, 10_000);
  const previousSameDay = 10_000 * 17;
  return {
    current,
    previous,
    previousSameDayCents: previousSameDay,
    deltaCents: current.totalCents - previousSameDay,
    ...over,
  };
}

describe('cashAccumulationView', () => {
  it('o total do mes corrente e o numero que puxa o cartao', () => {
    const view = cashAccumulationView(response());

    expect(view.totalCents).toBe(340_000);
    expect(view.total).toContain('3.400,00');
  });

  /**
   * DECISAO 1 — hoje ainda esta acontecendo. A curva corrente PARA no
   * `throughDay`; desenhar o resto do mes faria "o faturamento despencou hoje",
   * que e o defeito de bucket parcial.
   */
  describe('curva do mes corrente', () => {
    it('vai so ate hoje', () => {
      const view = cashAccumulationView(response());

      expect(view.current.points).toHaveLength(17);
      expect(view.current.points.at(-1)?.day).toBe(17);
      expect(view.current.throughDay).toBe(17);
    });

    it('nao desenha dia depois de hoje nem que o contrato mande', () => {
      const current = month('2026-09', 30, 17, 20_000);
      // Um ponto a mais, como um backend fora de contrato mandaria.
      current.points.push({ day: 18, cumulativeCents: 0, dayCents: 0 });

      const view = cashAccumulationView(response({ current }));

      expect(view.current.points.map((p) => p.day)).not.toContain(18);
    });

    it('usa o acumulado do contrato, sem somar de novo', () => {
      const view = cashAccumulationView(response());

      // 20.000 por dia x 17 dias, direto de `cumulativeCents`.
      expect(view.current.points.at(-1)?.cents).toBe(340_000);
    });
  });

  /**
   * DECISAO 2 — o mes anterior vem INTEIRO e serve de referencia: mostra onde
   * ele chegou. Cortar no dia de hoje esconderia exatamente essa informacao. O
   * que impede a leitura de "previsao" e a apresentacao (tracejado, esmaecido,
   * rotulado), nao o corte do dado.
   */
  it('a curva do mes anterior fica inteira', () => {
    const view = cashAccumulationView(response());

    expect(view.previous.points).toHaveLength(31);
    expect(view.previous.points.at(-1)?.day).toBe(31);
  });

  /**
   * O desenho da referencia para no dia de hoje (o eixo X sai da serie
   * principal), entao o rotulo NAO pode dizer so "agosto": prometeria o mes
   * inteiro e entregaria meio mes.
   */
  it('o rotulo da referencia nao promete o mes inteiro', () => {
    const view = cashAccumulationView(response());

    expect(view.referenceLabel).toBe('agosto até aqui');
    expect(view.referenceLabel).not.toBe('agosto');
  });

  it('o eixo comporta o maior dos dois meses', () => {
    expect(cashAccumulationView(response()).axisDays).toBe(31);
  });

  /**
   * O teto do eixo Y sai das DUAS series. O mes anterior vem INTEIRO e o
   * corrente so ate hoje, entao o pico da referencia costuma ser o maior — e um
   * teto calculado so sobre o mes corrente faria a curva de comparacao estourar
   * o topo, justamente a linha que precisa caber para o dono ver onde chegou.
   */
  describe('teto do eixo Y', () => {
    it('cabe a curva do mes ANTERIOR quando ela e a maior', () => {
      // corrente: 17 x 20.000 = 340.000 · anterior: 31 x 30.000 = 930.000
      const view = cashAccumulationView(
        response({ previous: month('2026-08', 31, 31, 30_000) }),
      );

      expect(view.axisTopCents).toBeGreaterThanOrEqual(930_000);
    });

    it('cabe a curva CORRENTE quando ela e a maior', () => {
      const current = month('2026-09', 30, 17, 60_000);
      const view = cashAccumulationView(response({ current }));

      expect(view.axisTopCents).toBeGreaterThanOrEqual(current.totalCents);
    });

    /** Piso de dinheiro: serie zerada nao vira eixo de R$ 0,05. */
    it('mes zerado nos dois lados ainda recebe o piso de dinheiro', () => {
      const view = cashAccumulationView(
        response({
          current: month('2026-09', 30, 17, 0),
          previous: month('2026-08', 31, 31, 0),
          previousSameDayCents: 0,
          deltaCents: 0,
        }),
      );

      expect(view.axisTopCents).toBe(100_00);
    });
  });

  /** DECISAO 3 — o cartao tem de saber dar ma noticia. */
  describe('comparacao', () => {
    it('acima do mes passado', () => {
      const view = cashAccumulationView(response());

      expect(view.trend).toBe('up');
      expect(view.comparison).toBe('100% acima de agosto até aqui');
    });

    it('ABAIXO do mes passado aparece como abaixo, nao escondido', () => {
      const current = month('2026-09', 30, 17, 5_000);
      const view = cashAccumulationView(
        response({
          current,
          previousSameDayCents: 170_000,
          deltaCents: current.totalCents - 170_000,
        }),
      );

      expect(view.trend).toBe('down');
      expect(view.comparison).toBe('50% abaixo de agosto até aqui');
    });

    it('empate diz empate', () => {
      const view = cashAccumulationView(
        response({ previousSameDayCents: 340_000, deltaCents: 0 }),
      );

      expect(view.trend).toBe('flat');
      expect(view.comparison).toBe('igual a agosto até aqui');
    });

    /**
     * Sem base no mes passado, percentual nao diz nada ("infinito por cento
     * acima"): a frase cai no valor absoluto, que o dono consegue usar.
     */
    it('mes passado zerado no mesmo dia cai no valor absoluto', () => {
      const view = cashAccumulationView(
        response({ previousSameDayCents: 0, deltaCents: 340_000 }),
      );

      expect(view.comparison).toContain('3.400,00');
      expect(view.comparison).toContain('acima de agosto');
      expect(view.comparison).not.toContain('%');
    });

    it('usa o delta pronto do contrato, nao recalcula', () => {
      // Delta deliberadamente incoerente com os totais: quem manda e o contrato.
      const view = cashAccumulationView(response({ deltaCents: -1 }));

      expect(view.trend).toBe('down');
    });
  });

  /** Zero e zero: a curva fica no chao COM pontos, e o cartao explica. */
  describe('mes sem nada recebido', () => {
    const vazio = cashAccumulationView(
      response({
        current: month('2026-09', 30, 17, 0),
        previousSameDayCents: 0,
        deltaCents: 0,
      }),
    );

    it('marca o estado vazio', () => {
      expect(vazio.isEmpty).toBe(true);
    });

    it('a curva existe e fica no chao — nao some', () => {
      expect(vazio.current.points).toHaveLength(17);
      expect(vazio.current.points.every((p) => p.cents === 0)).toBe(true);
    });
  });
});

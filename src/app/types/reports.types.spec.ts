import { describe, it, expect } from 'vitest';

import { VehicleRoiItem, aggregateFleetRoi } from './reports.types';

function vehicle(over: Partial<VehicleRoiItem> = {}): VehicleRoiItem {
  return {
    vehicleId: 'v-1',
    plate: 'ABC1D23',
    brand: 'Fiat',
    model: 'Argo',
    returnedCents: 0,
    returnBreakdown: { rentalCents: 0, saleCents: 0 },
    costCents: 0,
    costBreakdown: {
      acquisitionCents: 0,
      maintenanceCents: 0,
      insuranceCents: 0,
      fineCents: 0,
      incidentCents: 0,
    },
    netCents: 0,
    roiPercent: null,
    paybackMonth: null,
    paybackReached: false,
    remainingToPaybackCents: 0,
    ...over,
  };
}

/** Carro normal: custo conhecido e retorno medido. */
function priced(id: string, costCents: number, returnedCents: number): VehicleRoiItem {
  return vehicle({
    vehicleId: id,
    costCents,
    returnedCents,
    netCents: returnedCents - costCents,
    roiPercent: ((returnedCents - costCents) / costCents) * 100,
  });
}

/** Carro sem preco de compra: o backend manda custo 0 e ROI nulo. */
function unpriced(id: string, returnedCents: number): VehicleRoiItem {
  return vehicle({ vehicleId: id, costCents: 0, returnedCents, netCents: returnedCents });
}

describe('aggregateFleetRoi', () => {
  it('agrega custo e retorno da frota', () => {
    const summary = aggregateFleetRoi([
      priced('a', 10_000_00, 15_000_00),
      priced('b', 10_000_00, 5_000_00),
    ]);

    // (20.000 devolvidos - 20.000 de custo) / 20.000 = 0%
    expect(summary.roiPercent).toBe(0);
    expect(summary.netCents).toBe(0);
    expect(summary.known).toBe(2);
    expect(summary.total).toBe(2);
  });

  /**
   * A ARMADILHA DESTE NO. O carro sem preco de compra chega com `costCents = 0` e
   * retorno CHEIO. Somando cegamente, o custo total sai subestimado e o
   * percentual da frota sai INFLADO — e para o lado otimista, que num produto de
   * dinheiro e o pior lado. Um unico carro sem preco contamina a frota inteira.
   */
  describe('veiculo sem preco de compra', () => {
    const frota = [priced('a', 10_000_00, 12_000_00), unpriced('b', 50_000_00)];

    it('NAO infla o ROI com o retorno do carro sem custo', () => {
      const summary = aggregateFleetRoi(frota);

      // Somando tudo daria (62.000 - 10.000) / 10.000 = +520%.
      // A base correta e so o carro 'a': (12.000 - 10.000) / 10.000 = +20%.
      expect(summary.roiPercent).toBe(20);
      expect(summary.roiPercent).not.toBe(520);
    });

    it('o liquido fala da MESMA base que o percentual', () => {
      const summary = aggregateFleetRoi(frota);

      // 2.000 do carro 'a'. Incluir 'b' daria 52.000 e a legenda passaria a
      // descrever uma populacao diferente da do numero grande.
      expect(summary.netCents).toBe(2_000_00);
    });

    it('conta a base para a tela poder declarar o que ficou de fora', () => {
      const summary = aggregateFleetRoi(frota);

      expect(summary.known).toBe(1);
      expect(summary.total).toBe(2);
    });
  });

  /** Frota inteira sem preco: indeterminado, nao zero — nao se afirma nada. */
  it('devolve ROI nulo quando NENHUM veiculo tem custo conhecido', () => {
    const summary = aggregateFleetRoi([unpriced('a', 9_000_00), unpriced('b', 1_000_00)]);

    expect(summary.roiPercent).toBeNull();
    expect(summary.netCents).toBe(0);
    expect(summary.known).toBe(0);
    expect(summary.total).toBe(2);
  });

  it('frota vazia tambem e indeterminada', () => {
    const summary = aggregateFleetRoi([]);

    expect(summary.roiPercent).toBeNull();
    expect(summary.known).toBe(0);
    expect(summary.total).toBe(0);
  });

  it('prejuizo da frota sai negativo', () => {
    const summary = aggregateFleetRoi([priced('a', 10_000_00, 4_000_00)]);

    expect(summary.roiPercent).toBe(-60);
    expect(summary.netCents).toBe(-6_000_00);
  });
});

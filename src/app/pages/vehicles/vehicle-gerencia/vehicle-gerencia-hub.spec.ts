import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleGerenciaHub } from './vehicle-gerencia-hub';
import { VehiclesService } from '../../../services/vehicles.service';
import { RentalService } from '../../rentals/rental.service';
import type {
  GerenciaFinanceChunk,
  GerenciaSummary,
} from '../../../types/gerencia-summary.types';

/**
 * FEAT-0074 — a VENDA do veículo no hub de gerência.
 *
 * O `resultCents` do backend passou a ser `receita + venda − investido`. Sem
 * mostrar a venda, o Resultado ficava impossível de conferir: o usuário via
 * investido e receita, somava de cabeça e achava outro número. Aqui a venda é
 * linha PRÓPRIA (com a data) e a legenda do Resultado diz a conta.
 */
describe('VehicleGerenciaHub — venda do veículo (FEAT-0074)', () => {
  const VEHICLE_ID = 'veh-1';

  const financeBase: GerenciaFinanceChunk = {
    purchaseCostCents: 5_000_000,
    totalMaintenanceExpenseCents: 0,
    totalFinancingPaidCents: 0,
    totalRentalRevenueCents: 1_200_000,
    totalRentalReceivedCents: 1_200_000,
    totalInvestedCents: 5_000_000,
    saleValueCents: null,
    saleDate: null,
    resultCents: -3_800_000,
  };

  let fixture: ComponentFixture<VehicleGerenciaHub>;

  /**
   * O hub monta listas filhas pesadas (financiamentos, seguros, manutenções) e
   * cada uma chama métodos próprios do `VehiclesService` ao inicializar. Este
   * teste é sobre o KPI de VENDA, então o stub responde a QUALQUER método com
   * uma página vazia e a qualquer sinal com valor neutro — enumerar os métodos
   * um a um só produziria um teste que quebra quando uma lista filha muda.
   */
  function serviceStub(overrides: Record<string, unknown>): unknown {
    const emptyPage = { content: [], page: 0, size: 20, total: 0 };
    const cache = new Map<string, unknown>();
    return new Proxy(overrides, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (!cache.has(prop)) {
          // MÉTODO vs SINAL pelo prefixo verbal: `listFleetFinancings` é
          // método e `financings` é sinal — decidir por sufixo confundia os
          // dois e devolvia um signal onde o componente faz `.subscribe()`.
          const isMethod = /^(list|get|load|create|update|delete|remove|sell|undo|upload|fetch|search)/.test(
            prop,
          );
          cache.set(
            prop,
            isMethod
              ? vi.fn().mockReturnValue(of(emptyPage))
              : /loading/i.test(prop)
                ? signal(false)
                : /error/i.test(prop)
                  ? signal(null)
                  : /page|size|total|count/i.test(prop)
                    ? signal(0)
                    : signal([]),
          );
        }
        return cache.get(prop);
      },
    });
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function render(finance: Partial<GerenciaFinanceChunk>): void {
    const summary: GerenciaSummary = {
      vehicle: {
        id: VEHICLE_ID,
        plate: 'ABC1D23',
        brand: 'Fiat',
        model: 'Argo',
        hodometer: 10_000,
        licensingExpiration: null,
        type: 'CAR',
        status: 'AVAILABLE',
      },
      fines: { openCount: 0, openAmountCents: 0 },
      maintenances: { openCount: 0, nextServiceDate: null },
      activeFinancing: null,
      licensing: { expiration: null, expiringSoon: false, expired: false },
      finance: { ...financeBase, ...finance },
      dates: {
        acquisitionDate: null,
        lastMaintenanceDate: null,
        nextMaintenanceDate: null,
        financingLastInstallmentDate: null,
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID } } },
        },
        {
          provide: VehiclesService,
          useValue: serviceStub({ getGerenciaSummary: vi.fn().mockReturnValue(of(summary)) }),
        },
        {
          provide: RentalService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [] })) },
        },
      ],
    });

    fixture = TestBed.createComponent(VehicleGerenciaHub);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('mostra a venda como KPI próprio, com valor e data', () => {
    render({
      saleValueCents: 4_500_000,
      saleDate: '2026-08-20',
      resultCents: 700_000,
    });

    const kpi = host().querySelector('[data-sale-kpi]');
    expect(kpi).not.toBeNull();
    const kpiText = (kpi?.textContent ?? '').replace(/\s+/g, ' ');
    expect(kpiText).toContain('Venda do veículo');
    expect(kpiText).toContain('45.000,00');
    expect(kpiText).toContain('Entrada única em 20/08/2026');
  });

  /**
   * A legenda do Resultado tem de nomear as TRÊS parcelas quando há venda —
   * é ela que torna o número conferível sem conta de cabeça.
   */
  it('explica o Resultado incluindo a venda quando ela existe', () => {
    render({
      saleValueCents: 4_500_000,
      saleDate: '2026-08-20',
      resultCents: 700_000,
    });

    expect(text()).toContain('Receita + venda, menos investimento');
    // E o número do backend é exibido como veio — a tela não recalcula.
    expect(text()).toContain('7.000,00');
  });

  it('sem venda, nada muda: nenhum KPI de venda e a legenda antiga', () => {
    render({});

    expect(host().querySelector('[data-sale-kpi]')).toBeNull();
    expect(text()).not.toContain('Venda do veículo');
    expect(text()).toContain('Receita menos investimento');
  });

  /** Venda de R$ 0 é venda: o KPI aparece (o `null` é que significa "sem venda"). */
  it('trata venda de valor zero como venda existente, não como ausência', () => {
    render({ saleValueCents: 0, saleDate: '2026-08-20', resultCents: -3_800_000 });

    expect(host().querySelector('[data-sale-kpi]')).not.toBeNull();
    expect(text()).toContain('Receita + venda, menos investimento');
  });
});

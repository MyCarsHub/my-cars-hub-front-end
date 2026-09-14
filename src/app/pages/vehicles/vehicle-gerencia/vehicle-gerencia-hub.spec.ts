import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleGerenciaHub } from './vehicle-gerencia-hub';
import { VehiclesService } from '../../../services/vehicles.service';
import { RentalService } from '../../rentals/rental.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
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

/**
 * FIX-0087 — o hub era um dos tres retardatarios do caminho de erro compartilhado.
 *
 * Tinha um `extractError` proprio que aceitava QUALQUER objeto com `message`: numa
 * falha de rede ele lia o `TypeError` do navegador e escrevia "Failed to fetch" na
 * tela. Tambem ignorava `fieldErrors` e nao reivindicava o erro, entao um 4xx
 * ganhava a mensagem na tela E o toast da rede de seguranca por cima.
 */
describe('VehicleGerenciaHub — caminho de erro compartilhado (FIX-0087)', () => {
  const VEHICLE_ID = 'veh-1';

  let fixture: ComponentFixture<VehicleGerenciaHub>;
  let notifyError: ReturnType<typeof vi.fn>;

  /**
   * Mesma ideia do stub do bloco acima — as listas filhas do hub chamam metodos
   * proprios do `VehiclesService` ao inicializar, e enumera-los um a um so faria
   * um teste que quebra quando uma lista filha muda. Aqui e uma copia local
   * porque este bloco monta o TestBed com o resumo FALHANDO.
   */
  function vehiclesStub(overrides: Record<string, unknown>): unknown {
    const emptyPage = { content: [], page: 0, size: 20, total: 0 };
    const cache = new Map<string, unknown>();
    return new Proxy(overrides, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (!cache.has(prop)) {
          const isMethod =
            /^(list|get|load|create|update|delete|remove|sell|undo|upload|fetch|search)/.test(prop);
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

  /** Monta o hub com o resumo e a lista de alugueis falhando como mandado. */
  function renderFailing(summaryError: unknown, rentalsError: unknown = summaryError): void {
    notifyError = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID } } },
        },
        {
          provide: VehiclesService,
          useValue: vehiclesStub({
            getGerenciaSummary: vi.fn().mockReturnValue(throwError(() => summaryError)),
          }),
        },
        {
          provide: RentalService,
          useValue: { list: vi.fn().mockReturnValue(throwError(() => rentalsError)) },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(VehicleGerenciaHub);
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falha de rede mostra o fallback em portugues, nao "Failed to fetch"', () => {
    renderFailing(new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }));

    expect(text()).toContain('Não foi possível carregar a gerência do veículo.');
    expect(text()).not.toContain('Failed to fetch');
  });

  it('o mesmo vale para a lista de alugueis', () => {
    renderFailing(
      new HttpErrorResponse({ status: 500, error: { message: 'Erro no servidor.' } }),
      new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }),
    );

    expect(text()).not.toContain('Failed to fetch');
  });

  it('mostra fieldErrors, que o extrator local ignorava', () => {
    renderFailing(
      new HttpErrorResponse({
        status: 400,
        error: { fieldErrors: { vehicleId: 'Veículo não pertence a esta empresa.' } },
      }),
    );

    expect(text()).toContain('Veículo não pertence a esta empresa.');
  });

  it('reivindica o erro — a mensagem na tela nao ganha um toast por cima', () => {
    vi.useFakeTimers();
    const failure = new HttpErrorResponse({
      status: 400,
      error: { message: 'Veículo inválido.' },
    });
    renderFailing(failure);

    TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
    vi.runAllTimers();

    expect(text()).toContain('Veículo inválido.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  /** Controle: um erro que NINGUEM reivindicou continua toastando. */
  it('controle: erro nao reivindicado ainda dispara a rede de seguranca', () => {
    vi.useFakeTimers();
    renderFailing(new HttpErrorResponse({ status: 500, error: { message: 'Erro.' } }));
    const orphan = new HttpErrorResponse({ status: 400, error: { message: 'Sem dono.' } });

    TestBed.inject(ApiErrorService).scheduleSafetyNet(orphan);
    vi.runAllTimers();

    expect(notifyError).toHaveBeenCalledWith('Sem dono.');
  });
});

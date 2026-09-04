import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import type {
  AdminCompanyOperations,
  AdminCompanyDetail as AdminCompanyDetailDto,
} from '../../../types/admin-company.types';
import { formatBRL } from '../../../types/dashboard.types';

/** Empresa recém-criada: o backend manda zeros, nunca null. */
const ZERO_OPERATIONS: AdminCompanyOperations = {
  rentals: {
    total: 0,
    activeTotal: 0,
    closedTotal: 0,
    closedAmountCents: 0,
    completedTotal: 0,
    completedAmountCents: 0,
    canceledTotal: 0,
    paidAmountCents: 0,
  },
  contracts: { total: 0, generatedTotal: 0, signedTotal: 0 },
  vehicles: { total: 0, activeTotal: 0 },
  drivers: { total: 0, workingTotal: 0 },
  fines: { total: 0, pendingTotal: 0, amountCents: 0 },
  maintenances: { total: 0, costCents: 0 },
  /** Contrato: listas vazias, nunca `null`, mesmo sem venda. */
  sales: { sales: [], undos: [] },
};

/**
 * Feedback standard (phase 3): the LOAD failure and the OPERATION failure use
 * separate inline surfaces (`error` / `actionError`), and neither ever produces
 * a toast — `ApiErrorService` claims the error and disarms the safety net.
 */
describe('AdminCompanyDetail — erros do backend', () => {
  const COMPANY: AdminCompanyDetailDto = {
    id: 'co-1',
    name: 'Locadora Alfa',
    documentMasked: '12.***.***/0001-**',
    status: 'ACTIVE',
    active: true,
    createdAt: '2025-01-01T00:00:00Z',
    modifiedAt: null,
    subscription: null,
    members: [],
    chargeIntegration: null,
    /** Bloco sempre presente no contrato; campos nulos = sem cadastro. */
    registration: {
      phone: null,
      email: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressDistrict: null,
      addressCep: null,
      addressCity: null,
      addressUf: null,
      representativeName: null,
      representativeRole: null,
    },
    operations: ZERO_OPERATIONS,
  };

  let detail: ReturnType<typeof signal<AdminCompanyDetailDto | null>>;
  let loadDetail: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let startImpersonation: ReturnType<typeof vi.fn>;

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) },
        },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail,
            detailLoading: signal(false),
            statusUpdating: signal(false),
            loadDetail,
            updateStatus,
            clearDetail: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            success: notifySuccess,
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
        {
          provide: ImpersonationService,
          useValue: { start: startImpersonation, active: () => false },
        },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    detail = signal<AdminCompanyDetailDto | null>(null);
    loadDetail = vi.fn().mockReturnValue(of(COMPANY));
    updateStatus = vi.fn();
    notifyError = vi.fn();
    notifySuccess = vi.fn();
    startImpersonation = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra a falha de carregamento inline, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 404,
      error: { message: 'Empresa não encontrada.' },
    });
    loadDetail.mockReturnValue(throwError(() => error));
    configure();

    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Empresa não encontrada.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('mostra a falha da suspensão dentro do diálogo, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Empresa possui aluguéis ativos.' },
    });
    detail.set(COMPANY);
    updateStatus.mockReturnValue(throwError(() => error));
    configure();

    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      openStatusDialog: () => void;
      confirmStatusChange: () => void;
      confirmControl: { setValue: (v: string) => void };
    };
    component.openStatusDialog();
    component.confirmControl.setValue('SUSPENDER');
    component.confirmStatusChange();
    fixture.detectChanges();

    const banners = fixture.nativeElement.querySelectorAll('app-alert-banner');
    expect(banners.length).toBe(1);
    expect(banners[0]?.textContent).toContain('Empresa possui aluguéis ativos.');

    expect(notifySuccess).not.toHaveBeenCalled();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

/**
 * Bloco "Operação": o consolidado que o suporte lê em vez de abrir o banco.
 *
 * O que precisa ficar travado aqui é a SEMÂNTICA dos rótulos — valor
 * contratado (`closedAmountCents`) e valor recebido (`paidAmountCents`)
 * divergem por natureza, e trocar um pelo outro faria o admin dar uma resposta
 * errada ao cliente.
 */
describe('AdminCompanyDetail — bloco de operação', () => {
  const OPERATIONS: AdminCompanyOperations = {
    rentals: {
      total: 42,
      activeTotal: 7,
      closedTotal: 38,
      closedAmountCents: 1_234_50,
      completedTotal: 31,
      completedAmountCents: 980_00,
      canceledTotal: 4,
      paidAmountCents: 765_43,
    },
    contracts: { total: 30, generatedTotal: 25, signedTotal: 12 },
    vehicles: { total: 15, activeTotal: 13 },
    drivers: { total: 9, workingTotal: 6 },
    fines: { total: 5, pendingTotal: 2, amountCents: 320_00 },
    maintenances: { total: 11, costCents: 4_500_00 },
    sales: {
      sales: [
        {
          vehicleId: 'veh-1',
          vehiclePlate: 'ABC1D23',
          buyerName: 'Maria Compradora',
          saleDate: '2026-08-20',
          saleValueCents: 4_500_000,
          authorName: 'Operador Um',
          createdAt: '2026-08-20T10:00:00Z',
        },
        {
          vehicleId: 'veh-2',
          vehiclePlate: 'XYZ9K88',
          buyerName: 'José Comprador',
          saleDate: '2026-07-05',
          saleValueCents: 3_000_000,
          authorName: null,
          createdAt: '2026-07-05T09:00:00Z',
        },
      ],
      undos: [
        {
          vehicleId: 'veh-3',
          vehiclePlate: 'QRS4T56',
          state: 'ACTIVE',
          reason: 'Comprador desistiu',
          authorName: 'Operador Dois',
          createdAt: '2026-08-25T12:00:00Z',
        },
        {
          vehicleId: 'veh-4',
          vehiclePlate: null,
          state: 'UNDO_REFUSED',
          reason: 'Sem vaga no plano',
          authorName: 'Operador Três',
          createdAt: '2026-08-26T08:30:00Z',
        },
      ],
    },
  };

  const BASE: AdminCompanyDetailDto = {
    id: 'co-1',
    name: 'Locadora Alfa',
    documentMasked: '12.***.***/0001-**',
    status: 'ACTIVE',
    active: true,
    createdAt: '2025-01-01T00:00:00Z',
    modifiedAt: null,
    subscription: null,
    members: [],
    chargeIntegration: null,
    /** Bloco sempre presente no contrato; campos nulos = sem cadastro. */
    registration: {
      phone: null,
      email: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressDistrict: null,
      addressCep: null,
      addressCity: null,
      addressUf: null,
      representativeName: null,
      representativeRole: null,
    },
    operations: ZERO_OPERATIONS,
  };

  function render(operations: AdminCompanyOperations): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) },
        },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail: signal<AdminCompanyDetailDto | null>({ ...BASE, operations }),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            loadDetail: vi.fn().mockReturnValue(of({ ...BASE, operations })),
            updateStatus: vi.fn(),
            clearDetail: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('mostra os sete grupos com contagens e valores em BRL', () => {
    const el = render(OPERATIONS);

    const block = el.querySelector('[data-testid="company-operations"]');
    expect(block).not.toBeNull();
    // Sete desde o FEAT-0076: "Vendas de veículo" entrou no consolidado.
    expect(el.querySelectorAll('[data-testid="operation-group"]').length).toBe(7);

    const titles = Array.from(block!.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(titles).toEqual([
      'Aluguéis',
      'Contratos',
      'Veículos',
      'Motoristas',
      'Multas',
      'Manutenções',
      'Vendas de veículo',
    ]);

    const text = block!.textContent ?? '';
    // Contagens
    expect(text).toContain('42');
    expect(text).toContain('13');
    // Dinheiro — contratado e recebido são valores DIFERENTES e ambos aparecem.
    expect(text).toContain(formatBRL(OPERATIONS.rentals.closedAmountCents));
    expect(text).toContain(formatBRL(OPERATIONS.rentals.paidAmountCents));
    expect(formatBRL(OPERATIONS.rentals.closedAmountCents)).not.toBe(
      formatBRL(OPERATIONS.rentals.paidAmountCents),
    );
    expect(text).toContain(formatBRL(OPERATIONS.maintenances.costCents));
  });

  it('rotula a semântica sem chamar nada de "faturamento"', () => {
    const text = render(OPERATIONS).querySelector('[data-testid="company-operations"]')!
      .textContent!;

    expect(text).toContain('Valor contratado');
    expect(text).toContain('soma dos não cancelados');
    expect(text).toContain('Recebido');
    expect(text).toContain('cobranças pagas');
    expect(text).toContain('Assinados digitalmente');
    expect(text).toContain('assinatura em papel não entra');
    // Multas e manutenções: dinheiro exclui canceladas, quantidade não.
    expect(text).toContain('exclui canceladas');
    expect(text.toLowerCase()).not.toContain('faturamento');
  });

  it('empresa zerada renderiza zeros, sem undefined e sem quebrar os grupos', () => {
    const block = render(ZERO_OPERATIONS).querySelector('[data-testid="company-operations"]')!;

    // Sete grupos desde o FEAT-0076 (o de vendas entrou zerado como os outros).
    expect(block.querySelectorAll('[data-testid="operation-group"]').length).toBe(7);

    const values = Array.from(block.querySelectorAll('dd')).map((d) => d.textContent?.trim());
    // 20 métricas + as 3 do grupo de vendas.
    expect(values.length).toBe(23);
    expect(values.every((v) => v === '0' || v === formatBRL(0))).toBe(true);
    expect(block.textContent).not.toContain('undefined');
    expect(block.textContent).not.toContain('NaN');

    // Zerado é atenuado com gray-500 (4,8:1), nunca gray-400 — WCAG AA.
    const dd = block.querySelector('dd')!;
    expect(dd.className).toContain('text-gray-500');
    expect(dd.className).not.toContain('text-gray-400');
  });
});

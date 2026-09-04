import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import type {
  AdminCompanyOperations,
  AdminCompanyDetail as AdminCompanyDetailDto,
} from '../../../types/admin-company.types';
import { ImpersonationState } from '../../../types/impersonation.types';

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

const SESSION: ImpersonationState = {
  sessionId: 'sess-1',
  companyId: 'co-1',
  companyName: 'Locadora Alfa',
  startedAt: '2026-01-01T12:00:00Z',
  expiresAt: '2026-01-01T12:15:00Z',
  clockOffsetMs: 0,
};

/**
 * Ponto de partida da feature: o admin abre a sessão somente-leitura a partir do
 * detalhe da empresa e é levado ao contexto do tenant.
 */
describe('AdminCompanyDetail — abrir "ver como empresa"', () => {
  let start: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

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
            detail: signal<AdminCompanyDetailDto | null>(COMPANY),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            loadDetail: vi.fn().mockReturnValue(of(COMPANY)),
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
        { provide: ImpersonationService, useValue: { start, active: () => false } },
      ],
    });
    TestBed.inject(Router).navigate = navigate as unknown as Router['navigate'];
  }

  function impersonationButton(host: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Ver como empresa'),
    );
  }

  beforeEach(() => {
    start = vi.fn().mockReturnValue(of(SESSION));
    navigate = vi.fn();
  });

  it('expõe o botão de abrir a sessão no cabeçalho da empresa', () => {
    configure();
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    expect(impersonationButton(fixture.nativeElement as HTMLElement)).toBeDefined();
  });

  it('abre a sessão e leva o admin ao contexto da empresa', () => {
    configure();
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    impersonationButton(fixture.nativeElement as HTMLElement)?.click();
    fixture.detectChanges();

    expect(start).toHaveBeenCalledWith('co-1');
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('mostra a falha inline e NÃO navega quando o backend recusa', () => {
    start = vi
      .fn()
      .mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 404, error: { message: 'Empresa não encontrada.' } }),
        ),
      );
    configure();
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    impersonationButton(fixture.nativeElement as HTMLElement)?.click();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Empresa não encontrada.');
    expect(navigate).not.toHaveBeenCalled();
  });
});

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
import type { AdminCompanyDetail as AdminCompanyDetailDto } from '../../../types/admin-company.types';

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
  };

  let detail: ReturnType<typeof signal<AdminCompanyDetailDto | null>>;
  let loadDetail: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;

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

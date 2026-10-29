import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { AdminTrialService } from '../../../services/admin-trial.service';
import type {
  AdminCompanyDetail as AdminCompanyDetailDto,
  AdminCompanySubscriptionSnapshot,
} from '../../../types/admin-company.types';

/**
 * Admin v2 P0 — "Estender teste" na página da empresa. Arquivo próprio para não
 * colidir com a trilha B, que edita `admin-company-detail.spec.ts`.
 */
describe('AdminCompanyDetail — Estender teste', () => {
  const SUB: AdminCompanySubscriptionSnapshot = {
    id: 'sub-1',
    planCode: 'TRIAL_MONTHLY_STRIPE',
    planName: 'Teste',
    status: 'EXPIRED',
    billingCycle: 'MONTHLY',
    gateway: 'stripe',
    externalIdMasked: null,
    trialEndsAt: '2026-10-01T12:00:00',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    nextBillingDate: null,
    cancelAtPeriodEnd: false,
  };

  const COMPANY = {
    id: 'co-1',
    name: 'Locadora Alfa',
    documentMasked: null,
    status: 'ACTIVE',
    active: true,
    createdAt: '2025-01-01T00:00:00Z',
    modifiedAt: null,
    subscription: SUB,
    members: [],
    chargeIntegration: null,
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
    operations: null,
    internal: false,
  } as unknown as AdminCompanyDetailDto;

  let detail: ReturnType<typeof signal<AdminCompanyDetailDto | null>>;
  let loadDetail: ReturnType<typeof vi.fn>;
  let extend: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;

  function mount(company: AdminCompanyDetailDto): ComponentFixture<AdminCompanyDetail> {
    detail.set(company);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) } },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail,
            detailLoading: signal(false),
            statusUpdating: signal(false),
            loadDetail,
            updateStatus: vi.fn(),
            clearDetail: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: notifySuccess, warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
        { provide: ImpersonationService, useValue: { start: vi.fn(), active: () => false } },
        { provide: AdminTrialService, useValue: { extend } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    return fixture;
  }

  function render(company: AdminCompanyDetailDto): HTMLElement {
    return mount(company).nativeElement as HTMLElement;
  }

  beforeEach(() => {
    detail = signal<AdminCompanyDetailDto | null>(null);
    loadDetail = vi.fn().mockReturnValue(of(COMPANY));
    notifySuccess = vi.fn();
    extend = vi.fn().mockReturnValue(
      of({
        companyId: 'co-1',
        days: 7,
        previousStatus: 'EXPIRED',
        status: 'TRIALING',
        trialEndsAt: '2026-11-04T12:00:00',
        emailRecipients: 2,
      }),
    );
  });

  it('mostra o botão para teste vencido e para teste em andamento', () => {
    expect(render(COMPANY).querySelector('[data-testid="extend-trial-button"]')).not.toBeNull();
    const running = { ...COMPANY, subscription: { ...SUB, status: 'TRIALING' } } as AdminCompanyDetailDto;
    expect(render(running).querySelector('[data-testid="extend-trial-button"]')).not.toBeNull();
  });

  it('não mostra o botão para assinatura paga nem sem assinatura', () => {
    const paying = { ...COMPANY, subscription: { ...SUB, status: 'ACTIVE' } } as AdminCompanyDetailDto;
    expect(render(paying).querySelector('[data-testid="extend-trial-button"]')).toBeNull();
    const none = { ...COMPANY, subscription: null } as AdminCompanyDetailDto;
    expect(render(none).querySelector('[data-testid="extend-trial-button"]')).toBeNull();
  });

  it('abre a folha, estende, avisa e recarrega a empresa', () => {
    const fixture = mount(COMPANY);
    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('[data-testid="extend-trial-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const sheet = () => host.querySelector('[data-testid="trial-extension-sheet"]');
    expect(sheet()).not.toBeNull();

    const select = host.querySelector('[data-testid="trial-reason-select"]') as HTMLSelectElement;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (host.querySelector('[data-testid="trial-extension-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(extend).toHaveBeenCalledWith('co-1', { days: 7, reason: 'NEGOTIATION', note: null });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining('avisada por e-mail'));
    expect(loadDetail).toHaveBeenCalledTimes(2);
    expect(sheet()).toBeNull();
  });
});

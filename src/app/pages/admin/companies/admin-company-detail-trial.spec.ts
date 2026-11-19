import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { revealDetail } from './company-detail.testing';
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
const OWNER_CAPS = { can: () => true, ensureLoaded: () => of(null) };

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
        // Lote 2A: estas specs exercem as acoes do Dono; o papel vem do /admin/me.
        { provide: AdminCapabilitiesService, useValue: OWNER_CAPS },
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) } },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail,
            detailLoading: signal(false),
            statusUpdating: signal(false),
            internalUpdating: signal(false),
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
    revealDetail(fixture);
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

  const extendItem = (host: HTMLElement) => host.querySelector('[data-testid="extend-trial-button"]') as HTMLButtonElement | null;

  it('no ⋮: habilitado para teste vencido e para teste em andamento', () => {
    expect(extendItem(render(COMPANY))?.disabled).toBe(false);
    const running = { ...COMPANY, subscription: { ...SUB, status: 'TRIALING' } } as AdminCompanyDetailDto;
    expect(extendItem(render(running))?.disabled).toBe(false);
  });

  it('assinatura paga ou sem assinatura: o item fica apagado com o motivo (não some)', () => {
    const paying = { ...COMPANY, subscription: { ...SUB, status: 'ACTIVE' } } as AdminCompanyDetailDto;
    const item = extendItem(render(paying));
    expect(item?.disabled).toBe(true);
    expect(item?.textContent).toContain('Só para empresas em teste');
    const none = { ...COMPANY, subscription: null } as AdminCompanyDetailDto;
    expect(extendItem(render(none))?.disabled).toBe(true);
  });

  it('plano, gateway, telefone e CEP legíveis (visual 18/11): nada de código cru', () => {
    const company = {
      ...COMPANY,
      subscription: { ...SUB, planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', status: 'ACTIVE' },
      registration: { ...COMPANY.registration, phone: '3133000003', addressCep: '30110003' },
    } as AdminCompanyDetailDto;
    const root = render(company);
    expect(root.querySelector('[data-testid="subscription-plan"]')?.textContent?.trim()).toBe('Pro');
    expect(root.querySelector('[data-testid="subscription-gateway"]')?.textContent?.trim()).toBe('Stripe');
    const registration = root.querySelector('[data-testid="company-registration"]')?.textContent ?? '';
    expect(registration).toContain('(31) 3300-0003');
    expect(registration).toContain('30110-003');
    expect(root.textContent).not.toContain('PRO_MONTHLY_STRIPE');
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

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import type { AdminCompanyDetail as AdminCompanyDetailDto } from '../../../types/admin-company.types';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminCompanyDetail } from './admin-company-detail';

const COMPANY = {
  id: 'co-1',
  name: 'Locadora Teste',
  documentMasked: null,
  status: 'ACTIVE',
  active: true,
  createdAt: null,
  modifiedAt: null,
  subscription: null,
  members: [],
  chargeIntegration: null,
  registration: {},
  operations: {
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
    sales: { sales: [], undos: [] },
  },
  internal: false,
} as unknown as AdminCompanyDetailDto;

describe('AdminCompanyDetail: atalho "Criar cupom"', () => {
  const render = (codes: AdminCapabilityCode[]): HTMLElement => {
    const granted = new Set(codes);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) } },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail: signal(COMPANY),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            loadDetail: vi.fn(() => of(COMPANY)),
            clearDetail: vi.fn(),
          },
        },
        { provide: AdminCapabilitiesService, useValue: { can: (c: AdminCapabilityCode) => granted.has(c), ensureLoaded: () => of(null) } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
        { provide: ImpersonationService, useValue: { active: signal(false) } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.resetTestingModule());

  it('leva o Dono a /admin/cupons com a empresa preenchida', () => {
    const link = render(['ver', 'cupom.gerir']).querySelector('[data-testid="create-coupon-link"]');
    expect(link?.textContent?.trim()).toBe('Criar cupom');
    expect(link?.getAttribute('href')).toBe('/admin/cupons?empresa=co-1');
  });

  it('fica escondido de quem não gere cupons', () => {
    expect(render(['ver']).querySelector('[data-testid="create-coupon-link"]')).toBeNull();
  });
});

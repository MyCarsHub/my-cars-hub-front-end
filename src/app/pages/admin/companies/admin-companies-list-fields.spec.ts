import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanies } from './admin-companies';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';

/** FEAT-0483 — campos novos da lista: cidade/UF, valor gerenciado e MRR (centavos). */
describe('AdminCompanies — campos financeiros da lista', () => {
  const BASE: AdminCompanyListItem = {
    id: 'co-1',
    name: 'Locadora Alpha',
    documentMasked: null,
    planCode: 'PRO_MONTHLY',
    planName: 'Pro',
    subscriptionStatus: 'ACTIVE',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    active: true,
    memberCount: 3,
    createdAt: null,
    internal: false,
    city: 'Campinas',
    uf: 'SP',
    managedMonthCents: 8_640_000,
    mrrCents: 29_900,
  };

  function render(companies: AdminCompanyListItem[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: signal(companies),
            loading: signal(false),
            total: signal(companies.length),
            load: vi.fn().mockReturnValue(of({ content: companies, total: companies.length })),
            updateStatus: vi.fn().mockReturnValue(of(void 0)),
            updateInternal: vi.fn().mockReturnValue(of({})),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('mostra cidade/UF, valor gerenciado e MRR formatados', () => {
    const host = render([BASE]);
    expect(text(host.querySelector('[data-testid="company-place"]'))).toBe('Campinas, SP');
    const row = text(host.querySelector('[data-row]'));
    expect(row).toContain('86.400,00');
    expect(row).toContain('299,00');
  });

  it('cadastro sem cidade/UF mostra "—" e valor ausente nunca vira R$ 0', () => {
    const host = render([{ ...BASE, city: null, uf: null, managedMonthCents: null, mrrCents: undefined }]);
    expect(text(host.querySelector('[data-testid="company-place"]'))).toBe('—');
    const row = text(host.querySelector('[data-row]'));
    expect(row).not.toContain('0,00');
  });

  it('explica a definição de "gerenciado" no texto de ajuda', () => {
    const host = render([BASE]);
    expect(text(host.querySelector('[data-testid="managed-help"]'))).toContain('vencimento');
  });
});

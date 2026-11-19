import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import { AdminHomeService } from './admin-home.service';
import { HomeCompanies } from './home-companies';

const ROW: AdminCompanyListItem = {
  id: 'c1',
  name: 'Locadora Silva',
  documentMasked: null,
  planCode: 'PRO',
  planName: 'Profissional',
  subscriptionStatus: 'ACTIVE',
  billingCycle: 'MONTHLY',
  status: 'ACTIVE',
  active: true,
  memberCount: 3,
  createdAt: null,
  internal: false,
  managedMonthCents: 1234567,
  mrrCents: 19900,
  mrrRealCents: 19900,
  vehicleCount: 12,
  driverCount: 30,
  accessHours30d: 41,
  actions30d: 220,
  lastAccessAt: null,
  health: 'HEALTHY',
} as AdminCompanyListItem;

function render() {
  TestBed.configureTestingModule({
    imports: [HomeCompanies],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AdminHomeService,
        useValue: { companies: vi.fn(() => of({ content: [ROW], page: 0, size: 20, total: 1 })) },
      },
    ],
  });
  const fixture = TestBed.createComponent(HomeCompanies);
  fixture.componentRef.setInput('scope', 'all');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/**
 * Prod, 19/11/2026: at a 1195px window with the sidebar open the cross table (10 columns, 928px)
 * sat in a 743px card and MRR and Saúde were behind a sideways scroll. The list now fits.
 */
describe('HomeCompanies — the cross table fits its card', () => {
  it('is a fit list: the table only shows where it fits, cards below lg', () => {
    const el = render();
    const wrap = el.querySelector('[data-table-wrap]')!;
    expect(wrap.getAttribute('data-fit')).toBe('table');
    expect(wrap.className).toContain('lg:block');
    expect(el.querySelector('[data-cards]')!.className).toContain('lg:hidden');
  });

  it('drops only size and usage first; MRR, Gerenciado and Último acesso never leave', () => {
    const el = render();
    const optional = [...el.querySelectorAll('[data-table] th[data-optional]')].map((th) =>
      th.textContent!.trim(),
    );
    expect(optional).toEqual(['Veíc.', 'Motor.', 'Acessos 30d', 'Ações 30d']);
    const kept = [...el.querySelectorAll('[data-table] th[scope="col"]:not([data-optional])')].map(
      (th) => th.textContent!.trim(),
    );
    expect(kept).toEqual(['Empresa', 'Plano', 'Gerenciado', 'Último acesso', 'MRR', 'Saúde']);
  });

  it('the card keeps every field, money in full with cents', () => {
    const el = render();
    const card = el.querySelector('[data-cards] [data-card]')!;
    const labels = [...card.querySelectorAll('dt')].map((dt) => dt.textContent!.trim());
    expect(labels).toEqual([
      'Plano',
      'Veíc.',
      'Motor.',
      'Gerenciado',
      'Acessos 30d',
      'Ações 30d',
      'Último acesso',
      'MRR',
      'Saúde',
    ]);
    expect(card.textContent!.replace(/\s+/g, ' ')).toContain('R$ 12.345,67');
    expect(card.textContent!.replace(/\s+/g, ' ')).toContain('R$ 199,00');
  });
});

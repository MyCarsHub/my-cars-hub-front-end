import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DashboardHome } from './dashboard-home';
import { BillingAccessService } from '../../services/billing-access.service';
import { DashboardService } from '../../services/dashboard.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { SessionService } from '../../services/session.service';
import type { DashboardSummaryDto } from '../../types/dashboard.types';

/**
 * Canvas match (2026-11-06): the measured diff list between the shipped dashboard and the owner's
 * canvas. Each test names one line of that list.
 */
vi.setConfig({ testTimeout: 30000 });

const zeroBreakdown = { maintenance: 0, fines: 0, ipva: 0, insurance: 0, financing: 0 };

function summary(): DashboardSummaryDto {
  return {
    period: { from: '2026-11-01', to: '2026-11-30' },
    alerts: {
      openFines: { count: 0, amountCents: 0 },
      openMaintenances: { count: 0 },
      expiringCnh30d: { count: 1 },
      expiringLicensing30d: { count: 0 },
      reservedRentals: { count: 0 },
      paidFinesInPeriod: { count: 0, amountCents: 0 },
      overdueCharges: { count: 3, amountCents: 214000, rentals: 3 },
    },
    fleet: { vehiclesTotal: 25, vehicleLimit: 30, driversActive: 21, driversTotal: 24, rentedNow: 21, reservedNow: 3, utilizationPct: 84 },
    finance: {
      revenueCents: 4590000,
      receivedCents: 4130000,
      expensesCents: 2288000,
      saleRevenueCents: 0,
      resultCents: 1842000,
      maintenanceExpenseCents: 0,
      fineExpenseCents: 0,
      pendingChargesCents: 0,
      overdueChargesCents: 214000,
      previousRevenueCents: 4250000,
      previousReceivedCents: 3930000,
      revenueDaily: [],
      byVehicle: [],
      byDriver: [],
      monthlyBilling: [],
      cashflow: [],
    },
    charges: { byStatus: [], ticketMedioCents: 0, completedRentalsCount: 0, ticketMedioLast6Months: [] },
    distributions: {
      rentalsByStatus: [
        { status: 'RESERVED', count: 3 },
        { status: 'ACTIVE', count: 21 },
        { status: 'COMPLETED', count: 6 },
        { status: 'CANCELED', count: 1 },
      ],
      vehiclesByStatus: [
        { status: 'AVAILABLE', count: 2 },
        { status: 'RENTED', count: 21 },
        { status: 'MAINTENANCE', count: 2 },
        { status: 'INACTIVE', count: 0 },
      ],
    },
    topOffenders: {
      vehicles: [
        { vehicleId: 'a', plate: 'QWE-4F21', brand: 'Chevrolet', model: 'Onix', count: 3, totalAmountCents: 78000 },
        { vehicleId: 'b', plate: 'HBX-2B33', brand: 'Hyundai', model: 'HB20', count: 2, totalAmountCents: 52000 },
        { vehicleId: 'c', plate: 'AAA-1A11', brand: 'Chevrolet', model: 'Onix', count: 1, totalAmountCents: 10000 },
      ],
      drivers: [],
    },
    overview: {
      monthlyResult: ['2026-09', '2026-10', '2026-11'].map((month) => ({
        month,
        revenueCents: 100000,
        costCents: 50000,
        profitCents: 50000,
        costBreakdown: zeroBreakdown,
      })),
      overdueAging: {
        days1To7: { count: 0, amountCents: 0 },
        days8To30: { count: 0, amountCents: 0 },
        daysOver30: { count: 0, amountCents: 0 },
      },
      costByCategory: [
        { category: 'MAINTENANCE', amountCents: 578000, shareBp: 0 },
        { category: 'FINES', amountCents: 60000, shareBp: 0 },
        { category: 'FINANCING', amountCents: 908000, shareBp: 0 },
      ],
      receivedByDay: { currentMonth: [], previousMonth: [] },
    },
  } as unknown as DashboardSummaryDto;
}

function render(): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DashboardHome],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      {
        provide: DashboardService,
        useValue: {
          loadOverview: vi.fn().mockReturnValue(of(summary())),
          loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
        },
      },
      { provide: BillingAccessService, useValue: { status: signal(null) } },
      { provide: FleetActivationService, useValue: { hasVehicles: vi.fn().mockReturnValue(of(true)) } },
      {
        provide: SessionService,
        useValue: { getItem: () => 'OWNER', isPlatformAdmin: () => false, getCompanyRoleFromToken: () => 'OWNER' },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardHome);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const norm = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('DashboardHome — canvas match', () => {
  it('KPI money is whole reais and the caption says "vs mês passado" for a whole-month range', () => {
    const host = render();
    const billed = norm(host.querySelector('[data-billed-card]'));
    expect(billed).toContain('R$ 45.900');
    expect(billed).not.toContain('45.900,00');
    expect(billed).toContain('vs mês passado');
    expect(norm(host.querySelector('[data-received-card]'))).toContain('R$ 41.300');
  });

  it('Despesas and Em atraso values are white (default tone), not rose', () => {
    const host = render();
    for (const sel of ['[data-expenses-kpi]', '[data-overdue-kpi]']) {
      expect(host.querySelector(sel)!.innerHTML).not.toContain('text-rose');
    }
  });

  it('no ISO date line under the pills', () => {
    const host = render();
    expect(host.querySelector('app-date-range-picker')!.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('alert chips are count + label only', () => {
    const host = render();
    const chips = Array.from(host.querySelectorAll('app-alert-chip')).map((c) => norm(c).replace(/\s/g, ''));
    expect(chips).toContain('3cobrançasvencidas');
    expect(chips).toContain('1CNHvencendo');
  });

  it('status rings use the canvas colours and the vehicles ring has no plan subtitle', () => {
    const host = render();
    const rings = Array.from(host.querySelectorAll('app-ring-legend-card')).slice(0, 2);
    expect(rings[1].querySelector('[data-subtitle]')).toBeNull();
    expect(rings[0].innerHTML.toLowerCase()).toMatch(/rgb\(59, 130, 246\)|#3b82f6/); // Reservados: blue
    expect(rings[0].innerHTML.toLowerCase()).toMatch(/rgb\(251, 113, 133\)|#fb7185/); // Cancelados: rose
    expect(rings[1].innerHTML.toLowerCase()).toMatch(/rgb\(246, 59, 4\)|#f63b04/); // Alugados: orange
  });

  it('"Para onde vai" is sorted by value, biggest first, in whole reais', () => {
    const host = render();
    const rows = Array.from(host.querySelectorAll('[data-money-section] [data-legend-row]')).map((r) => norm(r));
    expect(rows[0]).toContain('Lucro');
    expect(rows[1]).toContain('Financiamento');
    expect(rows[1]).toContain('R$ 9.080');
    expect(rows[1]).not.toContain('9.080,00');
    const values = rows.map((r) => Number(/R\$ ([\d.]+)/.exec(r)![1].replace(/\./g, '')));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('offender chips name the car (model) and add the plate only for repeated models', () => {
    const host = render();
    const chips = Array.from(host.querySelectorAll('[data-offender-chips] button')).map((b) => norm(b));
    expect(chips).toContain('HB20 2');
    expect(chips.some((c) => c.startsWith('Onix QWE-4F21'))).toBe(true);
    expect(chips.some((c) => c.startsWith('Onix AAA-1A11'))).toBe(true);
  });

  it('the newest month of Recebido vs lucro gets the lighter plate and a bold label', () => {
    const host = render();
    const bars = Array.from(host.querySelectorAll('[data-month-bar]'));
    expect(bars[2].className).toContain('bg-gray-100');
    expect(bars[2].querySelector('[data-month-label]')!.className).toContain('font-bold');
    expect(bars[0].className).not.toContain('bg-gray-100');
  });
});

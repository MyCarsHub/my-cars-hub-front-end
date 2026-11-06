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
import { ReportsService } from '../../services/reports.service';
import { SessionService } from '../../services/session.service';
import type { DashboardSummaryDto, OverviewDto } from '../../types/dashboard.types';

/**
 * Parity with the owner's prototype (Main.dc.html): the defects of the shipped FEAT-0468 page.
 * Each test fails on the old layout: orphan KPI card, revenue shown twice, cards inside cards,
 * two month selectors, an all-zero chart drawn as a hump, ROI -100% for an account with no revenue.
 */
vi.setConfig({ testTimeout: 30000 });

const zeroBreakdown = { maintenance: 0, fines: 0, ipva: 0, insurance: 0, financing: 0 };

/** An account with R$ 0 revenue, 2 vehicles and costs: the one that exposed the defects in production. */
const emptyOverview: OverviewDto = {
  monthlyResult: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((month) => ({
    month,
    revenueCents: 0,
    costCents: 0,
    profitCents: 0,
    costBreakdown: zeroBreakdown,
  })),
  overdueAging: {
    days1To7: { count: 0, amountCents: 0 },
    days8To30: { count: 0, amountCents: 0 },
    daysOver30: { count: 0, amountCents: 0 },
  },
  costByCategory: [
    { category: 'MAINTENANCE', amountCents: 0, shareBp: 0 },
    { category: 'FINES', amountCents: 0, shareBp: 0 },
    { category: 'IPVA', amountCents: 0, shareBp: 0 },
    { category: 'INSURANCE', amountCents: 0, shareBp: 0 },
    { category: 'FINANCING', amountCents: 0, shareBp: 0 },
  ],
  receivedByDay: { currentMonth: [], previousMonth: [] },
};

function summary(): DashboardSummaryDto {
  return {
    period: { from: '2026-11-01', to: '2026-11-30' },
    alerts: {
      openFines: { count: 0, amountCents: 0 },
      openMaintenances: { count: 0 },
      expiringCnh30d: { count: 0 },
      expiringLicensing30d: { count: 0 },
      reservedRentals: { count: 0 },
      paidFinesInPeriod: { count: 0, amountCents: 0 },
    },
    fleet: { vehiclesTotal: 2, vehicleLimit: 3, driversActive: 0, driversTotal: 0, rentedNow: 0, reservedNow: 0, utilizationPct: 0 },
    finance: {
      revenueCents: 0, receivedCents: 0, expensesCents: 0, saleRevenueCents: 0, resultCents: 0,
      maintenanceExpenseCents: 0, fineExpenseCents: 0, pendingChargesCents: 0, overdueChargesCents: 0,
      previousRevenueCents: 0, previousReceivedCents: 0, revenueDaily: [], byVehicle: [], byDriver: [],
      monthlyBilling: [], cashflow: [],
    },
    charges: { byStatus: [], ticketMedioCents: 0, completedRentalsCount: 0, ticketMedioLast6Months: [] },
    distributions: { rentalsByStatus: [], vehiclesByStatus: [{ status: 'AVAILABLE', count: 2 }] },
    topOffenders: { vehicles: [], drivers: [] },
    overview: emptyOverview,
  } as unknown as DashboardSummaryDto;
}

function roiVehicle(id: string, cost: number, returned: number) {
  return {
    vehicleId: id, plate: id.toUpperCase(), brand: 'Fiat', model: 'Argo',
    returnedCents: returned, returnBreakdown: { rentalCents: returned, saleCents: 0 },
    costCents: cost,
    costBreakdown: { acquisitionCents: cost, maintenanceCents: 0, insuranceCents: 0, financingCents: 0, ipvaCents: 0, finesCents: 0 },
    netCents: returned - cost, roiPercent: cost > 0 ? ((returned - cost) / cost) * 100 : null,
  };
}

function render(roiVehicles: unknown[] = []) {
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
      {
        provide: ReportsService,
        useValue: {
          loadVehicleRoi: vi.fn().mockReturnValue(of({ vehicles: roiVehicles })),
          vehicleRoi: signal({ vehicles: roiVehicles }),
          vehicleRoiLoading: signal(false),
          vehicleRoiError: signal(null),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardHome);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const norm = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('DashboardHome — parity with the prototype', () => {
  it('KPI row has six balanced cards; the ROI card takes a full row instead of orphaning one', () => {
    const host = render([roiVehicle('a', 10_000_00, 4_000_00)]);
    const grid = host.querySelector('[data-kpi-grid]')!;
    const cards = Array.from(grid.children).filter((c) => c.hasAttribute('app-kpi-card'));
    const regular = cards.filter((c) => !c.hasAttribute('data-roi-card'));
    expect(regular.length).toBe(6);
    expect(grid.className).toContain('md:grid-cols-3');
    expect(grid.className).toContain('xl:grid-cols-6');
    expect(host.querySelector('[data-roi-card]')?.className).toContain('col-span-full');
  });

  it('revenue by month is drawn once: no second chart, no month pills', () => {
    const host = render();
    expect(host.querySelectorAll('app-monthly-result-chart').length).toBe(1);
    expect(host.querySelector('app-monthly-billing-chart')).toBeNull();
    expect(norm(host)).not.toContain('Faturamento últimos 6 meses');
    expect(host.querySelectorAll('app-date-range-picker').length).toBe(1);
    expect(host.querySelector('[data-result-section] [role="radio"]')).toBeNull();
    expect(host.querySelector('[data-result-section] app-pill-tabs')).toBeNull();
  });

  it('no card sits inside another card', () => {
    const host = render();
    expect(host.querySelector('app-page-card app-page-card')).toBeNull();
    expect(host.querySelector('app-page-card app-ring-legend-card')).toBeNull();
    expect(host.querySelector('[data-expenses-block]')).toBeNull();
  });

  it('an account with R$ 0 revenue gets a sentence, not six flat bars', () => {
    const host = render();
    expect(host.querySelector('app-monthly-result-chart [data-empty]')).not.toBeNull();
    expect(host.querySelector('[data-month-bar]')).toBeNull();
  });

  it('ROI with no revenue says so instead of -100% and "no prejuízo"', () => {
    const host = render([roiVehicle('a', 100_000_00, 0), roiVehicle('b', 27_743_47, 0)]);
    const roi = norm(host.querySelector('[data-roi-card]'));
    expect(roi).toContain('—');
    expect(roi).toContain('ainda sem receita');
    expect(roi).not.toContain('-100');
    expect(roi).not.toContain('no prejuízo');
  });

  it('distribution cards come in rows with no empty half: cost ring spans the row when nothing is overdue', () => {
    const host = render();
    const cost = host.querySelector('[data-money-section]');
    expect(cost?.className).toContain('lg:col-span-2');
    expect(host.querySelectorAll('[data-distributions] app-ring-legend-card').length).toBe(3);
  });
});

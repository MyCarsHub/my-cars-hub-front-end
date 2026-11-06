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

function cashFixture() {
  const month = (m: string) => ({
    month: m,
    daysInMonth: 30,
    throughDay: 3,
    totalCents: 0,
    points: [1, 2, 3].map((day) => ({ day, cumulativeCents: 0, dayCents: 0 })),
  });
  return { current: month('2026-11'), previous: month('2026-10'), previousSameDayCents: 0, deltaCents: 0 };
}

function render(over: Partial<DashboardSummaryDto> = {}, cash: unknown = null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DashboardHome],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      {
        provide: DashboardService,
        useValue: {
          loadOverview: vi.fn().mockReturnValue(of({ ...summary(), ...over })),
          loadCashAccumulation: vi.fn().mockReturnValue(of(cash)),
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

describe('DashboardHome — parity with the prototype', () => {
  it('header greets by name and has the prototype subtitle', () => {
    const host = render();
    expect(norm(host)).toContain('Sua frota em detalhes.');
    expect(norm(host)).not.toContain('Visão consolidada');
  });

  it('KPI row has six balanced cards with icons, two columns on the phone, and no ROI card', () => {
    const host = render();
    const grid = host.querySelector('[data-kpi-grid]')!;
    const cards = Array.from(grid.children).filter((c) => c.hasAttribute('app-kpi-card'));
    expect(cards.length).toBe(6);
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('xl:grid-cols-6');
    expect(grid.querySelectorAll('svg[kpiIcon]').length).toBe(6);
    expect(host.querySelector('[data-roi-card]')).toBeNull();
    expect(norm(host)).not.toContain('ROI da frota');
  });

  it('period pills are the prototype set: no "Próximos" projections, "Mês atual" after "30 dias"', () => {
    const host = render();
    const labels = Array.from(host.querySelectorAll('app-date-range-picker [role="radio"], app-date-range-picker button')).map((b) => norm(b));
    expect(labels).toEqual(['Hoje', '7 dias', '30 dias', 'Mês atual', 'Mês passado', 'Este ano', 'Personalizado']);
  });

  it('revenue by month is drawn once: no second chart, no month pills', () => {
    const host = render();
    expect(host.querySelectorAll('app-monthly-result-chart').length).toBe(1);
    expect(host.querySelector('app-monthly-billing-chart')).toBeNull();
    expect(norm(host)).not.toContain('Faturamento últimos 6 meses');
    expect(host.querySelectorAll('app-date-range-picker').length).toBe(1);
    expect(host.querySelector('[data-result-section] app-pill-tabs')).toBeNull();
  });

  it('revenue chart and calendar are two cards of the SAME height: stretched grid, both cards fill', () => {
    const host = render();
    const row = host.querySelector('[data-result-section]')!;
    expect(row.className).toContain('items-stretch');
    expect(row.className).not.toContain('items-start');
    const cards = Array.from(row.querySelectorAll('app-page-card'));
    expect(cards.length).toBe(2);
    for (const c of cards) {
      expect(c.className).toContain('h-full');
      expect(c.querySelector('section')!.className).toContain('h-full');
    }
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

  it('losses with no revenue are said in words (no tiny strip of bars, no hidden loss)', () => {
    const months = emptyOverview.monthlyResult.map((m, i) => (i === 3 ? { ...m, profitCents: -45000 } : m));
    const host = render({ overview: { ...emptyOverview, monthlyResult: months } });
    expect(host.querySelector('[data-month-bar]')).toBeNull();
    expect(norm(host.querySelector('[data-losses]'))).toContain('set/26');
    expect(norm(host.querySelector('[data-losses]'))).toContain('450,00');
  });

  it('the empty cash chart draws no made-up axis (no R$ 0-100 ticks, no day labels)', () => {
    const month = (m: string) => ({
      month: m,
      daysInMonth: 30,
      throughDay: 3,
      totalCents: 0,
      points: [1, 2, 3].map((day) => ({ day, cumulativeCents: 0, dayCents: 0 })),
    });
    const cash = { current: month('2026-11'), previous: month('2026-10'), previousSameDayCents: 0, deltaCents: 0 };
    const host = render({}, cash);
    const section = host.querySelector('[data-cash-section]')!;
    expect(section.querySelector('app-growth-chart [data-empty]')).not.toBeNull();
    expect(section.querySelector('[data-y-axis]')).toBeNull();
    expect(section.querySelector('[data-x-axis]')).toBeNull();
    expect(norm(section)).not.toContain('R$ 100');
  });

  it('statuses stack on the left, cash chart on the right; the four cards come in one row', () => {
    const host = render();
    expect(host.querySelectorAll('[data-distributions] app-ring-legend-card').length).toBe(2);
    const board = host.querySelector('[data-board]')!;
    expect(board.children.length).toBe(5);
    expect(board.querySelector(':scope > [data-money-section]')).not.toBeNull();
    expect(board.querySelectorAll(':scope > app-ranking-card').length).toBe(2);
  });

  it('alert chips wrap onto several lines on the phone, never cut off', () => {
    const host = render({
      alerts: { ...summary().alerts, ipva: { count: 1 }, expiringCnh30d: { count: 1 } },
    } as Partial<DashboardSummaryDto>);
    const row = host.querySelector('[data-alert-chips]')!;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).not.toContain('overflow-x-auto');
    expect(row.querySelectorAll('app-alert-chip').length).toBe(2);
  });
});

describe('DashboardHome — responsive classes per section (phone 375 / tablet 768 / desktop)', () => {
  it('KPI grid: 2 columns on the phone, 3 on the tablet, 6 on the desktop', () => {
    const c = render().querySelector('[data-kpi-grid]')!.className;
    expect(c).toContain('grid-cols-2');
    expect(c).toContain('md:grid-cols-3');
    expect(c).toContain('xl:grid-cols-6');
  });

  it('chart + calendar: one column until xl, side by side after', () => {
    const c = render().querySelector('[data-result-section]')!.className;
    expect(c).toContain('grid-cols-1');
    expect(c).toContain('xl:grid-cols-[');
    expect(c).not.toMatch(/(^|\s)lg:grid-cols-\[/);
  });

  it('board: 1 column on the phone, 2 on the tablet, 20 on the desktop; each card spans what it should', () => {
    const board = render({}, cashFixture()).querySelector('[data-board]')!;
    expect(board.className).toContain('grid-cols-1');
    expect(board.className).toContain('md:grid-cols-2');
    expect(board.className).toContain('xl:grid-cols-[repeat(20');
    const spans = Array.from(board.children).map((c) => c.className);
    expect(spans[0]).toContain('md:col-span-2'); // statuses
    expect(spans[0]).toContain('xl:col-span-8');
    expect(spans[1]).toContain('xl:col-span-6'); // costs
    expect(spans[2]).toContain('xl:col-span-12'); // cash
    expect(spans[3]).toContain('xl:col-span-5'); // top vehicles
    expect(spans[4]).toContain('xl:col-span-5'); // top drivers
    expect(spans[5]).toContain('xl:col-span-4'); // offenders
    // desktop order: statuses, cash, costs, vehicles, drivers, offenders
    expect(spans.map((c) => /xl:order-(\d)/.exec(c)?.[1])).toEqual(['1', '3', '2', '4', '5', '6']);
  });

  it('period pills wrap onto rows on the phone (no carousel)', () => {
    const host = render();
    const group = host.querySelector('app-filter-chip-group > div');
    expect(group?.className).not.toContain('overflow-x-auto');
  });

  it('touch targets are at least 44px; quick actions are a 2x2 grid on the phone', () => {
    const host = render({
      alerts: { ...summary().alerts, ipva: { count: 1 } },
      topOffenders: {
        vehicles: [{ vehicleId: 'v', plate: 'ABC1D23', brand: 'F', model: 'A', count: 2, totalAmountCents: 100 }],
        drivers: [],
      },
    } as unknown as Partial<DashboardSummaryDto>);
    expect(host.querySelector('app-alert-chip button')!.className).toContain('min-h-[44px]');
    expect(host.querySelector('[data-offender-chips] button')!.className).toContain('min-h-[44px]');
    expect(host.querySelector('app-quick-action-card a')!.className).toContain('min-h-[64px]');
    expect(host.querySelector('app-quick-action-card')!.parentElement!.className).toContain('grid-cols-2');
  });

  it('the chart never forces a width', () => {
    const host = render();
    expect(host.querySelector('app-monthly-result-chart')!.className).toContain('min-w-0');
    expect(host.querySelectorAll('[data-board] app-ring-legend-card [style*="width:"], [data-board] app-ranking-card [style*="width:"]').length).toBe(0);
  });
});

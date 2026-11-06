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
 * FEAT-0468 — blocks of the v2 dashboard fed by `summary.overview` (FEAT-0467) and the
 * kits (growth chart, rings, rankings). Without `overview` the new blocks are absent, never zero.
 */
vi.setConfig({ testTimeout: 30000 });

describe('DashboardHome — overview blocks (FEAT-0468)', () => {
  const zeroBreakdown = { maintenance: 0, fines: 0, ipva: 0, insurance: 0, financing: 0 };

  const overview: OverviewDto = {
    monthlyResult: [
      { month: '2026-10', revenueCents: 900000, costCents: 300000, profitCents: 600000,
        costBreakdown: { ...zeroBreakdown, ipva: 100000, financing: 200000 } },
      { month: '2026-11', revenueCents: 1000000, costCents: 250000, profitCents: 750000,
        costBreakdown: { ...zeroBreakdown, maintenance: 250000 } },
    ],
    overdueAging: {
      days1To7: { count: 1, amountCents: 10000 },
      days8To30: { count: 0, amountCents: 0 },
      daysOver30: { count: 2, amountCents: 30000 },
    },
    costByCategory: [
      { category: 'MAINTENANCE', amountCents: 250000, shareBp: 10000 },
      { category: 'FINES', amountCents: 0, shareBp: 0 },
      { category: 'IPVA', amountCents: 0, shareBp: 0 },
      { category: 'INSURANCE', amountCents: 0, shareBp: 0 },
      { category: 'FINANCING', amountCents: 0, shareBp: 0 },
    ],
    receivedByDay: { currentMonth: [], previousMonth: [] },
  };

  function summaryWith(over: OverviewDto | undefined, overdueCents = 0): DashboardSummaryDto {
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
      fleet: { vehiclesTotal: 1, vehicleLimit: 3, driversActive: 0, driversTotal: 0, rentedNow: 0,
        reservedNow: 0, utilizationPct: 0 },
      finance: {
        revenueCents: 500000, receivedCents: 0, expensesCents: 0, saleRevenueCents: 0, resultCents: 0,
        maintenanceExpenseCents: 0, fineExpenseCents: 0, pendingChargesCents: 0,
        overdueChargesCents: overdueCents, previousRevenueCents: 0, previousReceivedCents: 0,
        revenueDaily: [],
        byVehicle: [
          { id: 'v1', label: 'ABC1D23 · Fiat Argo', revenueCents: 80000 },
          { id: 'v2', label: 'DEF4G56 · VW Gol', revenueCents: 50000 },
        ],
        byDriver: [{ id: 'd1', label: 'João Silva', revenueCents: 60000 }],
        monthlyBilling: [], cashflow: [],
      },
      charges: { byStatus: [], ticketMedioCents: 0, completedRentalsCount: 0, ticketMedioLast6Months: [] },
      distributions: {
        rentalsByStatus: [{ status: 'ACTIVE', count: 3 }, { status: 'RESERVED', count: 1 }],
        vehiclesByStatus: [{ status: 'AVAILABLE', count: 5 }],
      },
      topOffenders: { vehicles: [], drivers: [] },
      overview: over,
    } as unknown as DashboardSummaryDto;
  }

  function render(summary: DashboardSummaryDto, role = 'OWNER') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(summary)),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        { provide: FleetActivationService, useValue: { hasVehicles: vi.fn().mockReturnValue(of(true)) } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => (key === 'selectedRole' ? role : null),
            isPlatformAdmin: () => false,
            getCompanyRoleFromToken: () => role,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardHome);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('OWNER sees every section fed by overview and the kits', () => {
    const { host } = render(summaryWith(overview, 40000));
    expect(host.querySelector('[data-result-section] app-monthly-result-chart')).not.toBeNull();
    expect(text(host.querySelector('[data-result-section]'))).toContain('out/26');
    expect(host.querySelectorAll('[data-distributions] app-ring-legend-card').length).toBe(4);
    expect(text(host)).toContain('Para onde vai cada centavo');
    expect(text(host)).toContain('Atraso por idade');
    expect(host.querySelectorAll('app-ranking-card').length).toBe(2);
    expect(text(host)).toContain('ABC1D23 · Fiat Argo');
    expect(text(host)).toContain('Aluguéis por status');
  });

  it('MANAGER gets the same sections as the OWNER, in the same order', () => {
    const sections = (host: HTMLElement): string[] =>
      Array.from(host.querySelectorAll('section, [data-expenses-block]'))
        .map((el) => text(el.querySelector('h2, h3, [data-testid]') ?? el).slice(0, 40) + '|' + el.getAttribute('aria-label'));
    const owner = render(summaryWith(overview, 40000), 'OWNER').host;
    const ownerSections = sections(owner);
    const manager = render(summaryWith(overview, 40000), 'MANAGER').host;

    expect(ownerSections.length).toBeGreaterThan(5);
    expect(sections(manager)).toEqual(ownerSections);
    expect(manager.querySelector('[data-result-section]')).not.toBeNull();
    expect(manager.querySelector('[data-roi-card]')).not.toBeNull();
    expect(manager.querySelectorAll('[data-distributions] app-ring-legend-card').length).toBe(4);
  });

  it('a non-operator role does not get the operator-only ROI card', () => {
    const { host } = render(summaryWith(overview, 40000), 'DRIVER');
    expect(host.querySelector('[data-roi-card]')).toBeNull();
  });

  it('tapping a month opens the detail with that month cost breakdown', () => {
    const { fixture, host } = render(summaryWith(overview));
    expect(host.querySelector('[data-result-detail]')).toBeNull();
    const bars = Array.from(host.querySelectorAll<HTMLElement>('[data-result-section] [data-month-bar]'));
    const oct = bars.find((t) => t.textContent?.includes('out/26'));
    expect(oct).toBeTruthy();
    oct!.click();
    fixture.detectChanges();
    const detail = host.querySelector('[data-result-detail]');
    expect(detail).not.toBeNull();
    expect(text(host)).toContain('outubro de 2026');
    expect(text(host)).toContain('R$ 6.000,00');
  });

  it('without overview (older backend) the new blocks are absent, not zero', () => {
    const { host } = render(summaryWith(undefined));
    expect(host.querySelector('app-monthly-result-chart')).toBeNull();
    expect(host.querySelector('[data-money-section]')).toBeNull();
    // the kit blocks fed by the old fields stay
    expect(host.querySelectorAll('app-ranking-card').length).toBe(2);
  });

  it('hides the aging card when nothing is overdue', () => {
    const zero = {
      ...overview,
      overdueAging: {
        days1To7: { count: 0, amountCents: 0 },
        days8To30: { count: 0, amountCents: 0 },
        daysOver30: { count: 0, amountCents: 0 },
      },
    };
    const { host } = render(summaryWith(zero));
    expect(host.querySelectorAll('[data-distributions] app-ring-legend-card').length).toBe(3);
    expect(text(host)).not.toContain('Atraso por idade');
    // sem o card de atraso, o de custos ocupa a linha inteira: nada de metade vazia
    expect(host.querySelector('[data-money-section]')?.className).toContain('lg:col-span-2');
  });

  it('the KPI row carries the six prototype cards and no hand-made indicator cards', () => {
    const { host } = render(summaryWith(overview));
    expect(host.querySelectorAll('[data-expenses-block]').length).toBe(0);
    const labels = Array.from(host.querySelectorAll('[data-kpi-grid] > div[app-kpi-card]')).map((c) => text(c));
    for (const l of ['Faturado', 'Recebido', 'Despesas', 'Lucro', 'Ocupação', 'Inadimplência']) {
      expect(labels.some((t) => t.startsWith(l))).toBe(true);
    }
  });
});

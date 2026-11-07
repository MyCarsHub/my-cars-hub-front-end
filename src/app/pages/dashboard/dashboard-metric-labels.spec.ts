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
import type { DashboardSummaryDto, FinanceDto, MonthlyResultDto } from '../../types/dashboard.types';

/**
 * Metric definitions (Nov 2026): Faturado = charges by due date, Recebido = cash by payment day,
 * Lucro = Recebido + sales - expenses, Em atraso % comes from the backend in basis points.
 * Every new field is optional on the wire, so an older backend must still render clean text.
 */
vi.setConfig({ testTimeout: 30000 });

const zeroBreakdown = { maintenance: 0, fines: 0, ipva: 0, insurance: 0, financing: 0 };

function summary(finance: Partial<FinanceDto>, months: MonthlyResultDto[] = []): DashboardSummaryDto {
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
    fleet: { vehiclesTotal: 1, vehicleLimit: 3, driversActive: 0, driversTotal: 0, rentedNow: 0, reservedNow: 0, utilizationPct: 0 },
    finance: {
      revenueCents: 1740000, receivedCents: 260000, expensesCents: 100000, saleRevenueCents: 0, resultCents: 160000,
      maintenanceExpenseCents: 0, fineExpenseCents: 0, pendingChargesCents: 1335000, overdueChargesCents: 75000,
      previousRevenueCents: 0, previousReceivedCents: 0, revenueDaily: [], byVehicle: [], byDriver: [],
      monthlyBilling: [], cashflow: [], ...finance,
    },
    charges: { byStatus: [], ticketMedioCents: 0, completedRentalsCount: 0, ticketMedioLast6Months: [] },
    distributions: { rentalsByStatus: [], vehiclesByStatus: [] },
    topOffenders: { vehicles: [], drivers: [] },
    overview: months.length
      ? {
          monthlyResult: months,
          overdueAging: { days1To7: { count: 0, amountCents: 0 }, days8To30: { count: 0, amountCents: 0 }, daysOver30: { count: 0, amountCents: 0 } },
          costByCategory: [],
          receivedByDay: { currentMonth: [], previousMonth: [] },
        }
      : undefined,
  } as unknown as DashboardSummaryDto;
}

function render(s: DashboardSummaryDto) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DashboardHome],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      {
        provide: DashboardService,
        useValue: { loadOverview: vi.fn().mockReturnValue(of(s)), loadCashAccumulation: vi.fn().mockReturnValue(of(null)) },
      },
      { provide: BillingAccessService, useValue: { status: signal(null) } },
      { provide: FleetActivationService, useValue: { hasVehicles: vi.fn().mockReturnValue(of(true)) } },
      {
        provide: SessionService,
        useValue: { getItem: (k: string) => (k === 'selectedRole' ? 'OWNER' : null), isPlatformAdmin: () => false, getCompanyRoleFromToken: () => 'OWNER' },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardHome);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('DashboardHome — metric labels', () => {
  it('Faturado says it is by due date', () => {
    // The caption shows when there is no delta chip to compare with (nothing before, nothing now).
    const { host } = render(summary({ revenueCents: 0, receivedCents: 0, resultCents: 0 }));
    expect(text(host.querySelector('[data-billed-card]'))).toContain('cobranças com vencimento no período');
    expect(text(host)).not.toContain('contratos assinados');
  });

  it('Recebido says it is cash that came in', () => {
    const { host } = render(summary({ revenueCents: 0, receivedCents: 0, resultCents: 0 }));
    expect(text(host.querySelector('[data-received-card]'))).toContain('dinheiro que entrou no período');
  });

  it('Recebido never prints a percent of the faturado, even when cash passes it (151%)', () => {
    const { host } = render(summary({ revenueCents: 1000000, receivedCents: 1510000 }));
    const card = text(host.querySelector('[data-received-card]'));
    expect(card).not.toMatch(/\d+\s?%/);
    expect(card).not.toContain('do faturado');
  });

  it('Recebido with a delta chip keeps the comparison caption and still no share of the faturado', () => {
    const { host } = render(summary({ revenueCents: 1000000, receivedCents: 1510000, previousReceivedCents: 1000000 }));
    const card = text(host.querySelector('[data-received-card]'));
    expect(card).toContain('vs mês passado');
    expect(card).not.toContain('do faturado');
  });

  it('Lucro margin is over Recebido and carries the formula', () => {
    const { host } = render(summary({ revenueCents: 9000000, receivedCents: 400000, resultCents: 100000 }));
    const card = text(host.querySelector('[data-result-kpi]'));
    expect(card).toContain('margem 25%');
    expect(card).toContain('recebido + vendas − despesas');
  });

  it('Lucro margin counts the vehicle sale in its base, so Lucro 4600 on Recebido 2600 + vendas 3000 is 82%, never above 100%', () => {
    const { host } = render(summary({ revenueCents: 1740000, receivedCents: 260000, saleRevenueCents: 300000, expensesCents: 100000, resultCents: 460000 }));
    const card = text(host.querySelector('[data-result-kpi]'));
    expect(card).toContain('margem 82%');
    expect(card).not.toContain('177%');
  });

  it('Lucro margin never passes 100% when expenses are zero (all of what came in is profit)', () => {
    const { host } = render(summary({ receivedCents: 260000, saleRevenueCents: 300000, expensesCents: 0, resultCents: 560000 }));
    expect(text(host.querySelector('[data-result-kpi]'))).toContain('margem 100%');
  });

  it('Lucro margin shows on a month with only a vehicle sale (Recebido zero, vendas > 0)', () => {
    const { host } = render(summary({ receivedCents: 0, saleRevenueCents: 300000, expensesCents: 100000, resultCents: 200000 }));
    expect(text(host.querySelector('[data-result-kpi]'))).toContain('margem 67%');
  });

  it('Lucro margin is hidden when Recebido and vendas are zero, whatever the Faturado is, and no NaN shows', () => {
    const { host } = render(summary({ revenueCents: 1740000, receivedCents: 0, saleRevenueCents: 0, resultCents: 0 }));
    const card = text(host.querySelector('[data-result-kpi]'));
    expect(card).not.toContain('margem');
    expect(card).not.toContain('NaN');
    expect(card).toContain('recebido + vendas − despesas');
  });

  it('Em atraso shows the R$ and the share of the faturado from overdueRateBp', () => {
    const { host } = render(summary({ overdueInPeriodCents: 75000, overdueRateBp: 431 }));
    const card = text(host.querySelector('[data-overdue-kpi]'));
    expect(card.startsWith('Em atraso')).toBe(true);
    expect(card).toContain('4,3% do faturado');
    expect(card).not.toContain('Inadimplência');
  });

  it('Em atraso hides the percent when overdueRateBp is null (Faturado zero)', () => {
    const { host } = render(summary({ revenueCents: 0, overdueInPeriodCents: 0, overdueRateBp: null }));
    const card = text(host.querySelector('[data-overdue-kpi]'));
    expect(card).not.toContain('do faturado');
    expect(card).not.toMatch(/\d\s?%/);
  });

  it('an older backend (no new fields) renders every card without NaN or undefined', () => {
    const { host } = render(summary({}, [
      { month: '2026-11', revenueCents: 260000, costCents: 100000, profitCents: 160000, costBreakdown: zeroBreakdown },
    ]));
    expect(text(host.querySelector('[data-kpi-grid]'))).not.toMatch(/NaN|undefined|null/);
    expect(text(host.querySelector('[data-overdue-kpi]'))).not.toContain('do faturado');
  });

  it('the chart is titled Recebido vs lucro, with the Recebido legend', () => {
    const { host } = render(summary({}, [
      { month: '2026-11', revenueCents: 260000, costCents: 100000, profitCents: 160000, costBreakdown: zeroBreakdown },
    ]));
    const section = host.querySelector('[data-result-section]');
    expect(text(section)).toContain('Recebido vs lucro');
    expect(text(host.querySelector('[data-result-section] ul[aria-label="Legenda"]'))).toBe('Recebido Lucro');
    expect(text(section)).not.toContain('Faturamento');
  });

  it('the month dialog shows Recebido, the vehicle sale and Custos so the sum reaches Lucro', () => {
    const { fixture, host } = render(summary({}, [
      { month: '2026-11', revenueCents: 260000, saleRevenueCents: 3000000, costCents: 100000, profitCents: 3160000, costBreakdown: zeroBreakdown },
    ]));
    host.querySelector<HTMLElement>('[data-month-bar]')!.click();
    fixture.detectChanges();
    const detail = text(host.querySelector('[data-result-detail]'));
    expect(detail).toContain('Recebido');
    expect(detail).toContain('R$ 2.600,00');
    expect(host.querySelector('[data-result-sale]')).not.toBeNull();
    expect(detail).toContain('R$ 30.000,00');
    expect(detail).toContain('R$ 1.000,00');
    expect(detail).toContain('R$ 31.600,00');
  });

  it('the month dialog has no sale card when the month has no sale or the field is absent', () => {
    const { fixture, host } = render(summary({}, [
      { month: '2026-11', revenueCents: 260000, costCents: 100000, profitCents: 160000, costBreakdown: zeroBreakdown },
    ]));
    host.querySelector<HTMLElement>('[data-month-bar]')!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-result-sale]')).toBeNull();
    expect(text(host.querySelector('[data-result-detail]'))).not.toMatch(/NaN|undefined/);
  });
});

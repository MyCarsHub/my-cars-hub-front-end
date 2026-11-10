import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
 * STORY-VEHICLE-FINANCE no /dashboard: despesa e resultado do período, a quebra por
 * categoria (manutenção, multas, IPVA, seguro, financiamento) e o alerta de IPVA.
 */
describe('DashboardHome — despesas por categoria e alerta de IPVA', () => {
  function summaryWith(finance: Record<string, unknown>, alerts: Record<string, unknown> = {}) {
    return {
      period: { from: '2026-11-01', to: '2026-11-30' },
      alerts: {
        openFines: { count: 0, amountCents: 0 },
        openMaintenances: { count: 0 },
        expiringCnh30d: { count: 0 },
        expiringLicensing30d: { count: 0 },
        reservedRentals: { count: 0 },
        paidFinesInPeriod: { count: 0, amountCents: 0 },
        ...alerts,
      },
      fleet: {
        vehiclesTotal: 1,
        vehicleLimit: 3,
        driversActive: 0,
        driversTotal: 0,
        rentedNow: 0,
        reservedNow: 0,
        utilizationPct: 0,
      },
      finance: {
        revenueCents: 500000,
        receivedCents: 0,
        expensesCents: 0,
        saleRevenueCents: 0,
        resultCents: 0,
        maintenanceExpenseCents: 0,
        fineExpenseCents: 0,
        pendingChargesCents: 0,
        overdueChargesCents: 0,
        previousRevenueCents: 0,
        previousReceivedCents: 0,
        revenueDaily: [],
        byVehicle: [],
        byDriver: [],
        monthlyBilling: [],
        cashflow: [],
        ...finance,
      },
      charges: { byStatus: [], ticketMedioCents: 0, completedRentalsCount: 0, ticketMedioLast6Months: [] },
      distributions: { rentalsByStatus: [], vehiclesByStatus: [] },
      topOffenders: { vehicles: [], drivers: [] },
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

  it('shows expenses and result as KPI cards, with no nested expense block', () => {
    const { host } = render(
      summaryWith({
        expensesCents: 150000,
        resultCents: 350000,
        maintenanceExpenseCents: 10000,
        fineExpenseCents: 20000,
        expenseBreakdown: { maintenance: 10000, fines: 20000, ipva: 30000, insurance: 40000, financing: 50000 },
      }),
    );
    expect(text(host.querySelector('[data-expenses-kpi]'))).toContain('R$ 1.500');
    expect(text(host.querySelector('[data-result-kpi]'))).toContain('R$ 3.500');
    // the breakdown no longer lives in a card inside the revenue card: it is the cost ring + the month detail
    expect(host.querySelector('[data-expenses-block]')).toBeNull();
  });

  it('shows the IPVA chip with its count and opens the IPVA page', () => {
    const { fixture, host } = render(summaryWith({}, { ipva: { count: 3 } }));
    const chip = host.querySelector('app-alert-chip[data-ipva-alert]');
    expect(chip).not.toBeNull();
    expect(text(chip)).toContain('IPVA a vencer');
    expect(text(chip)).toContain('3');

    const navigate = vi.spyOn(fixture.debugElement.injector.get(Router), 'navigateByUrl').mockResolvedValue(true);
    (chip!.querySelector('button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith('/ipva');
  });

  it('hides the IPVA chip without IPVA due, from an older backend, and for a driver', () => {
    expect(render(summaryWith({}, { ipva: { count: 0 } })).host.querySelector('[data-ipva-alert]')).toBeNull();
    expect(render(summaryWith({})).host.querySelector('[data-ipva-alert]')).toBeNull();
    expect(
      render(summaryWith({}, { ipva: { count: 2 } }), 'DRIVER').host.querySelector('[data-ipva-alert]'),
    ).toBeNull();
  });

  it('FEAT-0424: com Gastos sem veículo, a legenda de Despesas diz quanto é da locadora toda', () => {
    const { host } = render(summaryWith({ expensesCents: 150000, companyWideExpensesCents: 45000 }));
    expect(text(host.querySelector('[data-expenses-kpi]'))).toContain('R$ 450 da locadora toda');
  });

  it('empresa sem Gastos (zero) ou back-end anterior (ausente): a legenda é a de sempre', () => {
    for (const extra of [{ companyWideExpensesCents: 0 }, {}]) {
      const { host } = render(summaryWith({ expensesCents: 150000, ...extra }));
      const caption = text(host.querySelector('[data-expenses-kpi]'));
      expect(caption).toContain('tudo que saiu no período');
      expect(caption).not.toContain('locadora toda');
    }
  });
});

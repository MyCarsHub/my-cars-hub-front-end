import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardHome } from './dashboard-home';
import { BillingAccessService } from '../../services/billing-access.service';
import { DashboardService } from '../../services/dashboard.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { SessionService } from '../../services/session.service';
import type { DashboardSummaryDto } from '../../types/dashboard.types';

/**
 * O alerta «Cobranças em atraso» do /dashboard: é o primeiro da faixa, rose, mostra
 * quantidade e valor, some quando não há atraso e leva à lista de aluguéis filtrada.
 */
describe('DashboardHome — alerta «Cobranças em atraso»', () => {
  const CHIP = 'app-alert-chip[data-overdue-charges-alert]';

  function summaryWith(
    overdue: { count: number; amountCents: number } | undefined,
    extra: Record<string, unknown> = {},
  ): DashboardSummaryDto {
    return {
      period: { from: '2026-09-01', to: '2026-09-30' },
      alerts: {
        openFines: { count: 2, amountCents: 50000 },
        openMaintenances: { count: 0 },
        expiringCnh30d: { count: 0 },
        expiringLicensing30d: { count: 0 },
        reservedRentals: { count: 0 },
        paidFinesInPeriod: { count: 0, amountCents: 0 },
        ...(overdue ? { overdueCharges: overdue } : {}),
        ...extra,
      },
      fleet: {
        vehiclesTotal: 0,
        vehicleLimit: 3,
        driversActive: 0,
        driversTotal: 0,
        rentedNow: 0,
        reservedNow: 0,
        utilizationPct: 0,
      },
      finance: {
        revenueCents: 0,
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
      },
      charges: {
        byStatus: [],
        ticketMedioCents: 0,
        completedRentalsCount: 0,
        ticketMedioLast6Months: [],
      },
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
        {
          provide: FleetActivationService,
          useValue: { hasVehicles: vi.fn().mockReturnValue(of(true)) },
        },
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

  /** Igual a `render`, com HttpClient de teste: o painel V118 busca a própria lista. */
  function renderWithHttp(summary: DashboardSummaryDto, role = 'OWNER') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(summary)),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        {
          provide: FleetActivationService,
          useValue: { hasVehicles: vi.fn().mockReturnValue(of(true)) },
        },
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

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mostra a quantidade e o valor das cobranças em atraso, em rose, como o PRIMEIRO da faixa', () => {
    const { host } = render(summaryWith({ count: 3, amountCents: 123456 }));

    const chip = host.querySelector<HTMLElement>(CHIP);
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('Cobranças em atraso');
    expect(chip!.textContent).toContain('3');
    expect(chip!.textContent).toContain('1.234,56');
    // rose, com variante escura (tokens do tema)
    const button = chip!.querySelector('button')!;
    expect(button.className).toContain('bg-rose-50');
    expect(button.className).toContain('dark:bg-rose-500/10');
    // topo da faixa: antes das multas em aberto
    const chips = Array.from(host.querySelectorAll('app-alert-chip'));
    expect(chips[0]).toBe(chip);
    expect(chips.length).toBeGreaterThan(1);
    // alvo de toque >= 44px
    expect(button.className).toContain('min-h-[56px]');
  });

  it('V118 — cobranças não criadas no Asaas têm o chip irmão (amarelo) e o painel com a frase', () => {
    TestBed.resetTestingModule();
    const { host } = renderWithHttp(
      summaryWith({ count: 1, amountCents: 70000 }, { failedCharges: { count: 1, amountCents: 70000 } }),
    );
    const chip = host.querySelector<HTMLElement>('app-alert-chip[data-failed-charges-alert]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('Cobranças não criadas no Asaas');
    expect(chip!.textContent).toContain('700,00');
    expect(host.querySelector('app-failed-charge-notices')).not.toBeNull();
  });

  it('V118 — motorista nunca vê o chip nem o painel', () => {
    const { host } = renderWithHttp(
      summaryWith(undefined, { failedCharges: { count: 1, amountCents: 70000 } }),
      'DRIVER',
    );
    expect(host.querySelector('app-alert-chip[data-failed-charges-alert]')).toBeNull();
    expect(host.querySelector('app-failed-charge-notices')).toBeNull();
  });

  it('sem atraso, o card não aparece (como os demais zerados)', () => {
    const { host } = render(summaryWith({ count: 0, amountCents: 0 }));
    expect(host.querySelector(CHIP)).toBeNull();
    // os outros alertas continuam
    expect(host.querySelectorAll('app-alert-chip').length).toBe(1);
  });

  it('backend anterior, sem o campo: nada quebra e o card não aparece', () => {
    const { host } = render(summaryWith(undefined));
    expect(host.querySelector(CHIP)).toBeNull();
  });

  it('só atraso, nada mais: a faixa abre por causa dele', () => {
    const { host } = render(
      summaryWith({ count: 1, amountCents: 10000 }, { openFines: { count: 0, amountCents: 0 } }),
    );
    expect(host.querySelector(CHIP)).not.toBeNull();
  });

  it('ao tocar, leva à lista de aluguéis filtrada por atraso', () => {
    const { fixture, host } = render(summaryWith({ count: 2, amountCents: 5000 }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    host.querySelector<HTMLButtonElement>(`${CHIP} button`)!.click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith('/alugueis?emAtraso=true');
  });

  it('o motorista não vê este card (ele tem o aviso próprio em /meu-painel)', () => {
    const { host } = render(summaryWith({ count: 2, amountCents: 5000 }), 'DRIVER');
    expect(host.querySelector(CHIP)).toBeNull();
  });
});

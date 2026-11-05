import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Relatorios } from './relatorios';
import { ReportsService } from '../../services/reports.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { ReportsOverviewResponse } from '../../types/reports.types';

/** STORY-VEHICLE-FINANCE nos Relatórios: custo operacional por categoria. */
describe('Relatorios — custo operacional por categoria', () => {
  function report(extra: Record<string, unknown> = {}): ReportsOverviewResponse {
    return {
      from: '2026-10-01',
      to: '2026-10-31',
      financial: {
        grossRevenueCents: 500000,
        accruedRevenueCents: 0,
        revenueByGateway: [],
        operatingCostCents: 150000,
        netProfitCents: 350000,
        monthlyRevenue: [],
        ...extra,
      },
      vehicleRanking: { topProfitable: [], topUnprofitable: [] },
      driverRanking: { topRevenue: [], topProblematic: [] },
      operations: {
        activeRentalsCount: 0,
        completedRentalsCount: 0,
        canceledRentalsCount: 0,
        fleetOccupancyRate: 0,
      },
    } as ReportsOverviewResponse;
  }

  function render(r: ReportsOverviewResponse): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Relatorios],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ReportsService,
          useValue: {
            overview: signal(r),
            loading: signal(false),
            error: signal(null),
            loadOverview: vi.fn().mockReturnValue(of(r)),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(Relatorios);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('shows operating cost and net profit as KPI cards and the breakdown by category', () => {
    const host = render(
      report({
        expenseBreakdown: { maintenance: 10000, fines: 20000, ipva: 30000, insurance: 40000, financing: 50000 },
      }),
    );
    expect(text(host.querySelector('[data-operating-cost-kpi]'))).toContain('R$ 1.500,00');
    expect(text(host.querySelector('[data-net-profit-kpi]'))).toContain('R$ 3.500,00');
    const section = host.querySelector('[data-operating-cost-breakdown]');
    expect(section).not.toBeNull();
    expect(section!.querySelectorAll('li[data-expense]').length).toBe(5);
    expect(text(section!.querySelector('li[data-expense="ipva"]'))).toContain('R$ 300,00');
  });

  it('has no breakdown section when the backend does not send one', () => {
    expect(render(report()).querySelector('[data-operating-cost-breakdown]')).toBeNull();
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Relatorios } from './relatorios';
import { ReportsService } from '../../services/reports.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { DriverProblematicRow, ReportsOverviewResponse } from '../../types/reports.types';

/**
 * V141 — Ajustes nos motoristas com pendência: `totalProblematicCents` JÁ inclui os ajustes e
 * `unpaidChargesCents` deixou de incluí-los. A barra usa o total do back-end (nunca soma por
 * cima) e a dica mostra os ajustes como terceira parte, para a conta fechar.
 */
describe('Relatorios — ajustes nos motoristas com pendência', () => {
  function bars(rows: DriverProblematicRow[]) {
    const r = {
      from: '2026-11-01',
      to: '2026-11-30',
      financial: {
        grossRevenueCents: 0,
        accruedRevenueCents: 0,
        revenueByGateway: [],
        operatingCostCents: 0,
        netProfitCents: 0,
        monthlyRevenue: [],
      },
      vehicleRanking: { topProfitable: [], topUnprofitable: [] },
      driverRanking: { topRevenue: [], topProblematic: rows },
      operations: { activeRentalsCount: 0, completedRentalsCount: 0, canceledRentalsCount: 0, fleetOccupancyRate: 0 },
    } as unknown as ReportsOverviewResponse;
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
    return (fixture.componentInstance as unknown as {
      topProblematicDriverBars: () => { value: number; hint?: string }[];
    }).topProblematicDriverBars();
  }

  /** Sem o espaço (normal ou não-quebrável) entre R$ e o número: o formatador decide qual. */
  const flat = (s: string | undefined) => (s ?? '').replace(/R\$[\s\u00a0\u202f]*/g, 'R$');

  const row = (over: Partial<DriverProblematicRow>): DriverProblematicRow => ({
    driverId: 'd1',
    name: 'carlos mendes',
    unpaidFinesCents: 10000,
    unpaidChargesCents: 20000,
    totalProblematicCents: 30000,
    ...over,
  });

  it('com ajuste: a barra é o total do back-end e a dica mostra as três partes', () => {
    const [bar] = bars([row({ totalProblematicCents: 48000, unpaidAdjustmentsCents: 18000 })]);
    expect(bar.value).toBe(48000);
    expect(flat(bar.hint)).toBe('Multas R$100,00 · Cobranças R$200,00 · Ajustes R$180,00');
  });

  it('sem ajuste, ou back-end anterior sem o campo: a dica é a de antes', () => {
    for (const extra of [{ unpaidAdjustmentsCents: 0 }, {}]) {
      const [bar] = bars([row(extra)]);
      expect(bar.value).toBe(30000);
      expect(flat(bar.hint)).toBe('Multas R$100,00 · Cobranças R$200,00');
    }
  });
});

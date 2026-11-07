import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Relatorios } from './relatorios';
import { ReportsService } from '../../services/reports.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { REPORT_LABELS, type ReportsOverviewResponse } from '../../types/reports.types';
import { reportToMarkdown } from '../../utils/reports-export';

/**
 * The report measures changed meaning (cash, refunds netted; A receber = still to fall due).
 * Screen and exports read the same labels, so they cannot drift apart.
 */
vi.setConfig({ testTimeout: 30000 });

const report = {
  from: '2026-11-01',
  to: '2026-11-30',
  financial: {
    grossRevenueCents: 260000,
    accruedRevenueCents: 1335000,
    revenueByGateway: [{ provider: 'ASAAS', amountCents: 260000 }],
    operatingCostCents: 100000,
    netProfitCents: 160000,
    monthlyRevenue: [{ yearMonth: '2026-11', revenueCents: 260000, isPartial: false }],
  },
  vehicleRanking: { topProfitable: [], topUnprofitable: [] },
  driverRanking: { topRevenue: [], topProblematic: [] },
  operations: { activeRentalsCount: 1, completedRentalsCount: 0, canceledRentalsCount: 0, fleetOccupancyRate: 0.5 },
} as unknown as ReportsOverviewResponse;

describe('Relatorios — metric labels', () => {
  it('the screen shows the new A receber label with its caption and the cash caption', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Relatorios],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ReportsService,
          useValue: { overview: signal(report), loading: signal(false), error: signal(null), loadOverview: vi.fn().mockReturnValue(of(report)) },
        },
        { provide: NotificationService, useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), push: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Relatorios);
    fixture.detectChanges();
    const t = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
    expect(t).toContain('A receber (ainda a vencer)');
    expect(t).toContain('cobranças pendentes com vencimento de hoje em diante');
    expect(t).toContain('Receita recebida');
    expect(t).toContain('dinheiro recebido no período, estornos abatidos');
    expect(t).not.toContain('(previsto)');
    expect(t).not.toContain('Receita a receber');
    expect(t).not.toMatch(/em atraso/i);
  });

  it('the markdown export uses the same labels and captions as the screen', () => {
    const md = reportToMarkdown(report);
    expect(md).toContain(`**${REPORT_LABELS.receivable}:**`);
    expect(md).toContain(REPORT_LABELS.receivableHint);
    expect(md).toContain(`**${REPORT_LABELS.received}:**`);
    expect(md).toContain(REPORT_LABELS.receivedHint);
    expect(md).not.toContain('previsto');
    expect(md).not.toMatch(/em atraso/i);
  });
});

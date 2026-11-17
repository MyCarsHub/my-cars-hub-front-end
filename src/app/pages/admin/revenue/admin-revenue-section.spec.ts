import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import type { AdminRevenue, AdminRevenueMonth } from '../../../types/admin-revenue.types';
import { AdminRevenueSection } from './admin-revenue-section';
import { dateLabel, monthBars, monthLabel, presentSeries, receivedShare } from './admin-revenue.series';

const URL = `${environment.apiUrl}/admin/billing/revenue`;

const month = (m: string, p: Partial<AdminRevenueMonth> = {}): AdminRevenueMonth => ({
  month: m,
  mrrCents: null,
  mrrAsOf: null,
  receivedCents: null,
  cumulativeReceivedCents: null,
  couponDiscountCents: 0,
  ...p,
});

/** O que produção tem em 17/11/2026: caixa desde 28/09, foto do MRR desde 05/11. */
const REVENUE: AdminRevenue = {
  period: '12m',
  currentMonth: '2026-11',
  months: [
    month('2026-08'),
    month('2026-09', { receivedCents: 7_990, cumulativeReceivedCents: 7_990 }),
    month('2026-10', { receivedCents: 23_970, cumulativeReceivedCents: 31_960 }),
    month('2026-11', {
      mrrCents: 46_950,
      mrrAsOf: '2026-11-16',
      receivedCents: 48_920,
      cumulativeReceivedCents: 80_880,
      couponDiscountCents: 19_940,
    }),
  ],
  mrr: { since: '2026-11-05', asOf: '2026-11-16', latestCents: 46_950 },
  received: { since: '2026-09-28', monthCents: 48_920, totalCents: 80_880, rowsWithoutAmount: 0 },
  expected: {
    month: '2026-11',
    until: '2026-11-30',
    receivedCents: 48_920,
    upcomingRenewals: 1,
    upcomingRenewalsCents: 7_990,
    expectedCents: 56_910,
  },
  discounts: { available: true, truncated: false, monthCents: 19_940, periodCents: 19_940, discountedInvoices: 2 },
};

const norm = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('admin-revenue.series', () => {
  it('labels months in pt-BR and adds the year only when asked', () => {
    expect(monthLabel('2026-11')).toBe('nov');
    expect(monthLabel('2027-01', true)).toBe('jan/27');
    expect(dateLabel('2026-11-05')).toBe('05/11/2026');
    expect(dateLabel(null)).toBeNull();
  });

  it('drops months without data instead of drawing them as zero', () => {
    const s = presentSeries(REVENUE.months, (m) => m.mrrCents);
    expect(s.labels).toEqual(['nov']);
    expect(s.values).toEqual([46_950]);

    const received = presentSeries(REVENUE.months, (m) => m.receivedCents);
    expect(received.labels).toEqual(['set', 'out', 'nov']);
  });

  it('lists bars newest first, measured months only, with the year when the window crosses it', () => {
    const bars = monthBars(
      [month('2025-12', { receivedCents: 1 }), month('2026-01', { receivedCents: 2 }), month('2026-02')],
      (m) => m.receivedCents,
    );
    expect(bars).toEqual([
      { label: 'jan/26', value: 2 },
      { label: 'dez/25', value: 1 },
    ]);
  });

  it('shares the received part of the expected total, clamped, and none without an expected value', () => {
    expect(receivedShare(48_920, 56_910)).toBeCloseTo(0.8596, 3);
    expect(receivedShare(10, 5)).toBe(1);
    expect(receivedShare(0, 0)).toBeNull();
  });
});

describe('AdminRevenueSection', () => {
  let http: HttpTestingController;

  function render(): { host: HTMLElement; detect: () => void } {
    const fixture = TestBed.createComponent(AdminRevenueSection);
    fixture.detectChanges();
    return {
      host: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
    };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminRevenueSection],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for 12 months by default and shows the four month numbers', () => {
    const { host, detect } = render();
    http.expectOne((r) => r.url === URL && r.params.get('period') === '12m').flush(REVENUE);
    detect();

    expect(norm(host.querySelector('[data-expected-card]'))).toContain('R$ 569');
    expect(norm(host.querySelector('[data-expected-card]'))).toContain('1 renovação até 30/11');
    expect(norm(host.querySelector('[data-received-card]'))).toContain('R$ 489');
    expect(norm(host.querySelector('[data-received-card]'))).toContain('desde 28/09/2026');
    expect(norm(host.querySelector('[data-discount-card]'))).toContain('R$ 199');
    expect(norm(host.querySelector('[data-cumulative-card]'))).toContain('R$ 809');
  });

  it('says where each history begins and never prints a month before it as R$ 0', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush(REVENUE);
    detect();

    expect(norm(host.querySelector('[data-mrr-chart]'))).toContain('O histórico começa em 05/11/2026');
    expect(norm(host.querySelector('[data-cumulative-chart]'))).toContain('registrado desde 28/09/2026');
    const received = norm(host.querySelector('[data-received-chart]'));
    expect(received).toContain('set');
    expect(received).not.toContain('ago');
    expect(received).not.toContain('R$ 0,00');
  });

  it('shows an honest empty state when there is no MRR snapshot and no payment yet', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush({
      ...REVENUE,
      months: [month('2026-11')],
      mrr: { since: null, asOf: null, latestCents: null },
      received: { since: null, monthCents: null, totalCents: null, rowsWithoutAmount: 0 },
    });
    detect();

    expect(norm(host.querySelector('[data-mrr-chart] [data-empty]'))).toBe('Ainda sem foto diária do MRR.');
    expect(norm(host.querySelector('[data-received-chart] [data-empty]'))).toBe(
      'Nenhum pagamento de assinatura registrado ainda.',
    );
    expect(norm(host.querySelector('[data-received-card]'))).toContain('—');
  });

  it('keeps every other number when Stripe could not be read', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush({
      ...REVENUE,
      months: REVENUE.months.map((m) => ({ ...m, couponDiscountCents: null })),
      discounts: { available: false, truncated: false, monthCents: null, periodCents: null, discountedInvoices: 0 },
    });
    detect();

    expect(norm(host.querySelector('[data-discount-chart]'))).toContain('Não conseguimos ler as faturas na Stripe');
    expect(norm(host.querySelector('[data-discount-card]'))).toContain('Stripe indisponível');
    expect(norm(host.querySelector('[data-received-card]'))).toContain('R$ 489');
  });

  it('reloads with the period picked in the pills', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush(REVENUE);
    detect();

    const all = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (b) => norm(b) === 'Desde o início',
    );
    all!.click();
    detect();

    http.expectOne((r) => r.url === URL && r.params.get('period') === 'all').flush({ ...REVENUE, period: 'all' });
  });
});

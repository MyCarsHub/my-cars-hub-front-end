import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import type { AdminHomeRange } from '../../../types/admin-home.types';
import type { AdminRevenue, AdminRevenueMonth, AdminRevenuePoint } from '../../../types/admin-revenue.types';
import { AdminRevenueSection, rangeKey, revenuePoints } from './admin-revenue-section';
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

const point = (start: string, p: Partial<AdminRevenuePoint> = {}): AdminRevenuePoint => ({
  start,
  end: start,
  mrrCents: null,
  mrrAsOf: null,
  receivedCents: null,
  cumulativeReceivedCents: null,
  couponDiscountCents: 0,
  ...p,
});

const NOVEMBER: AdminHomeRange = { from: '2026-11-01', to: '2026-11-18' };
const WEEK: AdminHomeRange = { from: '2026-11-12', to: '2026-11-18' };

/** O que produção tem em 17/11/2026: caixa desde 28/09, foto do MRR desde 05/11. Janela de novembro, por dia. */
const REVENUE: AdminRevenue = {
  period: 'custom',
  currentMonth: '2026-11',
  meta: {
    period: 'custom',
    from: '2026-11-01',
    to: '2026-11-18',
    bucket: 'DAY',
    previousFrom: '2026-10-14',
    previousTo: '2026-10-31',
  },
  points: [
    point('2026-11-01', { cumulativeReceivedCents: 31_960, receivedCents: 0 }),
    point('2026-11-05', {
      mrrCents: 46_950,
      receivedCents: 48_920,
      cumulativeReceivedCents: 80_880,
      couponDiscountCents: 19_940,
    }),
  ],
  months: [
    month('2026-11', {
      mrrCents: 46_950,
      mrrAsOf: '2026-11-16',
      receivedCents: 48_920,
      cumulativeReceivedCents: 80_880,
      couponDiscountCents: 19_940,
    }),
  ],
  mrr: { since: '2026-11-05', asOf: '2026-11-16', latestCents: 46_950 },
  received: {
    since: '2026-09-28',
    monthCents: 48_920,
    totalCents: 80_880,
    rowsWithoutAmount: 0,
    periodCents: 48_920,
    previousPeriodCents: 23_970,
  },
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
    const months = [month('2026-09', { receivedCents: 1 }), month('2026-10'), month('2026-11', { mrrCents: 46_950 })];
    const s = presentSeries(months, (m) => m.mrrCents);
    expect(s.labels).toEqual(['nov']);
    expect(s.values).toEqual([46_950]);
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

  it('uses the server points; a server from before 18/11 (months only) still draws one point per month', () => {
    expect(revenuePoints(REVENUE)).toBe(REVENUE.points);
    const legacy = revenuePoints({ ...REVENUE, points: undefined, months: [month('2026-10', { receivedCents: 5 })] });
    expect(legacy).toEqual([expect.objectContaining({ start: '2026-10-01', receivedCents: 5 })]);
    expect(revenuePoints(null)).toEqual([]);
    expect(rangeKey(NOVEMBER)).toBe('2026-11-01|2026-11-18');
    expect(rangeKey(null)).toBeNull();
  });
});

describe('AdminRevenueSection', () => {
  let http: HttpTestingController;

  function render(range: AdminHomeRange | null = NOVEMBER) {
    const fixture = TestBed.createComponent(AdminRevenueSection);
    fixture.componentRef.setInput('range', range);
    fixture.detectChanges();
    return {
      host: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
      setRange: (r: AdminHomeRange) => {
        fixture.componentRef.setInput('range', r);
        fixture.detectChanges();
      },
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

  it('has no period pills of its own and asks with the page range (from/to, never period)', () => {
    const { host } = render();
    expect(host.querySelector('app-pill-tabs')).toBeNull();
    expect(host.querySelector('[role="radio"]')).toBeNull();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('from')).toBe('2026-11-01');
    expect(req.request.params.get('to')).toBe('2026-11-18');
    expect(req.request.params.has('period')).toBe(false);
    req.flush(REVENUE);
  });

  it('asks nothing until the page has a range', () => {
    render(null);
    http.expectNone(URL);
  });

  it('shows the money with cents, the period received against the previous one, and the server dates', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush(REVENUE);
    detect();

    const text = (sel: string) => norm(host.querySelector(sel));
    expect(text('[data-revenue-range]')).toContain('de 01/11/2026 a 18/11/2026');
    expect(text('[data-expected-card]')).toContain('Esperado em novembro');
    expect(text('[data-expected-card]')).toContain('R$ 569,10');
    expect(text('[data-expected-card]')).toContain('1 renovação até 30/11');
    expect(text('[data-received-card]')).toContain('Recebido no período');
    expect(text('[data-received-card]')).toContain('R$ 489,20');
    expect(text('[data-received-card]')).toContain('↗ 104%');
    expect(text('[data-received-card]')).toContain('período anterior (14/10/2026 a 31/10/2026): R$ 239,70');
    expect(text('[data-discount-card]')).toContain('R$ 199,40');
    expect(text('[data-discount-card]')).toContain('2 faturas com desconto');
    expect(text('[data-cumulative-card]')).toContain('R$ 808,80');
    expect(text('[data-received-chart]')).toContain('Recebido por dia');
  });

  it('draws received and discounts as columns with the bucket labels (tooltips come from the chart)', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush(REVENUE);
    detect();
    expect(host.querySelector('[data-received-chart] app-bar-chart')).not.toBeNull();
    expect(norm(host.querySelector('[data-received-chart]'))).toContain('05/11');
    expect(host.querySelector('[data-discount-chart] app-bar-chart')).not.toBeNull();
  });

  it('says where each history begins and never prints a bucket before it as R$ 0', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush(REVENUE);
    detect();

    expect(norm(host.querySelector('[data-mrr-chart]'))).toContain('O histórico começa em 05/11/2026');
    expect(norm(host.querySelector('[data-cumulative-chart]'))).toContain('registrado desde 28/09/2026');
  });

  it('shows an honest empty state when there is no MRR snapshot and no payment yet', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush({
      ...REVENUE,
      points: [point('2026-11-01', { couponDiscountCents: null })],
      mrr: { since: null, asOf: null, latestCents: null },
      received: { since: null, monthCents: null, totalCents: null, rowsWithoutAmount: 0, periodCents: null, previousPeriodCents: null },
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
      points: REVENUE.points!.map((p) => ({ ...p, couponDiscountCents: null })),
      discounts: { available: false, truncated: false, monthCents: null, periodCents: null, discountedInvoices: 0 },
    });
    detect();

    expect(norm(host.querySelector('[data-discount-chart]'))).toContain('Indisponível agora');
    expect(norm(host.querySelector('[data-discount-card]'))).toContain('Stripe indisponível');
    expect(norm(host.querySelector('[data-received-card]'))).toContain('R$ 489,20');
  });

  it('cancels the pending range when the page range changes, so its reply never shows', () => {
    const { host, detect, setRange } = render();
    const first = http.expectOne((r) => r.params.get('from') === '2026-11-01');

    setRange(WEEK);

    expect(first.cancelled).toBe(true);
    http.expectOne((r) => r.params.get('from') === '2026-11-12').flush({
      ...REVENUE,
      received: { ...REVENUE.received, totalCents: 12_300 },
    });
    detect();
    expect(norm(host.querySelector('[data-cumulative-card]'))).toContain('R$ 123,00');
  });

  it('a failed reload says so and does not keep the previous range numbers under the new dates', () => {
    const { host, detect, setRange } = render();
    http.expectOne(() => true).flush(REVENUE);
    detect();

    setRange(WEEK);
    http.expectOne((r) => r.params.get('from') === '2026-11-12').flush('erro', { status: 500, statusText: 'Erro' });
    detect();

    expect(norm(host.querySelector('[role="alert"]'))).toContain('Não foi possível carregar a receita');
    expect(norm(host.querySelector('[data-received-card]'))).not.toContain('R$ 489');
  });

  it('a server from before 18/11 (no periodCents) shows the month received and says it is the month', () => {
    const { host, detect } = render();
    http.expectOne(() => true).flush({
      ...REVENUE,
      meta: undefined,
      points: undefined,
      received: { since: '2026-09-28', monthCents: 48_920, totalCents: 80_880, rowsWithoutAmount: 0 },
    });
    detect();
    expect(norm(host.querySelector('[data-received-card]'))).toContain('Recebido no mês');
    expect(norm(host.querySelector('[data-received-card]'))).toContain('R$ 489,20');
  });
});

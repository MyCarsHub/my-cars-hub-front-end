import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { MonthlyResultChart } from './monthly-result-chart';
import type { MonthlyResultDto } from '../../../types/dashboard.types';

const zero = { maintenance: 0, fines: 0, ipva: 0, insurance: 0, financing: 0 };
const months = (rev: number[], profit: number[]): MonthlyResultDto[] =>
  rev.map((r, i) => ({ month: `2026-${String(6 + i).padStart(2, '0')}`, revenueCents: r, costCents: 0, profitCents: profit[i], costBreakdown: zero }));

function render(m: MonthlyResultDto[]): HTMLElement {
  const fixture = TestBed.createComponent(MonthlyResultChart);
  fixture.componentRef.setInput('months', m);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MonthlyResultChart on a phone', () => {
  const WORST = months([123456789, 98765432, 5, 0, 1450000, 260000], [4567890, -123456, 2, 0, -9000000, 260000]);

  it('bar value labels exist only from sm up: two labels never share ~50px of a month', () => {
    const labels = Array.from(render(WORST).querySelectorAll('[data-bar-value]'));
    expect(labels).toHaveLength(12);
    for (const l of labels) {
      expect(l.className).toContain('hidden');
      expect(l.className).toContain('sm:inline');
    }
  });

  it('the highlighted month is read on ONE line above the bars (phones only), with its signed profit', () => {
    const host = render(WORST);
    const readout = host.querySelector('[data-active-readout]')!;
    expect(readout.className).toContain('sm:hidden');
    expect(readout.textContent).toContain('nov/26');
    expect(readout.textContent).toContain('R$ 2,6k');
    const neg = TestBed.createComponent(MonthlyResultChart);
    neg.componentRef.setInput('months', WORST);
    neg.componentRef.setInput('selected', '2026-10');
    neg.detectChanges();
    const t = (neg.nativeElement as HTMLElement).querySelector('[data-active-readout]')!;
    expect(t.textContent).toContain('out/26');
    expect(t.querySelector('.text-rose-500')).not.toBeNull();
  });

  it('bars use the full column on phones (no empty band), scaled down only from sm', () => {
    const host = render(WORST);
    expect(host.querySelector('[data-bars]')!.className).toContain('[--bar-k:1]');
    expect(host.querySelector('[data-bars]')!.className).toContain('sm:[--bar-k:0.82]');
  });

  it('bars grow in (motion is a class, never hover-only)', () => {
    const bars = render(WORST).querySelectorAll('.bar-rise');
    expect(bars.length).toBe(12);
  });
});

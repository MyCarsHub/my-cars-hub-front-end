import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { GrowthChart, GrowthSeries, endPoint, growthAxisTop, growthIsEmpty, smoothPath } from './growth-chart';

const SERIES: GrowthSeries[] = [
  { key: 'now', label: 'Este mês', color: '#F63B04', values: [2, 6, 12, 20] },
  { key: 'prev', label: 'Mês passado', color: '#94a3b8', values: [1, 5, 10, 18], reference: true },
];
const LABELS = ['dia 1', 'dia 10', 'dia 20', 'dia 30'];

function render(series: GrowthSeries[], extra: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(GrowthChart);
  fixture.componentRef.setInput('series', series);
  fixture.componentRef.setInput('labels', LABELS);
  fixture.componentRef.setInput('ariaLabel', 'Receita no mês');
  for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('smoothPath', () => {
  it('starts at the left edge, ends at the right and inverts y against the top', () => {
    const { line, area } = smoothPath([0, 10], 10);
    expect(line.startsWith('M0.00 100.00')).toBe(true);
    expect(line.endsWith('100.00 0.00')).toBe(true);
    expect(area.endsWith('L100.00 100 L0.00 100 Z')).toBe(true);
  });

  it('never overshoots the 0-100 box on a sudden jump', () => {
    const { line } = smoothPath([0, 0, 10, 10, 0, 0], 10);
    const nums = line.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('is empty without values', () => {
    expect(smoothPath([], 5)).toEqual({ line: '', area: '' });
  });

  it('uses one cubic segment per interval', () => {
    expect(smoothPath([1, 2, 3, 4], 5).line.match(/C/g)).toHaveLength(3);
  });
});

describe('growthAxisTop', () => {
  it('never drops below the floor and follows the real max across series', () => {
    expect(growthAxisTop([{ ...SERIES[0], values: [1, 3] }])).toBe(5);
    expect(growthAxisTop(SERIES)).toBe(20);
    expect(growthAxisTop([{ ...SERIES[0], values: [1] }], 100)).toBe(100);
  });
});

describe('GrowthChart', () => {
  it('draws one line per series, fills only the main one, dashes the reference', () => {
    const el = render(SERIES);
    const lines = el.querySelectorAll('[data-line]');
    expect(lines).toHaveLength(2);
    expect(el.querySelectorAll('[data-area]')).toHaveLength(1);
    // reference is drawn first (behind), dashed and thinner
    expect(lines[0].getAttribute('stroke-dasharray')).toBe('4 4');
    expect(Number(lines[0].getAttribute('stroke-width'))).toBeLessThan(
      Number(lines[1].getAttribute('stroke-width')),
    );
    expect(lines[1].getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('stretches the 0-100 box without keeping the aspect ratio', () => {
    const svg = render(SERIES).querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('can turn the area off', () => {
    expect(render(SERIES, { area: false }).querySelectorAll('[data-area]')).toHaveLength(0);
  });

  it('shows a legend only with more than one series', () => {
    expect(render(SERIES).querySelectorAll('ul li')).toHaveLength(2);
    expect(render([SERIES[0]]).querySelector('ul')).toBeNull();
  });

  it('keeps the accessible table inside a clipping sr-only wrapper (a bare sr-only table widens the page on iOS)', () => {
    const el = render(SERIES);
    const wrapper = el.querySelector('table')!.parentElement!;
    expect(wrapper.className).toContain('sr-only');
  });

  it('repeats the data as text in a table, formatted as pt-BR money', () => {
    const el = render([{ ...SERIES[0], values: [150000, 250000, 0, 100] }], {
      valueFormat: 'brl-cents',
      axisFloor: 10000,
    });
    const cells = [...el.querySelectorAll('table td')].map((c) => c.textContent);
    expect(cells[0]).toContain('1.500,00');
    expect(el.querySelectorAll('table tbody tr')).toHaveLength(4);
  });

  it('thins the x labels to maxXTicks', () => {
    const fixture = TestBed.createComponent(GrowthChart);
    fixture.componentRef.setInput('series', [{ ...SERIES[0], values: Array.from({ length: 30 }, (_, i) => i) }]);
    fixture.componentRef.setInput('labels', Array.from({ length: 30 }, (_, i) => `d${i + 1}`));
    fixture.componentRef.setInput('ariaLabel', 'x');
    fixture.componentRef.setInput('maxXTicks', 5);
    fixture.detectChanges();
    const ticks = (fixture.nativeElement as HTMLElement).querySelectorAll('div.h-5 span');
    expect(ticks).toHaveLength(5);
    expect(ticks[0].textContent).toBe('d1');
    expect(ticks[4].textContent).toBe('d30');
  });
});

describe('GrowthChart with all-zero or negative data', () => {
  const ys = (line: string): number[] =>
    line.replace(/[MC]/g, ' ').split(/\s+/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 1);

  it('smoothPath of an all-zero series is a flat line on the floor, no hump', () => {
    const { line } = smoothPath([0, 0, 0, 0, 0, 0], 10000);
    expect(ys(line).every((y) => y === 100)).toBe(true);
  });

  it('never overshoots the data and keeps negatives on the floor', () => {
    const { line } = smoothPath([0, 500, 0, -300, 0, 0], 1000);
    expect(Math.max(...ys(line))).toBeLessThanOrEqual(100);
    expect(Math.min(...ys(line))).toBeGreaterThanOrEqual(50);
  });

  it('growthIsEmpty is true only when nothing is above zero', () => {
    expect(growthIsEmpty([{ key: 'a', label: 'A', color: '#000', values: [0, 0, -5] }])).toBe(true);
    expect(growthIsEmpty([{ key: 'a', label: 'A', color: '#000', values: [0, 1] }])).toBe(false);
  });

  it('zero data renders the empty sentence instead of a plot and draws no made-up axis', () => {
    const el = render([{ key: 'a', label: 'A', color: '#000', values: [0, 0, 0, 0] }], {
      valueFormat: 'brl-cents',
      axisFloor: 10000,
    });
    expect(el.querySelector('[data-empty]')).not.toBeNull();
    expect(el.querySelector('[data-plot]')).toBeNull();
    expect(el.querySelector('[data-y-axis]')).toBeNull();
    expect(el.querySelector('[data-x-axis]')).toBeNull();
    expect((el.textContent ?? '').replace(/\s+/g, ' ')).not.toContain('R$ 100');
  });
});

describe('GrowthChart over a full month axis (this month stops at today)', () => {
  const DAYS = Array.from({ length: 30 }, (_, i) => String(i + 1));
  const prev = Array.from({ length: 30 }, (_, i) => (i + 1) * 100_000);
  const now = [0, 500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000];
  const SERIES2: GrowthSeries[] = [
    { key: 'previous', label: 'Mês passado', color: '#a3a3a3', reference: true, values: prev },
    { key: 'current', label: 'Este mês', color: '#F63B04', values: now },
  ];
  function renderMonth(series: GrowthSeries[], extra: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(GrowthChart);
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('labels', DAYS);
    fixture.componentRef.setInput('ariaLabel', 'Caixa');
    fixture.componentRef.setInput('valueFormat', 'brl-cents-compact');
    fixture.componentRef.setInput('axisFloor', 10_000);
    for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('a short series keeps its x scale: the last of 6 points sits at day 6 of 30, not at the right edge', () => {
    expect(endPoint(now, 1, 30)!.x).toBeCloseTo((5 / 29) * 100, 5);
    const { line } = smoothPath(now, 3_000_000, 30);
    expect(line.endsWith(`${((5 / 29) * 100).toFixed(2)} ${(100 - (2_500_000 / 3_000_000) * 100).toFixed(2)}`)).toBe(true);
  });

  it('draws the dashed previous month across the whole axis and the solid line only up to today', () => {
    const el = renderMonth(SERIES2, { endDot: true });
    const lines = el.querySelectorAll('[data-line]');
    expect(lines[0].getAttribute('stroke-dasharray')).toBe('4 4');
    const lastX = (d: string) => Number(d.trim().split(' ').slice(-2)[0]);
    expect(lastX(lines[0].getAttribute('d')!)).toBeCloseTo(100, 1);
    expect(lastX(lines[1].getAttribute('d')!)).toBeCloseTo((5 / 29) * 100, 1);
    const dot = el.querySelector('[data-end-dot]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(parseFloat(dot.style.left)).toBeCloseTo((5 / 29) * 100, 1);
  });

  it('no end dot unless asked, and none on the reference line', () => {
    expect(renderMonth(SERIES2).querySelector('[data-end-dot]')).toBeNull();
    expect(renderMonth(SERIES2, { endDot: true }).querySelectorAll('[data-end-dot]')).toHaveLength(1);
  });

  it('prints the requested day marks and compact money on the y axis', () => {
    const el = renderMonth(SERIES2, {
      axisTop: 5_000_000,
      xTickMarks: [1, 5, 10, 15, 20, 25, 30].map((d) => ({ index: d - 1, text: `dia ${d}` })),
    });
    expect([...el.querySelectorAll('[data-x-axis] span')].map((s) => s.textContent!.trim())).toEqual([
      'dia 1', 'dia 5', 'dia 10', 'dia 15', 'dia 20', 'dia 25', 'dia 30',
    ]);
    const y = [...el.querySelectorAll('[data-y-axis] span')].map((s) => s.textContent!.replace(/\s/g, ' ').trim());
    expect(y[0]).toBe('R$ 50k');
    expect(y[y.length - 1]).toBe('R$ 0');
  });

  it('the accessible table keeps the exact money value', () => {
    const el = renderMonth(SERIES2);
    expect(el.querySelector('table tbody td')!.textContent).toContain('1.000,00');
    expect(el.querySelectorAll('table tbody tr')).toHaveLength(30);
  });

  it('stays honest when both months are zero', () => {
    const el = renderMonth(SERIES2.map((s) => ({ ...s, values: s.values.map(() => 0) })), { endDot: true });
    expect(el.querySelector('[data-empty]')).not.toBeNull();
    expect(el.querySelector('[data-end-dot]')).toBeNull();
  });
});

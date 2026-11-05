import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { GrowthChart, GrowthSeries, growthAxisTop, smoothPath } from './growth-chart';

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

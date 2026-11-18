import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  GrowthChart,
  GrowthSeries,
  endPoint,
  growthAxisTop,
  niceAxisTop,
  growthIsEmpty,
  lastMeasured,
  linearPath,
  measuredRuns,
  smoothPath,
} from './growth-chart';

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


/** Tooltip as text: "title | series value | ..." (the template has no spaces between nodes). */
function readTip(root: Element | null | undefined): string | null {
  if (!root) return null;
  const title = root.querySelector('[data-tip-title]')?.textContent?.trim() ?? '';
  const rows = [...root.querySelectorAll('[data-tip-row]')].map((r) =>
    [...r.children].map((c) => c.textContent!.trim()).filter(Boolean).join(' '),
  );
  return [title, ...rows].join(' | ').replace(/\s+/g, ' ');
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

describe('GrowthChart — canvas look', () => {
  it('legend on top, right-aligned, main series first, instead of under the plot', () => {
    const el = render(SERIES, { legendTop: true });
    const legend = el.querySelector('[data-legend-top]')!;
    expect(legend.className).toContain('justify-end');
    expect([...legend.querySelectorAll('li')].map((li) => li.textContent!.trim())).toEqual(['Este mês', 'Mês passado']);
    expect(el.querySelectorAll('ul[aria-label="Legenda"]')).toHaveLength(1);
    expect(el.querySelector('[data-plot]')).not.toBeNull();
  });

  it('the area fades out with a gradient, not a flat fill', () => {
    const el = render(SERIES);
    const fill = el.querySelector('[data-area]')!.getAttribute('fill')!;
    expect(fill).toMatch(/^url\(#growth-fill-/);
    expect(el.querySelector('linearGradient')).not.toBeNull();
  });

  it('end-point tooltip: label, FULL value (cents, not the compact axis) and the reference value', () => {
    const el = render(
      [
        { key: 'now', label: 'Este mês', color: '#F63B04', values: [100000, 4130000] },
        { key: 'prev', label: 'Mês passado', color: '#94a3b8', values: [90000, 3820000], reference: true },
      ],
      { valueFormat: 'brl-cents-compact', endDot: true, endTooltip: true, tooltipLabelPrefix: 'dia ' },
    );
    const text = readTip(el.querySelector('[data-end-tooltip]'))!;
    expect(text).toContain('dia 1');
    expect(text).toContain('Este mês R$ 41.300,00');
    expect(text).toContain('Mês passado R$ 38.200,00');
    expect(text).not.toContain('41,3k');
  });

  it('yDivisions=5 draws six ticks (R$ 0 .. top in steps of a fifth)', () => {
    const el = render(SERIES, { yDivisions: 5, axisTop: 50 });
    expect(el.querySelectorAll('[data-y-axis] span')).toHaveLength(6);
  });
});

describe('linearPath (cumulative totals)', () => {
  it('draws straight segments only: no curve commands, so a staircase never bulges', () => {
    const { line, area } = linearPath([0, 0, 10, 10], 10);
    expect(line).not.toMatch(/C/);
    expect(line).toBe('M0.00 100.00 L33.33 100.00 L66.67 0.00 L100.00 0.00');
    expect(area.endsWith('L100.00 100 L0.00 100 Z')).toBe(true);
  });

  it('smooth=false switches the chart to it; the default stays a curve', () => {
    expect(render(SERIES, { smooth: false }).querySelector('[data-line]')!.getAttribute('d')).not.toMatch(/C/);
    expect(render(SERIES).querySelector('[data-line]')!.getAttribute('d')).toMatch(/C/);
  });

  it('the plot is revealed with draw-in (motion that does not depend on hover)', () => {
    expect(render(SERIES).querySelector('[data-plot]')!.getAttribute('class')).toContain('draw-in');
  });
});

describe('values that were not measured (null)', () => {
  it('splits a series into the stretches that have data', () => {
    expect(measuredRuns([null, 1, 2, null, 4])).toEqual([
      { offset: 1, values: [1, 2] },
      { offset: 4, values: [4] },
    ]);
    expect(lastMeasured([1, 2, null])).toBe(1);
    expect(lastMeasured([null, null])).toBe(-1);
  });

  it('a series that starts later begins at its own x, never at zero', () => {
    const { line } = linearPath([10, 10], 10, 4, 2);
    expect(line).toBe('M66.67 0.00 L100.00 0.00');
    expect(endPoint([10], 10, 4, 3)).toEqual({ x: 100, y: 0 });
  });

  it('the chart draws only the measured part and the table says "sem dado"', () => {
    const el = render([
      { key: 'real', label: 'MRR real', color: '#F63B04', values: [null, null, 8, 12] },
      { key: 'est', label: 'MRR estimado', color: '#999', values: [null, null, null, 15], reference: true },
    ]);
    const lines = el.querySelectorAll('[data-line]');
    const real = lines[1].getAttribute('d')!;
    expect(real.startsWith('M66.67')).toBe(true);
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
    );
    expect(rows[0]).toEqual(['dia 1', 'sem dado', 'sem dado']);
    expect(rows[3]).toEqual(['dia 30', '12', '15']);
  });

  it('only nulls is the empty state', () => {
    expect(growthIsEmpty([{ key: 'a', label: 'A', color: '#000', values: [null, null] }])).toBe(true);
    expect(growthAxisTop([{ key: 'a', label: 'A', color: '#000', values: [null, 30] }])).toBe(30);
  });
});

describe('niceAxisTop', () => {
  it('rounds the top so every tick is a round number', () => {
    // R$ 1.308,00 in cents, four gaps: steps of R$ 400.
    expect(niceAxisTop(130_800, 4)).toBe(160_000);
    expect(niceAxisTop(34, 4, true)).toBe(40);
    // 10 people in four gaps: 3 per step, never 2,5.
    expect(niceAxisTop(10, 4, true)).toBe(12);
    expect(niceAxisTop(3, 4, true)).toBe(4);
    expect(niceAxisTop(0, 4)).toBe(0);
  });
});

/** jsdom may lack PointerEvent: a MouseEvent with the pointer type is what the chart reads. */
function pointer(type: string, init: { clientX?: number; pointerType: string }): Event {
  const ev = new MouseEvent(type, { clientX: init.clientX ?? 0, bubbles: true });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType });
  return ev;
}

describe('GrowthChart reading (hover, tap, keyboard)', () => {
  const MONEY: GrowthSeries[] = [
    { key: 'mrr', label: 'MRR', color: '#F63B04', values: [100000, null, 250050, 300000] },
    { key: 'est', label: 'Estimado', color: '#10B981', values: [120000, 150000, 260000, 310000] },
  ];

  function setup(series: GrowthSeries[] = MONEY, extra: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(GrowthChart);
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('labels', LABELS);
    fixture.componentRef.setInput('ariaLabel', 'MRR');
    fixture.componentRef.setInput('valueFormat', 'brl-cents-compact');
    for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const control = el.querySelector<HTMLElement>('[data-plot-control]')!;
    return { fixture, el, control };
  }

  const tipText = (el: HTMLElement) => readTip(el.querySelector('[data-chart-tooltip]:not([data-end-tooltip])'));

  it('the plot is one keyboard stop, a slider over the x labels', () => {
    const { control } = setup();
    expect(control.getAttribute('tabindex')).toBe('0');
    expect(control.getAttribute('role')).toBe('slider');
    expect(control.getAttribute('aria-valuemax')).toBe('4');
  });

  it('focus opens the tooltip at the newest point, every series in full with cents', () => {
    const { fixture, el, control } = setup();
    control.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    const text = tipText(el)!;
    expect(text).toContain('dia 30');
    expect(text).toContain('MRR R$ 3.000,00');
    expect(text).toContain('Estimado R$ 3.100,00');
    expect(el.querySelectorAll('[data-active-dot]')).toHaveLength(2);
  });

  it('arrows move the reading; a null point says "sem dado" and gets no marker', () => {
    const { fixture, el, control } = setup();
    control.dispatchEvent(new FocusEvent('focus'));
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(tipText(el)).toContain('MRR R$ 2.500,50');
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    const text = tipText(el)!;
    expect(text).toContain('dia 10');
    expect(text).toContain('MRR sem dado');
    expect(el.querySelectorAll('[data-active-dot]')).toHaveLength(1);
    expect(control.getAttribute('aria-valuetext')).toBe('dia 10: MRR sem dado, Estimado R$ 1.500,00');
  });

  it('Escape and blur close the reading', () => {
    const { fixture, el, control } = setup();
    control.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(tipText(el)).toBeNull();
    control.dispatchEvent(new FocusEvent('focus'));
    control.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(tipText(el)).toBeNull();
  });

  it('a pointer (mouse or tap) reads the nearest point; a finger lifting keeps it, a mouse leaving closes it', () => {
    const { fixture, el, control } = setup();
    control.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 100, right: 300, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    control.dispatchEvent(pointer('pointerdown', { clientX: 5, pointerType: 'touch' }));
    fixture.detectChanges();
    expect(tipText(el)).toContain('dia 1');
    control.dispatchEvent(pointer('pointerleave', { pointerType: 'touch' }));
    fixture.detectChanges();
    expect(tipText(el)).toContain('dia 1');
    control.dispatchEvent(pointer('pointermove', { clientX: 210, pointerType: 'mouse' }));
    fixture.detectChanges();
    expect(tipText(el)).toContain('dia 20');
    control.dispatchEvent(pointer('pointerleave', { pointerType: 'mouse' }));
    fixture.detectChanges();
    expect(tipText(el)).toBeNull();
  });

  it('a custom formatter is used in the tooltip and the table', () => {
    const { fixture, el, control } = setup(MONEY, { formatTooltip: (v: number) => `${v / 100} reais` });
    control.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(tipText(el)).toContain('3000 reais');
    expect(el.querySelector('table tbody td')!.textContent).toContain('1000 reais');
  });

  it('interactive=false keeps the plot out of the tab order', () => {
    const { control } = setup(MONEY, { interactive: false });
    expect(control.getAttribute('tabindex')).toBeNull();
    expect(control.getAttribute('role')).toBeNull();
  });
});

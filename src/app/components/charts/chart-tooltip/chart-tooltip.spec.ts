import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  CHART_BLACK,
  CHART_GREEN,
  CHART_GREYS,
  CHART_ORANGE,
  ChartTooltip,
  LABELS_FIT_UNMEASURED_MAX,
  barLabelFormat,
  chartSeriesColors,
  fullValueFormat,
  labelsFit,
  nearestPoint,
  slotAt,
  stepIndex,
  tooltipShift,
  tooltipText,
} from './chart-tooltip';

describe('chart value formats', () => {
  it('a tooltip always says money in full, with cents, whatever the axis uses', () => {
    expect(fullValueFormat('brl-cents-compact')).toBe('brl-cents');
    expect(fullValueFormat('brl-cents-whole')).toBe('brl-cents');
    expect(fullValueFormat('integer')).toBe('integer');
    expect(tooltipText(123456, 'brl-cents-compact')).toBe('R$ 1.234,56');
    expect(tooltipText(123456, 'brl-cents-whole')).toBe('R$ 1.234,56');
  });

  it('a value that was not measured reads "sem dado", never zero', () => {
    expect(tooltipText(null, 'brl-cents')).toBe('sem dado');
    expect(tooltipText(undefined, 'integer')).toBe('sem dado');
    expect(tooltipText(0, 'brl-cents')).toBe('R$ 0,00');
  });

  it('a caller formatter wins', () => {
    expect(tooltipText(5, 'integer', (v) => `${v} carros`)).toBe('5 carros');
  });

  it('the number on a bar is compact money, counts unchanged', () => {
    expect(barLabelFormat('brl-cents')).toBe('brl-cents-compact');
    expect(barLabelFormat('brl-cents-whole')).toBe('brl-cents-compact');
    expect(barLabelFormat('integer')).toBe('integer');
  });
});

describe('chartSeriesColors', () => {
  it('up to four series: orange, green, black, grey in order', () => {
    expect(chartSeriesColors([1, 2])).toEqual([CHART_ORANGE, CHART_GREEN]);
    expect(chartSeriesColors([1, 2, 3, 4])).toEqual([CHART_ORANGE, CHART_GREEN, CHART_BLACK, CHART_GREYS[0]]);
  });

  it('more than four: the biggest orange, the second green, all others grey', () => {
    const colours = chartSeriesColors([10, 50, 5, 40, 1, 2]);
    expect(colours[1]).toBe(CHART_ORANGE);
    expect(colours[3]).toBe(CHART_GREEN);
    for (const i of [0, 2, 4, 5]) expect(CHART_GREYS).toContain(colours[i]);
  });

  it('only brand tokens, never a raw extra hue', () => {
    const all = chartSeriesColors([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const c of all) expect(c).toMatch(/^var\(--color-(primary-500|success-500|fg|fg-muted|fg-faint|fg-subtle|edge-strong)\)$/);
  });
});

describe('pointer and keyboard helpers', () => {
  it('slotAt picks the equal slot under the pointer, clamped', () => {
    expect(slotAt(0, 4)).toBe(0);
    expect(slotAt(0.49, 4)).toBe(1);
    expect(slotAt(0.999, 4)).toBe(3);
    expect(slotAt(1.4, 4)).toBe(3);
    expect(slotAt(-1, 4)).toBe(0);
    expect(slotAt(0.5, 0)).toBeNull();
    expect(slotAt(Number.NaN, 3)).toBeNull();
  });

  it('nearestPoint snaps to the closest of edge-to-edge points', () => {
    expect(nearestPoint(0, 5)).toBe(0);
    expect(nearestPoint(0.6, 5)).toBe(2);
    expect(nearestPoint(1, 5)).toBe(4);
    expect(nearestPoint(0.3, 1)).toBe(0);
  });

  it('stepIndex: arrows step and stop at the ends, Home/End jump, first arrow lands on the newest', () => {
    expect(stepIndex('ArrowLeft', null, 5)).toBe(4);
    expect(stepIndex('ArrowLeft', 2, 5)).toBe(1);
    expect(stepIndex('ArrowLeft', 0, 5)).toBe(0);
    expect(stepIndex('ArrowRight', 4, 5)).toBe(4);
    expect(stepIndex('Home', 3, 5)).toBe(0);
    expect(stepIndex('End', 0, 5)).toBe(4);
    expect(stepIndex('a', 0, 5)).toBeNull();
    expect(stepIndex('ArrowLeft', null, 0)).toBeNull();
  });

  it('tooltipShift hangs the box inward near the edges', () => {
    expect(tooltipShift(5)).toContain('-12px');
    expect(tooltipShift(50)).toBe('translateX(-50%)');
    expect(tooltipShift(95)).toContain('-100%');
  });

  it('labelsFit: by count before measuring, by room per column after', () => {
    expect(labelsFit(LABELS_FIT_UNMEASURED_MAX, 8, null)).toBe(true);
    expect(labelsFit(LABELS_FIT_UNMEASURED_MAX + 1, 8, null)).toBe(false);
    expect(labelsFit(36, 8, 700)).toBe(false);
    expect(labelsFit(9, 8, 700)).toBe(true);
    expect(labelsFit(0, 8, 700)).toBe(false);
  });
});

describe('ChartTooltip', () => {
  it('prints the title and one line per series, hidden from assistive tech', () => {
    const fixture = TestBed.createComponent(ChartTooltip);
    fixture.componentRef.setInput('title', 'nov/26');
    fixture.componentRef.setInput('rows', [
      { key: 'a', label: 'MRR', value: 'R$ 1.234,56', color: CHART_ORANGE },
      { key: 't', label: 'Total', value: 'R$ 2.000,00', strong: true },
    ]);
    fixture.componentRef.setInput('x', 50);
    fixture.componentRef.setInput('y', 40);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('[data-tip-title]')!.textContent).toContain('nov/26');
    const rows = el.querySelectorAll('[data-tip-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('MRR');
    expect(rows[0].textContent).toContain('R$ 1.234,56');
    expect(el.style.left).toBe('50%');
    expect(el.style.top).toBe('40%');
  });
});

import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BarChart, barPct, placeBarValues, zeroSplit, type BarSeries, type BarValueColumn } from './bar-chart';


/** Tooltip as text: "title | series value | ..." (the template has no spaces between nodes). */
function readTip(root: Element | null | undefined): string | null {
  if (!root) return null;
  const title = root.querySelector('[data-tip-title]')?.textContent?.trim() ?? '';
  const rows = [...root.querySelectorAll('[data-tip-row]')].map((r) =>
    [...r.children].map((c) => c.textContent!.trim()).filter(Boolean).join(' '),
  );
  return [title, ...rows].join(' | ').replace(/\s+/g, ' ');
}

describe('BarChart', () => {
  it('barPct scales to the max and clamps', () => {
    expect(barPct(50, 200)).toBe(25);
    expect(barPct(300, 200)).toBe(100);
    expect(barPct(-5, 200)).toBe(0);
    expect(barPct(5, 0)).toBe(0);
  });

  it('renders one row per datum with the BRL text and the widest bar at 100%', () => {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('data', [
      { label: 'Onix', value: 10000 },
      { label: 'Argo', value: 5000 },
    ]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Onix');
    expect(el.textContent).toContain('R$');
    const fills = el.querySelectorAll<HTMLElement>('div.bg-primary-500');
    expect(fills[0].style.width).toBe('100%');
    expect(fills[1].style.width).toBe('50%');
  });

  it('shows the empty copy without data', () => {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sem dados no período.');
  });

  describe('N series in columns', () => {
    const SERIES: BarSeries[] = [
      { key: 'mrr', label: 'MRR', color: '#F63B04', values: [10000, 20000] },
      { key: 'cost', label: 'Custos', color: '#fb7185', values: [null, 5000] },
      { key: 'profit', label: 'Lucro', color: '#0a9b62', values: [null, 15000] },
    ];

    function cols(series: BarSeries[]) {
      const fixture = TestBed.createComponent(BarChart);
      fixture.componentRef.setInput('series', series);
      fixture.componentRef.setInput('labels', ['out', 'nov']);
      fixture.componentRef.setInput('ariaLabel', 'MRR x custos x lucro');
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('draws one group per label and one column per series, scaled to the largest', () => {
      const el = cols(SERIES);
      expect(el.querySelectorAll('[data-bar-group]').length).toBe(2);
      const columns = el.querySelectorAll<HTMLElement>('[data-bar-column]');
      expect(columns.length).toBe(6);
      expect(columns[3].style.height).toBe('100%');
      expect(columns[0].style.height).toBe('50%');
    });

    it('a month without a value is left out and the table says "sem dado", never zero', () => {
      const el = cols(SERIES);
      const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
      );
      expect(rows[0]).toEqual(['out', 'R$\u00a0100,00', 'sem dado', 'sem dado']);
      expect(el.querySelectorAll<HTMLElement>('[data-bar-column]')[1].style.height).toBe('0%');
    });

    it('a loss hangs below the zero line', () => {
      const split = zeroSplit([{ key: 'p', label: 'Lucro', color: '#000', values: [300, -100] }]);
      expect(split.up).toBe(75);
      expect(split.down).toBe(25);
      const el = cols([{ key: 'p', label: 'Lucro', color: '#000', values: [300, -100] }]);
      const negatives = el.querySelectorAll<HTMLElement>('[data-bar-negative]');
      expect(negatives[1].style.height).toBe('100%');
      expect(negatives[0].style.height).toBe('0%');
    });

    it('all series empty shows the empty copy', () => {
      const el = cols([{ key: 'a', label: 'A', color: '#000', values: [null, null] }]);
      expect(el.querySelector('[data-empty]')?.textContent).toContain('Sem dados no período.');
    });
  });
});

/** jsdom may lack PointerEvent: a MouseEvent with the pointer type is what the chart reads. */
function pointer(type: string, init: { clientX?: number; pointerType: string }): Event {
  const ev = new MouseEvent(type, { clientX: init.clientX ?? 0, bubbles: true });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType });
  return ev;
}

describe('BarChart columns reading (hover, tap, keyboard)', () => {
  const SERIES: BarSeries[] = [
    { key: 'mrr', label: 'MRR', color: '#F63B04', values: [123456, 200000, 150000] },
    { key: 'cost', label: 'Custos', color: '#101010', values: [null, 50000, -2500] },
  ];

  function setup(series: BarSeries[] = SERIES, labels = ['set', 'out', 'nov'], format = 'brl-cents-whole') {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('labels', labels);
    fixture.componentRef.setInput('valueFormat', format);
    fixture.componentRef.setInput('ariaLabel', 'MRR x custos');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, control: el.querySelector<HTMLElement>('[data-bar-control]')! };
  }
  const tipText = (el: HTMLElement) => readTip(el.querySelector('[data-chart-tooltip]'));

  it('focus reads the newest group: every series in full with cents, even on a rounded axis', () => {
    const { fixture, el, control } = setup();
    expect(control.getAttribute('role')).toBe('slider');
    expect(control.getAttribute('tabindex')).toBe('0');
    control.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    const text = tipText(el)!;
    expect(text).toContain('nov');
    expect(text).toContain('MRR R$ 1.500,00');
    expect(text).toContain('Custos -R$ 25,00');
    expect(el.querySelectorAll('[data-bar-group]')[2].className).toContain('bg-surface-sunken');
  });

  it('arrows walk the groups; a missing value says "sem dado"', () => {
    const { fixture, el, control } = setup();
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    fixture.detectChanges();
    const text = tipText(el)!;
    expect(text).toContain('MRR R$ 1.234,56');
    expect(text).toContain('Custos sem dado');
    expect(control.getAttribute('aria-valuetext')).toBe('set: MRR R$ 1.234,56, Custos sem dado');
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(tipText(el)).toBeNull();
  });

  it('a tap picks the group under the finger and stays; a mouse leaving closes it', () => {
    const { fixture, el, control } = setup();
    control.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 100, right: 300, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    control.dispatchEvent(pointer('pointerdown', { clientX: 150, pointerType: 'touch' }));
    control.dispatchEvent(pointer('pointerleave', { pointerType: 'touch' }));
    fixture.detectChanges();
    expect(tipText(el)).toContain('out');
    control.dispatchEvent(pointer('pointermove', { clientX: 10, pointerType: 'mouse' }));
    fixture.detectChanges();
    expect(tipText(el)).toContain('set');
    control.dispatchEvent(pointer('pointerleave', { pointerType: 'mouse' }));
    fixture.detectChanges();
    expect(tipText(el)).toBeNull();
  });

  it('prints a compact number on each measured column (sm and up), none on a missing one', () => {
    const { el } = setup();
    const values = [...el.querySelectorAll<HTMLElement>('[data-bar-value]')];
    expect(values).toHaveLength(5);
    expect(values[0].className).toContain('hidden sm:block');
    expect(values.map((v) => v.textContent!.replace(/\s+/g, ' ').trim())).toContain('R$ 1,2k');
  });

  it('too many columns for their numbers: no labels, the tooltip still reads them', () => {
    const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const series: BarSeries[] = ['a', 'b'].map((k) => ({ key: k, label: k, color: '#000', values: many.map(() => 100000) }));
    const { el } = setup(series, many);
    expect(el.querySelectorAll('[data-bar-value]')).toHaveLength(0);
  });
});

/*
 * "Recebido por dia" / "Desconto dado em cupons" (owner, 19/11): a month of days drew hairline
 * columns, labels on top of each other, no scale and no way to tell the amount. The day charts now
 * carry the line charts' y axis, thinned x labels and closer columns.
 */
describe('BarChart day columns (y axis, thinned labels, density)', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, '0')}/11`);

  function setup(values: (number | null)[], opts: { yAxis?: boolean } = {}) {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('series', [{ key: 'r', label: 'Recebido', color: '#0a9b62', values }]);
    fixture.componentRef.setInput('labels', days(values.length));
    fixture.componentRef.setInput('valueFormat', 'brl-cents');
    fixture.componentRef.setInput('legend', false);
    fixture.componentRef.setInput('yAxis', opts.yAxis ?? true);
    fixture.componentRef.setInput('axisFloor', 100_00);
    fixture.componentRef.setInput('emptyText', 'Nenhum pagamento neste período.');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('y axis: five round compact ticks from the nice top down to zero; columns scale to that top', () => {
    const values = days(19).map((_, i) => (i === 3 ? 150_00 : i === 10 ? 75_00 : 0));
    const el = setup(values);
    const ticks = [...el.querySelectorAll('[data-y-axis] span')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(ticks).toEqual(['R$ 160', 'R$ 120', 'R$ 80', 'R$ 40', 'R$ 0']);
    const columns = el.querySelectorAll<HTMLElement>('[data-bar-column]');
    expect(columns[3].style.height).toBe('93.75%');
    expect(columns[10].style.height).toBe('46.875%');
    expect(columns[0].style.height).toBe('0%');
  });

  it('a tiny period still reads against the R$ 100 floor, not a full-height column', () => {
    const el = setup([5_00, 0, 0]);
    expect(el.querySelector('[data-y-axis] span')!.textContent).toContain('R$ 100');
    expect(el.querySelectorAll<HTMLElement>('[data-bar-column]')[0].style.height).toBe('5%');
  });

  it('without yAxis there is no axis and the tallest column fills the plot (other charts unchanged)', () => {
    const el = setup([100_00, 50_00], { yAxis: false });
    expect(el.querySelector('[data-y-axis]')).toBeNull();
    expect(el.querySelectorAll<HTMLElement>('[data-bar-column]')[0].style.height).toBe('100%');
  });

  it('a loss turns the axis off (the zero line is not at the bottom)', () => {
    const el = setup([100_00, -50_00]);
    expect(el.querySelector('[data-y-axis]')).toBeNull();
  });

  it('a whole period of zero is the empty copy, never an empty frame', () => {
    const el = setup(days(30).map(() => 0));
    expect(el.querySelector('[data-bar-control]')).toBeNull();
    expect(el.querySelector('[data-empty]')!.textContent).toContain('Nenhum pagamento neste período.');
  });

  it('x labels: 30 days print first, last and evenly between; the rest keep their box hidden', () => {
    const el = setup(days(30).map((_, i) => (i % 5 === 0 ? 100_00 : 0)));
    const labels = [...el.querySelectorAll<HTMLElement>('[data-x-label]')];
    expect(labels).toHaveLength(30);
    const shown = labels.filter((l) => !l.classList.contains('invisible')).map((l) => l.textContent!.trim());
    expect(shown[0]).toBe('01/11');
    expect(shown[shown.length - 1]).toBe('30/11');
    expect(shown.length).toBeLessThanOrEqual(12);
    expect(shown.length).toBeGreaterThan(2);
  });

  it('a few labels all print', () => {
    const el = setup([100_00, 200_00, 300_00]);
    const hidden = el.querySelectorAll('[data-x-label].invisible');
    expect(hidden).toHaveLength(0);
  });

  it('columns sit closer as the groups multiply, so a month is not a row of hairlines', () => {
    const cls = (n: number) => setup(days(n).map(() => 100_00)).querySelector('[data-bar-columns]')!.className;
    expect(cls(12)).toContain('gap-1.5');
    expect(cls(19)).toContain('gap-0.5');
    expect(cls(19)).not.toContain('gap-1.5');
    expect(cls(30)).toContain('gap-px');
  });

  it('a zero day prints no number; the tooltip still reads it', () => {
    const el = setup([100_00, 0, 300_00]);
    const values = [...el.querySelectorAll('[data-bar-value]')].map((v) => v.textContent!.replace(/\s+/g, ' ').trim());
    expect(values).toEqual(['R$ 100', 'R$ 300']);
    expect(el.querySelector('tbody')!.textContent).toContain('R$ 0,00');
  });
});

/*
 * "Recebido por dia" (owner, 19/11, admin home at 1280px, "Mês atual" = 19 days, card ~350px):
 * the coupon chart printed its two numbers, the received chart printed none. Five paid days with
 * two of them two days apart failed the one spacing rule for the whole chart, though their
 * numbers sit at different heights and never touch.
 */
describe('BarChart numbers on sparse day columns (measured width)', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, '0')}/11`);
  /** The chart host inside a ~350px card (p-4 each side). */
  const HOST_PX = 318;

  class FakeResizeObserver {
    constructor(private readonly cb: (entries: { contentRect: { width: number } }[]) => void) {}
    observe(): void {
      this.cb([{ contentRect: { width: HOST_PX } }]);
    }
    disconnect(): void {}
    unobserve(): void {}
  }

  beforeEach(() => vi.stubGlobal('ResizeObserver', FakeResizeObserver));
  afterEach(() => vi.unstubAllGlobals());

  async function setup(values: number[]) {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('series', [{ key: 'r', label: 'Recebido', color: '#0a9b62', values }]);
    fixture.componentRef.setInput('labels', days(values.length));
    fixture.componentRef.setInput('valueFormat', 'brl-cents');
    fixture.componentRef.setInput('legend', false);
    fixture.componentRef.setInput('yAxis', true);
    fixture.componentRef.setInput('axisFloor', 100_00);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return [...el.querySelectorAll('[data-bar-value]')].map((v) => v.textContent!.replace(/\s+/g, ' ').trim());
  }

  const at = (entries: [number, number][]) => {
    const values = days(19).map(() => 0);
    for (const [i, v] of entries) values[i] = v;
    return values;
  };

  it('the received month of the report: five paid days, two of them two days apart, all print', async () => {
    const printed = await setup(at([[2, 159_80], [5, 79_90], [7, 99_80], [11, 79_90], [13, 149_80]]));
    expect(printed).toEqual(['R$ 160', 'R$ 80', 'R$ 100', 'R$ 80', 'R$ 150']);
  });

  it('the coupon month (two days far apart) still prints both', async () => {
    expect(await setup(at([[4, 50_00], [12, 150_00]]))).toEqual(['R$ 50', 'R$ 150']);
  });

  it('two neighbouring days at the same height cannot both print: the first keeps its number', async () => {
    expect(await setup(at([[4, 100_00], [5, 100_00], [12, 150_00]]))).toEqual(['R$ 100', 'R$ 150']);
  });

  it('a short column beside a tall one loses its number (it would sit on the tall column)', async () => {
    expect(await setup(at([[4, 50_00], [5, 150_00], [12, 100_00]]))).toEqual(['R$ 150', 'R$ 100']);
  });

  it('a loss keeps the one spacing rule (all or none)', async () => {
    expect(await setup(at([[2, 159_80], [4, -79_90], [13, 149_80]]))).toEqual([]);
  });
});

describe('placeBarValues (pure)', () => {
  const col = (pct: number | null, short = 'R$ 100'): BarValueColumn => ({ pct, negative: false, zero: pct === 0, short });
  /** 19 one-column groups over 270px: 14.2px a day, "R$ 100" is ~34px wide. */
  const month = (entries: [number, number][]) => {
    const groups = Array.from({ length: 19 }, () => [col(0)]);
    for (const [i, pct] of entries) groups[i] = [col(pct)];
    return groups;
  };
  const printed = (shown: boolean[][]) => shown.flatMap((g, i) => (g.some(Boolean) ? [i] : []));

  it('numbers two days apart at different heights both print; at the same height only the first', () => {
    expect(printed(placeBarValues(month([[4, 90], [6, 40]]), 270, 138))).toEqual([4, 6]);
    expect(printed(placeBarValues(month([[4, 60], [6, 60]]), 270, 138))).toEqual([4]);
  });

  it('a number never hangs past a side further than allowed', () => {
    const edges = month([[0, 50], [18, 80]]);
    expect(printed(placeBarValues(edges, 270, 138))).toEqual([]);
    expect(printed(placeBarValues(edges, 270, 138, { left: 12, right: 12 }))).toEqual([0, 18]);
  });

  it('zero, missing and negative columns carry no number', () => {
    const shown = placeBarValues([[col(0), col(null), { ...col(50), negative: true }, col(50)]], 400, 138);
    expect(shown).toEqual([[false, false, false, true]]);
  });

  it('unmeasured or empty: nothing', () => {
    expect(placeBarValues([], 270, 138)).toEqual([]);
    expect(placeBarValues([[col(50)]], 0, 138)).toEqual([[false]]);
  });
});

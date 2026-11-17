import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { BarChart, barPct, zeroSplit, type BarSeries } from './bar-chart';

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
      expect(rows[0]).toEqual(['out', 'R$ 100,00', 'sem dado', 'sem dado']);
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

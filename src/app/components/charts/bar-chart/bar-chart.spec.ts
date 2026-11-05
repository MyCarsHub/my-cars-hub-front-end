import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { BarChart, barPct } from './bar-chart';

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
});

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { StackRow, StackedBarChart } from './stacked-bar-chart';

const ROWS: StackRow[] = [
  {
    label: 'Janeiro',
    segments: [
      { key: 'paid', label: 'Pago', value: 30, color: '#10B981' },
      { key: 'open', label: 'Em aberto', value: 10, color: '#F63B04' },
    ],
  },
  { label: 'Fevereiro', segments: [{ key: 'paid', label: 'Pago', value: 20, color: '#10B981' }] },
];

function render(rows: StackRow[], format?: 'brl-cents') {
  const fixture = TestBed.createComponent(StackedBarChart);
  fixture.componentRef.setInput('rows', rows);
  if (format) fixture.componentRef.setInput('valueFormat', format);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('StackedBarChart', () => {
  it('scales every segment against the largest row total', () => {
    const segs = render(ROWS).querySelectorAll<HTMLElement>('[data-segment]');
    expect(segs).toHaveLength(3);
    expect(segs[0].style.width).toBe('75%');
    expect(segs[1].style.width).toBe('25%');
    expect(segs[2].style.width).toBe('50%');
  });

  it('prints the row total and a text summary for assistive tech', () => {
    const el = render(ROWS);
    expect(el.textContent).toContain('40');
    expect(el.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe(
      'Janeiro: Pago 30, Em aberto 10',
    );
  });

  it('formats money in pt-BR when asked', () => {
    const el = render(ROWS, 'brl-cents');
    expect(el.textContent).toContain('R$');
    expect(el.textContent).toContain('0,40');
  });

  it('lists each segment key once in the legend', () => {
    const items = render(ROWS).querySelectorAll('ul li');
    expect([...items].map((li) => li.textContent!.trim())).toEqual(['Pago', 'Em aberto']);
  });

  it('shows the empty copy and no legend without rows', () => {
    const el = render([]);
    expect(el.textContent).toContain('Sem dados no período.');
    expect(el.querySelector('ul')).toBeNull();
  });
});

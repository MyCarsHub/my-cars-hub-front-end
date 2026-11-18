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


/** Tooltip as text: "title | series value | ..." (the template has no spaces between nodes). */
function readTip(root: Element | null | undefined): string | null {
  if (!root) return null;
  const title = root.querySelector('[data-tip-title]')?.textContent?.trim() ?? '';
  const rows = [...root.querySelectorAll('[data-tip-row]')].map((r) =>
    [...r.children].map((c) => c.textContent!.trim()).filter(Boolean).join(' '),
  );
  return [title, ...rows].join(' | ').replace(/\s+/g, ' ');
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

  it('rows layout: hover or focus on a row opens its parts in a tooltip', () => {
    const fixture = TestBed.createComponent(StackedBarChart);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const row = el.querySelector<HTMLElement>('[data-stack-row]')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    row.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(el.querySelector('[data-chart-tooltip]')!.textContent).toContain('Em aberto');
    row.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(el.querySelector('[data-chart-tooltip]')).toBeNull();
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

  describe('columns layout', () => {
    function cols(rows: StackRow[]) {
      const fixture = TestBed.createComponent(StackedBarChart);
      fixture.componentRef.setInput('rows', rows);
      fixture.componentRef.setInput('layout', 'columns');
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('draws one column per row, parts as heights on the shared scale', () => {
      const el = cols(ROWS);
      expect(el.querySelectorAll('[data-stack-column]')).toHaveLength(2);
      const segs = el.querySelectorAll<HTMLElement>('[data-segment]');
      expect(segs[0].style.height).toBe('75%');
      expect(segs[2].style.height).toBe('50%');
      expect(el.querySelector('[data-stack-column]')!.getAttribute('aria-label')).toBe(
        'Janeiro: 40 (Pago 30, Em aberto 10)',
      );
    });

    it('focus reads the newest column: each part (biggest first) and the total, money in full', () => {
      const fixture = TestBed.createComponent(StackedBarChart);
      fixture.componentRef.setInput('rows', ROWS);
      fixture.componentRef.setInput('layout', 'columns');
      fixture.componentRef.setInput('valueFormat', 'brl-cents-whole');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const control = el.querySelector<HTMLElement>('[data-stack-control]')!;
      expect(control.getAttribute('role')).toBe('slider');
      control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
      fixture.detectChanges();
      expect(readTip(el.querySelector('[data-chart-tooltip]'))).toBe('Janeiro | Pago R$ 0,30 | Em aberto R$ 0,10 | Total R$ 0,40');
      expect(control.getAttribute('aria-valuetext')).toBe('Janeiro: Pago R$ 0,30, Em aberto R$ 0,10, Total R$ 0,40');
      control.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();
      expect(el.querySelector('[data-chart-tooltip]')).toBeNull();
    });

    it('prints each column total on top (sm and up), compact', () => {
      const el = cols(ROWS);
      const totals = [...el.querySelectorAll('[data-stack-total]')].map((t) => t.textContent!.trim());
      expect(totals).toEqual(['40', '20']);
      expect(el.querySelector('[data-stack-total]')!.className).toContain('hidden sm:block');
    });

    it('nothing above zero shows the empty copy, not a flat plot', () => {
      const el = cols([{ label: 'Jan', segments: [{ key: 'a', label: 'A', value: 0, color: '#000' }] }]);
      expect(el.querySelector('[data-stack-columns]')).toBeNull();
      expect(el.querySelector('[data-empty]')?.textContent).toContain('Sem dados no período.');
    });
  });
});

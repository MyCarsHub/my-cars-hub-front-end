import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ExpenseBreakdown } from './expense-breakdown';
import type { ExpenseBreakdownDto } from '../../types/dashboard.types';

describe('ExpenseBreakdown', () => {
  function render(breakdown: Partial<ExpenseBreakdownDto> | null): HTMLElement {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(ExpenseBreakdown);
    fixture.componentRef.setInput('breakdown', breakdown);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('renders one row per category with label, money and share', () => {
    const host = render({ maintenance: 10000, fines: 0, ipva: 20000, insurance: 30000, financing: 40000 });
    const rows = host.querySelectorAll('li[data-expense]');
    expect(rows.length).toBe(5);
    const ipva = text(host.querySelector('li[data-expense="ipva"]'));
    expect(ipva).toContain('IPVA');
    expect(ipva).toContain('R$ 200,00');
    expect(ipva).toContain('20%');
    expect(text(host.querySelector('li[data-expense="financing"]'))).toContain('Financiamento');
    expect(text(host.querySelector('li[data-expense="insurance"]'))).toContain('Seguro');
  });

  it('puts colour only in the icon chip: the row has no tint and no divider', () => {
    const host = render({ maintenance: 10000, fines: 5000, ipva: 1, insurance: 1, financing: 1 });
    for (const li of Array.from(host.querySelectorAll('li[data-expense]'))) {
      expect(li.className).not.toMatch(/\bbg-|\bborder/);
      const chip = li.querySelector('span[aria-hidden="true"]');
      expect(chip?.className).toMatch(/bg-/);
    }
  });

  it('shows only the categories that were sent, and nothing without data', () => {
    const host = render({ maintenance: 100, fines: 100 });
    expect(host.querySelectorAll('li[data-expense]').length).toBe(2);
    expect(render(null).querySelector('ul')).toBeNull();
  });
});

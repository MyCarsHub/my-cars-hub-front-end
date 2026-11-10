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

  it('columns follow the container width, not the screen: 2 on phone/dialog, 5 only when wide', () => {
    const host = render({ maintenance: 100, fines: 100, ipva: 100, insurance: 100, financing: 100 });
    const cls = host.querySelector('ul')!.className;
    expect(host.className).toContain('@container');
    expect(cls).toContain('grid-cols-2');
    expect(cls).toContain('@2xl:grid-cols-5');
    expect(cls).not.toContain('lg:grid-cols-5');
    expect(cls).not.toMatch(/(^|\s)grid-cols-5/);
  });

  it('labels and values are never clipped: no truncate, value does not wrap', () => {
    const host = render({ maintenance: 1418898, fines: 0, ipva: 0, insurance: 0, financing: 0 });
    for (const l of Array.from(host.querySelectorAll('[data-expense-label]'))) {
      expect(l.className).not.toContain('truncate');
    }
    const v = host.querySelector('[data-expense-value]')!;
    expect(v.className).not.toContain('truncate');
    expect(v.className).toContain('whitespace-nowrap');
    expect(host.querySelector('[data-expense-share]')).not.toBeNull();
  });

  it('com Gastos são seis linhas em 3 colunas (sem linha órfã) e a de Gastos mostra o valor', () => {
    const host = render({ maintenance: 100, fines: 100, ipva: 100, insurance: 100, financing: 100, expenses: 45000 });
    expect(host.querySelectorAll('li[data-expense]').length).toBe(6);
    const cls = host.querySelector('ul')!.className;
    expect(cls).toContain('@md:grid-cols-3');
    expect(cls).not.toContain('grid-cols-5');
    const row = text(host.querySelector('li[data-expense="expenses"]'));
    expect(row).toContain('Gastos');
    expect(row).toContain('R$ 450,00');
    expect(host.querySelector('li[data-expense="expenses"] span[aria-hidden="true"]')?.className).toMatch(/bg-/);
  });
});

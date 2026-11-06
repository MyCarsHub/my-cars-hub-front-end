import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinancialCalendar } from './financial-calendar';
import type { CashflowEventDto } from '../../../types/dashboard.types';

/**
 * Parity with the owner's canvas: single-letter weekdays, compact square cells with the day
 * number plus dots (never amounts), orange outline on today, "Novembro de 2026" subtitle and
 * three label+value tiles.
 */
describe('FinancialCalendar — canvas parity', () => {
  const ev = (date: string, direction: 'IN' | 'OUT', amountCents: number): CashflowEventDto => ({
    date,
    kind: direction === 'IN' ? 'RENTAL_RECEIPT' : 'FINE_PAID',
    direction,
    amountCents,
    label: 'x',
  });

  const events = [
    ev('2026-11-03', 'IN', 150000),
    ev('2026-11-10', 'IN', 400000),
    ev('2026-11-10', 'OUT', 90000),
    ev('2026-11-15', 'OUT', 30000),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 12));
  });
  afterEach(() => vi.useRealTimers());

  function render(selected: string | null = null) {
    const fixture = TestBed.createComponent(FinancialCalendar);
    fixture.componentRef.setInput('events', events);
    fixture.componentRef.setInput('selectedDate', selected);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const cellOf = (host: HTMLElement, day: number) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Dia "]')).find((b) =>
      new RegExp(`^Dia ${day}(,|$)`).test(b.getAttribute('aria-label')!),
    )!;

  it('weekday header is the single letters D S T Q Q S S', () => {
    const { host } = render();
    const letters = Array.from(host.querySelectorAll('[data-weekday]')).map((e) => e.textContent!.trim());
    expect(letters).toEqual(['D', 'S', 'T', 'Q', 'Q', 'S', 'S']);
  });

  it('subtitle reads "Novembro de 2026": only the first letter is capitalised', () => {
    const { host } = render();
    const label = host.querySelector('[data-calendar-month]')!.textContent!.trim();
    expect(label).toBe('Novembro de 2026');
    expect(host.textContent).not.toContain('De 2026');
  });

  it('cells show the day number and dots, never an amount', () => {
    const { host } = render();
    expect(host.textContent).not.toMatch(/R\$\s?\d+(,\d+)?k/);
    const ten = cellOf(host, 10);
    expect(ten.textContent!.trim()).toBe('10');
    expect(ten.querySelector('[data-dot="in"]')).not.toBeNull();
    expect(ten.querySelector('[data-dot="out"]')).not.toBeNull();
    const three = cellOf(host, 3);
    expect(three.querySelector('[data-dot="in"]')).not.toBeNull();
    expect(three.querySelector('[data-dot="out"]')).toBeNull();
    const fifteen = cellOf(host, 15);
    expect(fifteen.querySelector('[data-dot="out"]')).not.toBeNull();
    expect(fifteen.querySelector('[data-dot="in"]')).toBeNull();
    const eleven = cellOf(host, 11);
    expect(eleven.querySelectorAll('[data-dot]').length).toBe(0);
  });

  it('a day with two events shows two dots and no count badge or text beyond the number', () => {
    const { host } = render();
    const ten = cellOf(host, 10);
    expect(ten.querySelectorAll('span').length).toBe(3); // number + 2 dots
    expect(ten.textContent!.replace(/\s/g, '')).toBe('10');
  });

  it('tiles sit in ONE row of three at every width and there is no multi-line legend', () => {
    const { host } = render();
    const row = host.querySelector('[data-tile="in"]')!.parentElement!;
    expect(row.className).toContain('grid-cols-3');
    expect(row.className).not.toContain('grid-cols-2');
    expect(host.querySelectorAll('[data-tile]').length).toBe(3);
    expect(host.textContent).not.toContain('Pagamentos (');
  });

  it('cells are square touch targets', () => {
    const { host } = render();
    expect(cellOf(host, 10).className).toContain('aspect-square');
  });

  it('today gets the orange outline and orange number, no other day does', () => {
    const { host } = render();
    const today = host.querySelectorAll('[data-today]');
    expect(today.length).toBe(1);
    expect(today[0].textContent!.trim()).toBe('4');
    expect(today[0].className).toContain('border-primary-500');
    expect(today[0].className).toContain('text-primary-500');
  });

  it('tiles carry only label and value: no event counts, no long captions', () => {
    const { host } = render();
    const tile = (k: string) => host.querySelector(`[data-tile="${k}"]`)!.textContent!.replace(/\s+/g, ' ').trim();
    expect(tile('in')).toMatch(/^Recebimentos\s*R\$\s?5.500$/);
    expect(tile('out')).toMatch(/^Pagamentos\s*R\$\s?1\.200$/);
    expect(tile('balance')).toMatch(/^Saldo projetado\s*R\$\s?4\.300$/);
    expect(host.textContent).not.toContain('evento(s)');
    expect(host.textContent).not.toContain('manutenções');
    expect(host.querySelector('[data-tile="balance"] p:last-child')!.className).toContain('text-fg-body');
  });

  it('tapping a day still emits its ISO date', () => {
    const { fixture, host } = render();
    const spy = vi.fn();
    fixture.componentInstance.daySelect.subscribe(spy);
    cellOf(host, 10).click();
    expect(spy).toHaveBeenCalledWith('2026-11-10');
  });

  it('month navigation changes the subtitle and emits monthChange', () => {
    const { fixture, host } = render();
    const spy = vi.fn();
    fixture.componentInstance.monthChange.subscribe(spy);
    host.querySelector<HTMLButtonElement>('button[aria-label="Próximo mês"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-calendar-month]')!.textContent!.trim()).toBe('Dezembro de 2026');
    expect(spy).toHaveBeenCalledWith('2026-12');
  });
});

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FilterChipOption } from '../../filter-chip-group/filter-chip-group';
import { ListFilterSelect, ListToolbar, resultsLabel } from './list-toolbar';

type Status = 'ALL' | 'ACTIVE' | 'INACTIVE';

const STATUS: FilterChipOption<Status>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'INACTIVE', label: 'Inativos' },
];

@Component({
  imports: [ListToolbar, ListFilterSelect],
  template: `
    <app-list-toolbar
      searchLabel="Buscar usuários"
      searchPlaceholder="Buscar por nome ou e-mail…"
      [query]="query()"
      [searchDebounce]="debounce()"
      [statusOptions]="withPills() ? statusOptions : null"
      [status]="status()"
      [resultCount]="count()"
      [resultNoun]="['usuário', 'usuários']"
      [filtersActive]="active()"
      (queryChange)="queries.push($event); query.set($event)"
      (statusChange)="status.set($event)"
      (clearFilters)="cleared = cleared + 1"
    >
      @if (withSelect()) {
        <select listFilterSelect aria-label="Papel" data-role>
          <option>Papel: Todos</option>
        </select>
      }
    </app-list-toolbar>
  `,
})
class Host {
  readonly statusOptions = STATUS;
  readonly query = signal('');
  readonly debounce = signal(0);
  readonly withPills = signal(true);
  readonly withSelect = signal(true);
  readonly status = signal<Status>('ALL');
  readonly count = signal<number | null>(12);
  readonly active = signal(false);
  readonly queries: string[] = [];
  cleared = 0;
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, host: fixture.componentInstance };
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

describe('ListToolbar', () => {
  afterEach(() => vi.useRealTimers());

  it('search is a labelled 44px type=search field with 16px text at every width', () => {
    const { el } = render();
    const input = el.querySelector<HTMLInputElement>('[data-list-search]')!;
    expect(input.type).toBe('search');
    expect(input.placeholder).toBe('Buscar por nome ou e-mail…');
    expect(el.querySelector(`label[for="${input.id}"]`)!.textContent).toContain('Buscar usuários');
    expect(input.className).toContain('min-h-[44px]');
    expect(input.className).toContain('text-base');
    expect(input.className).not.toMatch(/(^|\s)(sm|md|lg):text-(sm|xs)/);
  });

  it('projects the selects on the search line, styled 44px / 16px', () => {
    const { el } = render();
    const select = el.querySelector<HTMLSelectElement>('[data-list-selects] select[data-role]')!;
    expect(select).not.toBeNull();
    expect(select.className).toContain('min-h-[44px]');
    expect(select.className).toContain('text-base');
  });

  it('emits each keystroke without debounce', () => {
    const { el, host } = render();
    type(el.querySelector<HTMLInputElement>('[data-list-search]')!, 'an');
    expect(host.queries).toEqual(['an']);
  });

  it('debounces server searches to the last keystroke', () => {
    vi.useFakeTimers();
    const { fixture, el, host } = render();
    host.debounce.set(300);
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('[data-list-search]')!;
    type(input, 'a');
    type(input, 'an');
    type(input, 'ana');
    vi.advanceTimersByTime(299);
    expect(host.queries).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.queries).toEqual(['ana']);
  });

  it('a query set by the page rewrites the field', () => {
    const { fixture, el, host } = render();
    host.query.set('maria');
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('[data-list-search]')!.value).toBe('maria');
  });

  it('situation pills are ONE scrollable app-filter-chip-group; orange when active', () => {
    const { fixture, el, host } = render();
    expect(el.querySelectorAll('app-filter-chip-group')).toHaveLength(1);
    const radios = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.textContent!.trim())).toEqual(['Todos', 'Ativos', 'Inativos']);
    expect(el.querySelector('[role="radiogroup"]')!.className).toContain('overflow-x-auto');
    radios[1].click();
    fixture.detectChanges();
    expect(host.status()).toBe('ACTIVE');
    expect(radios[1].className).toContain('bg-primary-500');
  });

  it('no pill row when there are no options', () => {
    const { fixture, el, host } = render();
    host.withPills.set(false);
    fixture.detectChanges();
    expect(el.querySelector('app-filter-chip-group')).toBeNull();
  });

  it('results count is a polite status in pt-BR, singular for one', () => {
    const { fixture, el, host } = render();
    const results = () => el.querySelector('[data-list-results]');
    expect(results()!.getAttribute('role')).toBe('status');
    expect(results()!.textContent!.trim()).toBe('12 usuários');
    host.count.set(1);
    fixture.detectChanges();
    expect(results()!.textContent!.trim()).toBe('1 usuário');
    host.count.set(null);
    fixture.detectChanges();
    expect(results()).toBeNull();
  });

  it('"Limpar filtros" shows only with an active filter, empties the search and emits', () => {
    const { fixture, el, host } = render();
    expect(el.querySelector('[data-list-clear]')).toBeNull();
    type(el.querySelector<HTMLInputElement>('[data-list-search]')!, 'ana');
    host.active.set(true);
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-list-clear]')!.click();
    fixture.detectChanges();
    expect(host.cleared).toBe(1);
    expect(host.queries.at(-1)).toBe('');
    expect(el.querySelector<HTMLInputElement>('[data-list-search]')!.value).toBe('');
  });

  it('clearing cancels a pending debounced search', () => {
    vi.useFakeTimers();
    const { fixture, el, host } = render();
    host.debounce.set(300);
    host.active.set(true);
    fixture.detectChanges();
    type(el.querySelector<HTMLInputElement>('[data-list-search]')!, 'ana');
    el.querySelector<HTMLButtonElement>('[data-list-clear]')!.click();
    vi.advanceTimersByTime(1000);
    expect(host.queries).toEqual(['']);
  });

  it('draws no divider lines', () => {
    const { fixture, el, host } = render();
    host.active.set(true);
    fixture.detectChanges();
    expect(el.innerHTML).not.toMatch(/divide-|border-b\b|border-t\b|border-y\b/);
  });
});

describe('resultsLabel', () => {
  it('groups thousands in pt-BR', () => {
    expect(resultsLabel(1234, ['resultado', 'resultados'])).toBe('1.234 resultados');
    expect(resultsLabel(0, ['resultado', 'resultados'])).toBe('0 resultados');
  });
});

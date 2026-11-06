import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { RankingCard, RankingItem } from './ranking-card';

const ITEMS: RankingItem[] = [
  { id: '1', name: 'Carlos Mendes', sub: 'QWE-4F21', value: 'R$ 7.500' },
  { id: '2', name: 'Bruno Almeida', value: 'R$ 7.355' },
  { id: '3', name: 'Rafael Costa', value: 'R$ 6.479' },
];

function render(opts: { hero?: boolean; limit?: number; items?: RankingItem[] } = {}) {
  const fixture = TestBed.createComponent(RankingCard);
  fixture.componentRef.setInput('title', 'Top motoristas');
  fixture.componentRef.setInput('items', opts.items ?? ITEMS);
  if (opts.hero !== undefined) fixture.componentRef.setInput('hero', opts.hero);
  if (opts.limit !== undefined) fixture.componentRef.setInput('limit', opts.limit);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('RankingCard', () => {
  it('numbers the rows from 1 and shows name, sub and value', () => {
    const rows = render().querySelectorAll('[data-rank-row]');
    expect(rows).toHaveLength(3);
    const badge = rows[0].querySelector('[data-rank-badge]')!;
    expect(badge.querySelector('[aria-hidden="true"]')!.textContent).toBe('1');
    expect(badge.querySelector('.sr-only')!.textContent).toBe('1º lugar');
    expect(badge.hasAttribute('aria-label')).toBe(false);
    expect(rows[0].textContent).toContain('QWE-4F21');
    expect(rows[2].textContent).toContain('R$ 6.479');
  });

  it('cuts at the limit', () => {
    expect(render({ limit: 2 }).querySelectorAll('[data-rank-row]')).toHaveLength(2);
  });

  it('paints only the first row when hero is on', () => {
    const rows = render({ hero: true }).querySelectorAll('[data-rank-row]');
    expect(rows[0].className).toContain('bg-primary-500');
    expect(rows[0].className).toContain('text-white');
    expect(rows[1].className).not.toContain('bg-primary-500');
  });

  it('has no hero row by default', () => {
    const rows = render().querySelectorAll('[data-rank-row]');
    expect(rows[0].className).not.toContain('bg-primary-500');
  });

  it('shows the empty copy and no divider classes', () => {
    const el = render({ items: [] });
    expect(el.textContent).toContain('Sem dados no período.');
    expect(render().querySelector('ol')!.outerHTML).not.toMatch(/divide-|border-b|border-t/);
  });
});

describe('RankingCard podium', () => {
  it('first place wraps instead of truncating the driver name', () => {
    const fixture = TestBed.createComponent(RankingCard);
    fixture.componentRef.setInput('title', 'Top motoristas');
    fixture.componentRef.setInput('layout', 'podium');
    fixture.componentRef.setInput('items', [{ id: '1', name: 'Maria Aparecida de Souza Albuquerque Neto', value: 'R$ 7.500' }, ...ITEMS.slice(1)]);
    fixture.detectChanges();
    const name = (fixture.nativeElement as HTMLElement).querySelector('[data-hero-name]')!;
    expect(name.className).toContain('break-words');
    expect(name.className).not.toContain('truncate');
  });
});

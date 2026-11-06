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
  const LONG = [
    { id: '1', name: 'THIAGO PAULO PEREIRA DE SANTANA FILHO', value: 'R$ 7.500' },
    { id: '2', name: 'MARCOS ANTONIO DO NASCIMENTO JUNIOR', value: 'R$ 3.100' },
    { id: '3', name: 'MAXSUEL SANTOS DA SILVA', value: 'R$ 3.000' },
  ];
  function podium(): HTMLElement {
    const fixture = TestBed.createComponent(RankingCard);
    fixture.componentRef.setInput('title', 'Top 5 motoristas por receita');
    fixture.componentRef.setInput('layout', 'podium');
    fixture.componentRef.setInput('items', LONG);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('first place is ONE line with an ellipsis and the full name in the tooltip', () => {
    const name = podium().querySelector('[data-hero-name]')!;
    expect(name.className).toContain('truncate');
    expect(name.className).not.toContain('break-words');
    expect(name.getAttribute('title')).toBe(LONG[0].name);
    expect(name.parentElement!.className).toContain('min-w-0');
  });

  it('first place has a fixed height, so the card height never depends on the name', () => {
    expect(podium().querySelector('[data-rank-row]')!.className).toContain('h-14');
  });

  it('the small chips truncate, carry the name as tooltip and have a fixed height', () => {
    const chips = Array.from(podium().querySelectorAll('[data-rank-chip]'));
    expect(chips.length).toBe(2);
    for (const chip of chips) {
      expect(chip.className).toContain('h-12');
      expect(chip.className).toContain('min-w-0');
      const name = chip.querySelector('.font-medium')!;
      expect(name.className).toContain('truncate');
      expect(name.getAttribute('title')).toBeTruthy();
      expect(chip.innerHTML).not.toContain('break-words');
    }
  });

  it('the card title is a single truncated line (headers of side-by-side cards stay aligned)', () => {
    const h2 = podium().querySelector('h2')!;
    expect(h2.className).toContain('truncate');
    expect(h2.getAttribute('title')).toBe('Top 5 motoristas por receita');
  });
});

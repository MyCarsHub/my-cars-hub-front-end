import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { HEATMAP_MIN_LEVEL, Heatmap, HeatmapRow, heatLevel } from './heatmap';

const ROWS: HeatmapRow[] = [
  { key: 'mon', label: 'Seg', values: [0, 4, 8] },
  { key: 'tue', label: 'Ter', values: [1, null, 2] },
];

function render(rows: HeatmapRow[] = ROWS) {
  const fixture = TestBed.createComponent(Heatmap);
  fixture.componentRef.setInput('rows', rows);
  fixture.componentRef.setInput('columns', ['0h', '2h', '4h']);
  fixture.componentRef.setInput('ariaLabel', 'Ações por dia e hora');
  fixture.componentRef.setInput('unit', 'ações');
  fixture.componentRef.setInput('ticks', [{ index: 0, text: '0h' }, { index: 2, text: '4h' }]);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('heatLevel', () => {
  it('zero is the empty tile, the max is full, small values never vanish', () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(8, 8)).toBe(1);
    expect(heatLevel(4, 8)).toBe(0.5);
    expect(heatLevel(0.1, 8)).toBe(HEATMAP_MIN_LEVEL);
  });

  it('a cell that was not measured stays null, never zero', () => {
    expect(heatLevel(null, 8)).toBeNull();
  });

  it('a grid with nothing in it is all zero', () => {
    expect(heatLevel(3, 0)).toBe(0);
  });
});

describe('Heatmap', () => {
  it('draws one tile per value and one row per row', () => {
    const el = render();
    expect(el.querySelectorAll('[data-heat-row]').length).toBe(2);
    expect(el.querySelectorAll('[data-heat-cell]').length).toBe(6);
  });

  it('keeps the numbers in a screen-reader table, "sem dado" for the hollow cell', () => {
    const el = render();
    const cells = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
    );
    expect(cells[0]).toEqual(['Seg', '0', '4', '8']);
    expect(cells[1]).toEqual(['Ter', '1', 'sem dado', '2']);
  });

  it('the tooltip says the value with its unit', () => {
    const el = render();
    const tiles = el.querySelectorAll<HTMLElement>('[data-heat-cell]');
    expect(tiles[2].getAttribute('title')).toBe('Seg 4h: 8 ações');
    expect(tiles[4].getAttribute('title')).toBe('Ter 2h: sem dado');
  });

  it('never paints the brand orange by default', () => {
    const el = render();
    const html = el.innerHTML.toLowerCase();
    expect(html).not.toContain('#f63b04');
    expect(html).not.toContain('primary');
  });

  it('prints the axis marks it was given', () => {
    const el = render();
    expect(el.querySelector('[data-heat-ticks]')?.textContent).toContain('4h');
  });
});

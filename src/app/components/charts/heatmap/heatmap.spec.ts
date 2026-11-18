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

/** jsdom may lack PointerEvent: a bubbling MouseEvent with the pointer type is what the grid reads. */
function pointer(type: string, pointerType: string): Event {
  const ev = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  return ev;
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

  it('hover/tap on a tile opens a tooltip: row, column, value with its unit; hollow tile says "sem dado"', () => {
    const fixture = TestBed.createComponent(Heatmap);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('columns', ['0h', '2h', '4h']);
    fixture.componentRef.setInput('ariaLabel', 'Ações por dia e hora');
    fixture.componentRef.setInput('unit', 'ações');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tiles = el.querySelectorAll<HTMLElement>('[data-heat-cell]');
    expect(tiles[2].getAttribute('title')).toBeNull();
    tiles[2].dispatchEvent(pointer('pointerdown', 'touch'));
    fixture.detectChanges();
    let tip = readTip(el.querySelector('[data-chart-tooltip]'))!;
    expect(tip).toContain('Seg');
    expect(tip).toContain('4h 8 ações');
    tiles[4].dispatchEvent(pointer('pointermove', 'mouse'));
    fixture.detectChanges();
    tip = readTip(el.querySelector('[data-chart-tooltip]'))!;
    expect(tip).toContain('2h sem dado');
    el.querySelector('[data-heatmap]')!.dispatchEvent(pointer('pointerleave', 'mouse'));
    fixture.detectChanges();
    expect(el.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('the grid is one keyboard stop; arrows walk the tiles and announce them politely', () => {
    const fixture = TestBed.createComponent(Heatmap);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('columns', ['0h', '2h', '4h']);
    fixture.componentRef.setInput('ariaLabel', 'Ações por dia e hora');
    fixture.componentRef.setInput('unit', 'ações');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const grid = el.querySelector<HTMLElement>('[data-heatmap]')!;
    expect(grid.getAttribute('tabindex')).toBe('0');
    grid.dispatchEvent(new FocusEvent('focus'));
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(el.querySelector('[data-heat-live]')!.textContent).toBe('Ter 2h: sem dado');
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    fixture.detectChanges();
    expect(el.querySelector('[data-heat-live]')!.textContent).toBe('Ter 4h: 2 ações');
    expect(el.querySelector('[data-chart-tooltip]')!.textContent).toContain('2 ações');
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[data-chart-tooltip]')).toBeNull();
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

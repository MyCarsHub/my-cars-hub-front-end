import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataList, type DataListColumn, fitLayout, joinPt } from './data-list';

/**
 * `fit` (prod, 19/11/2026): the cross table of the admin home rendered 928px inside a 743px card
 * at a 1195px window with the sidebar open, and MRR and Saúde sat behind a sideways scroll.
 * jsdom has no layout, so these specs give the list a fake one: each header has a width, the
 * table's narrowest layout is the sum of the headers still drawn, and the room is the wrap.
 */

interface Row {
  id: number;
  name: string;
  vehicles: number;
  mrr: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Locadora Silva', vehicles: 12, mrr: 19900 },
  { id: 2, name: 'Frota Sul', vehicles: 3, mrr: 0 },
];

const COLUMNS: DataListColumn<Row>[] = [
  { key: 'name', header: 'Empresa', primary: true, value: (r) => r.name },
  { key: 'vehicles', header: 'Veíc.', kind: 'integer', end: true, optional: true, value: (r) => r.vehicles },
  { key: 'mrr', header: 'MRR', kind: 'money-cents', end: true, value: (r) => r.mrr },
];

/** Fake column widths (px) at the table's narrowest layout. */
const WIDTH: Record<string, number> = { Empresa: 300, 'Veíc.': 120, MRR: 200 };

@Component({
  imports: [DataList],
  template: `
    <app-data-list
      [columns]="columns()"
      [rows]="rows"
      [rowId]="rowId"
      [fit]="fit()"
      cardsBelow="lg"
      ariaLabel="Empresas"
    />
  `,
})
class FitHost {
  readonly columns = signal<DataListColumn<Row>[]>(COLUMNS);
  readonly rows = ROWS;
  readonly fit = signal(true);
  readonly rowId = (r: Row) => r.id;
}

let room = 1000;
let observers: Array<() => void> = [];
/** Animation frames run when the spec says so (Angular's scheduler uses them too). */
let frames: FrameRequestCallback[] = [];

function flushFrames(): void {
  for (let i = 0; i < 20 && frames.length; i++) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(0));
  }
}

class FakeResizeObserver {
  constructor(private readonly cb: () => void) {
    observers.push(() => this.cb());
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

function rect(width: number): DOMRect {
  return { width, height: 40, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 40, toJSON: () => ({}) } as DOMRect;
}

function fakeWidth(el: Element): number {
  if (el.hasAttribute('data-table-wrap')) return room;
  if (el.tagName === 'TH') {
    if (el.classList.contains('hidden')) return 0;
    return WIDTH[el.textContent!.trim()] ?? 48;
  }
  if (el.tagName === 'TABLE') {
    const min = [...el.querySelectorAll('th')].reduce((sum, th) => sum + fakeWidth(th), 0);
    return (el as HTMLElement).style.width === '0px' ? min : Math.max(min, room);
  }
  return 0;
}

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    flushFrames();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

async function render() {
  const fixture = TestBed.createComponent(FitHost);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
}

/** The window or the sidebar changed the list's width. */
async function resize(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }, width: number) {
  room = width;
  observers.forEach((notify) => notify());
  await settle(fixture);
}

const visibleHeaders = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-table] th[scope="col"]')]
    .filter((th) => !th.classList.contains('hidden'))
    .map((th) => th.textContent!.trim());

describe('fitLayout (pure rule)', () => {
  it('whole table while it fits, then without the optional columns, then cards', () => {
    expect(fitLayout(800, 620, 120)).toBe('table');
    expect(fitLayout(619.5, 620, 120)).toBe('table'); // sub-pixel slack
    expect(fitLayout(600, 620, 120)).toBe('compact');
    expect(fitLayout(500, 620, 120)).toBe('compact');
    expect(fitLayout(498, 620, 120)).toBe('cards');
  });

  it('a table with no optional column goes straight to cards', () => {
    expect(fitLayout(600, 620, 0)).toBe('cards');
  });
});

describe('joinPt', () => {
  it('joins in Portuguese', () => {
    expect(joinPt([])).toBe('');
    expect(joinPt(['A'])).toBe('A');
    expect(joinPt(['A', 'B'])).toBe('A e B');
    expect(joinPt(['A', 'B', 'C'])).toBe('A, B e C');
  });
});

describe('DataList fit — the table only shows where it fits, never a sideways scroll', () => {
  beforeEach(() => {
    room = 1000;
    observers = [];
    frames = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rect(fakeWidth(this));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('room for every column: the whole table, cards only below lg, no note', async () => {
    const { el } = await render();
    const wrap = el.querySelector('[data-table-wrap]')!;
    expect(wrap.getAttribute('data-fit')).toBe('table');
    expect(visibleHeaders(el)).toEqual(['Empresa', 'Veíc.', 'MRR']);
    expect(wrap.className).toContain('lg:block');
    expect(wrap.className).not.toContain('invisible');
    expect(el.querySelector('[data-cards]')!.className).toContain('lg:hidden');
    expect(el.querySelector('[data-dropped-columns]')).toBeNull();
  });

  it('short of room: the optional columns step out first and the table says which', async () => {
    const { fixture, el } = await render();
    await resize(fixture, 560); // 620 needed, 500 without "Veíc."
    const wrap = el.querySelector('[data-table-wrap]')!;
    expect(wrap.getAttribute('data-fit')).toBe('compact');
    expect(visibleHeaders(el)).toEqual(['Empresa', 'MRR']);
    // Every cell of the dropped column leaves with its header; the others stay.
    const rows = [...el.querySelectorAll('[data-table] [data-row]')];
    for (const row of rows) {
      const tds = [...row.querySelectorAll('td')];
      expect(tds.map((td) => td.classList.contains('hidden'))).toEqual([false, true, false]);
    }
    const note = el.querySelector('[data-dropped-columns]')!;
    expect(note.textContent!.trim()).toBe('Sem espaço nesta largura para Veíc.');
    // The note lives with the table: below lg the cards show and the note goes with the table.
    expect(note.className).toContain('lg:block');
    // The card keeps every field.
    expect(el.querySelectorAll('[data-cards] [data-card]')[0].querySelectorAll('dt')).toHaveLength(2);
  });

  it('not even the core columns fit: cards, and the table stays laid out unseen to keep measuring', async () => {
    const { fixture, el } = await render();
    await resize(fixture, 400);
    const wrap = el.querySelector('[data-table-wrap]')!;
    expect(wrap.getAttribute('data-fit')).toBe('cards');
    expect(wrap.className).toContain('invisible');
    expect(wrap.className).toContain('absolute');
    expect(wrap.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('[data-cards]')!.className).not.toContain('lg:hidden');
    expect(el.querySelector('[data-dropped-columns]')).toBeNull();
    // All columns are drawn in the unseen table, so the next measure knows the whole width.
    expect(visibleHeaders(el)).toEqual(['Empresa', 'Veíc.', 'MRR']);
  });

  it('widening again brings the columns back (compact remembers the width of what it hid)', async () => {
    const { fixture, el } = await render();
    await resize(fixture, 560);
    expect(el.querySelector('[data-table-wrap]')!.getAttribute('data-fit')).toBe('compact');
    await resize(fixture, 700);
    expect(el.querySelector('[data-table-wrap]')!.getAttribute('data-fit')).toBe('table');
    await resize(fixture, 400);
    expect(el.querySelector('[data-table-wrap]')!.getAttribute('data-fit')).toBe('cards');
    await resize(fixture, 1200);
    expect(el.querySelector('[data-table-wrap]')!.getAttribute('data-fit')).toBe('table');
    expect(visibleHeaders(el)).toEqual(['Empresa', 'Veíc.', 'MRR']);
  });

  it('without optional columns the table goes straight to cards', async () => {
    const { fixture, el, host } = await render();
    host.columns.set(COLUMNS.map((c) => ({ ...c, optional: false })));
    fixture.detectChanges();
    await resize(fixture, 560);
    expect(el.querySelector('[data-table-wrap]')!.getAttribute('data-fit')).toBe('cards');
  });

  it('without fit nothing changes: breakpoint classes only, the table scrolls inside itself', async () => {
    const { fixture, el, host } = await render();
    host.fit.set(false);
    fixture.detectChanges();
    await resize(fixture, 300);
    const wrap = el.querySelector('[data-table-wrap]')!;
    expect(wrap.hasAttribute('data-fit')).toBe(false);
    expect(wrap.className).toContain('overflow-x-auto');
    expect(wrap.className).not.toContain('invisible');
    expect(visibleHeaders(el)).toEqual(['Empresa', 'Veíc.', 'MRR']);
    expect(el.querySelector('[data-cards]')!.className).toContain('lg:hidden');
  });
});

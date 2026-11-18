import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { buildCsv } from './data-list-csv';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListBreakpoint,
  type DataListColumn,
  pagerLabel,
} from './data-list';
import { DataListMenuItem } from './data-list-menu-item';

interface Row {
  id: number;
  plate: string;
  status: string;
  rentCents: number;
}

const ROWS: Row[] = [
  { id: 1, plate: 'QWE-4F21', status: 'Ativo', rentCents: 123456 },
  { id: 2, plate: '=CMD("x")', status: 'Em atraso', rentCents: 50 },
];

const COLUMNS: DataListColumn<Row>[] = [
  { key: 'plate', header: 'Placa', primary: true, value: (r) => r.plate },
  {
    key: 'status',
    header: 'Situação',
    kind: 'status',
    value: (r) => r.status,
    tone: (r) => (r.status === 'Ativo' ? 'green' : 'red'),
  },
  { key: 'rent', header: 'Aluguel (R$)', kind: 'money-cents', end: true, value: (r) => r.rentCents },
];

@Component({
  imports: [DataList, DataListActions, DataListCell, DataListMenuItem],
  template: `
    <app-data-list
      [columns]="columns"
      [rows]="rows()"
      [loading]="loading()"
      [exportFilename]="filename()"
      emptyText="Nenhum veículo."
      [rowId]="rowId"
      [cardsBelow]="cardsBelow()"
      [page]="page()"
      [totalPages]="totalPages()"
      [total]="total()"
      [itemNoun]="['veículo', 'veículos']"
      (pageChange)="pages.push($event)"
    >
      <a dataListEmptyAction data-empty-cta href="/novo">Cadastrar o primeiro</a>
      <ng-template dataListActions let-row>
        <button type="button" dataListMenuItem data-edit>Editar {{ row.plate }}</button>
        <button type="button" dataListMenuItem="danger" data-delete>Excluir</button>
      </ng-template>
      @if (custom()) {
        <ng-template dataListCell="plate" let-row
          ><strong data-custom>{{ row.plate }}</strong></ng-template
        >
      }
    </app-data-list>
  `,
})
class Host {
  readonly columns = COLUMNS;
  readonly rows = signal<Row[]>(ROWS);
  readonly loading = signal(false);
  readonly filename = signal<string | null>('veiculos');
  readonly custom = signal(false);
  readonly rowId = (r: Row) => r.id;
  readonly cardsBelow = signal<DataListBreakpoint>('sm');
  readonly page = signal<number | null>(null);
  readonly totalPages = signal<number | null>(null);
  readonly total = signal<number | null>(null);
  readonly pages: number[] = [];
}

@Component({
  imports: [DataList],
  template: `<app-data-list [columns]="columns" [rows]="rows" [rowTarget]="true" />`,
})
class TargetHost {
  readonly columns = COLUMNS;
  readonly rows = ROWS;
}

@Component({
  imports: [DataList],
  template: `<app-data-list [columns]="columns" [rows]="rows" />`,
})
class RoleHost {
  readonly columns: DataListColumn<{ role: string }>[] = [
    { key: 'role', header: 'Papel', kind: 'status', value: (r) => r.role },
  ];
  readonly rows = [{ role: 'Dono' }];
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
}

describe('DataList', () => {
  it('renders the same rows as a table (sm up) and as cards (phone) from one column config', () => {
    const { el } = render();
    const wrap = el.querySelector('[data-table-wrap]')!;
    const table = el.querySelector('[data-table]')!;
    const cards = el.querySelector('[data-cards]')!;
    expect(wrap.className).toContain('hidden');
    expect(wrap.className).toContain('sm:block');
    expect(wrap.className).toContain('overflow-x-auto');
    expect(cards.className).toContain('sm:hidden');
    expect(cards.className).toContain('space-y-2');
    expect(table.querySelectorAll('[data-row]')).toHaveLength(2);
    expect(cards.querySelectorAll('[data-card]')).toHaveLength(2);
    expect([...table.querySelectorAll('th[scope="col"]')].map((h) => h.textContent!.trim())).toEqual([
      'Placa',
      'Situação',
      'Aluguel (R$)',
      'Ações',
    ]);
  });

  it('the phone card titles itself with the primary column and lists the rest with headers', () => {
    const card = render().el.querySelector('[data-card]')!;
    expect(card.querySelector('.font-semibold')!.textContent).toContain('QWE-4F21');
    expect([...card.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Situação',
      'Aluguel (R$)',
    ]);
  });

  it('status cells are app-status-chip with the tone of the row, money is pt-BR', () => {
    const { el } = render();
    const chips = el.querySelectorAll('[data-table] app-status-chip');
    expect(chips[0].className).toContain('bg-emerald-100');
    expect(chips[1].className).toContain('bg-rose-100');
    expect(el.querySelector('[data-table]')!.textContent).toContain('R$');
    expect(el.querySelector('[data-table]')!.textContent).toContain('1.234,56');
  });

  it('has the kebab slot on every row, in both layouts', () => {
    const { el } = render();
    expect(el.querySelectorAll('[data-table] [data-row] app-actions-menu')).toHaveLength(2);
    expect(el.querySelectorAll('[data-card] app-actions-menu')).toHaveLength(2);
  });

  it('a dataListCell template overrides the built-in cell', () => {
    const { fixture, el } = render();
    fixture.componentInstance.custom.set(true);
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-custom]').length).toBeGreaterThan(0);
  });

  it('loading shows skeletons, aria-busy and no rows', () => {
    const { fixture, el } = render();
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-loading]')).not.toBeNull();
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('[data-row]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(true);
  });

  it('empty shows the icon, the empty text, the projected action, and disables Exportar', () => {
    const { fixture, el } = render();
    fixture.componentInstance.rows.set([]);
    fixture.detectChanges();
    expect(el.querySelector('[data-empty]')!.textContent).toContain('Nenhum veículo.');
    expect(el.querySelector('[data-empty] .rounded-full svg')).not.toBeNull();
    expect(el.querySelector('[data-empty] [data-empty-cta]')!.textContent).toContain('Cadastrar');
    expect(el.querySelector('[data-table]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(true);
  });

  it('has no Exportar button without a file name', () => {
    const { fixture, el } = render();
    fixture.componentInstance.filename.set(null);
    fixture.detectChanges();
    expect(el.querySelector('[data-export]')).toBeNull();
  });

  it('draws no line at all: rows stand out by fill (plain row on the muted area), apart by space', () => {
    const { fixture, el } = render();
    fixture.componentInstance.page.set(0);
    fixture.componentInstance.totalPages.set(2);
    fixture.detectChanges();
    // No divider, no outline: the only `border-*` tokens allowed are the table's spacing model.
    const tokens = Array.from(el.querySelectorAll('*')).flatMap((n) => Array.from(n.classList));
    const lines = tokens.filter(
      (t) => /^(.*:)?(border|divide|ring|outline)(-|$)/.test(t) &&
        !['border-separate', 'border-spacing-y-2'].includes(t) &&
        !/^focus-visible:(ring|outline)/.test(t),
    );
    expect(lines).toEqual([]);

    const wrap = el.querySelector('[data-table-wrap]')!;
    const cards = el.querySelector('[data-cards]')!;
    for (const area of [wrap, cards]) expect(area.className).toContain('bg-surface-muted');
    const table = el.querySelector('[data-table]')!;
    expect(table.className).toContain('border-spacing-y-2');
    const cells = Array.from(table.querySelectorAll('[data-row] td'));
    expect(cells.length).toBeGreaterThan(0);
    for (const box of [...cells, ...Array.from(el.querySelectorAll('[data-card]'))]) {
      expect(box.className).toContain('bg-surface');
      expect(box.className).toContain('dark:bg-surface-sunken');
      expect(box.className).not.toContain('bg-surface-muted');
    }
  });

  it('a pointer-target row darkens on hover (table) and press (card), still without a line', () => {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(TargetHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-row] td')!.className).toContain('group-hover:bg-surface-sunken');
    expect(el.querySelector('[data-card]')!.className).toContain('active:bg-surface-sunken');
  });

  it('headers are normal case (no uppercase / tracking)', () => {
    const { el } = render();
    for (const th of Array.from(el.querySelectorAll('[data-table] th'))) {
      expect(th.className).not.toMatch(/uppercase|tracking-/);
    }
    for (const dt of Array.from(el.querySelectorAll('[data-card] dt'))) {
      expect(dt.className).not.toMatch(/uppercase|tracking-/);
    }
  });

  it('a status column without tone is a neutral chip (roles are never coloured)', () => {
    const fixture = TestBed.createComponent(RoleHost);
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[data-table] app-status-chip')!;
    expect(chip.className).toContain('bg-surface-sunken');
    expect(chip.className).not.toMatch(/emerald|primary|blue|rose|amber/);
  });

  it('cardsBelow moves the table/cards breakpoint with literal classes', () => {
    const { fixture, el } = render();
    fixture.componentInstance.cardsBelow.set('lg');
    fixture.detectChanges();
    expect(el.querySelector('[data-table-wrap]')!.className).toContain('lg:block');
    expect(el.querySelector('[data-cards]')!.className).toContain('lg:hidden');
    expect(el.querySelector('[data-cards]')!.className).not.toContain('sm:hidden');
  });

  it('no pager without server pagination, nor with a single page', () => {
    const { fixture, el } = render();
    expect(el.querySelector('[data-pager]')).toBeNull();
    fixture.componentInstance.page.set(0);
    fixture.componentInstance.totalPages.set(1);
    fixture.detectChanges();
    expect(el.querySelector('[data-pager]')).toBeNull();
  });

  it('the pager shows count and page, emits the target page, and stops at both ends', () => {
    const { fixture, el } = render();
    const host = fixture.componentInstance;
    host.page.set(0);
    host.totalPages.set(3);
    host.total.set(1234);
    fixture.detectChanges();
    expect(el.querySelector('[data-pager-text]')!.textContent!.trim()).toBe(
      '1.234 veículos · página 1 de 3',
    );
    const prev = el.querySelector<HTMLButtonElement>('[data-page-prev]')!;
    const next = el.querySelector<HTMLButtonElement>('[data-page-next]')!;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(next.className).toContain('min-h-[44px]');
    next.click();
    expect(host.pages).toEqual([1]);

    host.page.set(2);
    fixture.detectChanges();
    expect(next.disabled).toBe(true);
    prev.click();
    expect(host.pages).toEqual([1, 1]);

    host.loading.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-pager]')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-page-prev]')!.disabled).toBe(true);
  });

  it('kebab items are 44px menu items, toned, with no line between them', () => {
    const { fixture, el } = render();
    el.querySelector<HTMLElement>('[data-card] app-actions-menu button')!.click();
    fixture.detectChanges();
    const edit = el.querySelector<HTMLElement>('[data-edit]')!;
    const del = el.querySelector<HTMLElement>('[data-delete]')!;
    for (const item of [edit, del]) {
      expect(item.getAttribute('role')).toBe('menuitem');
      expect(item.className).toContain('min-h-[44px]');
      expect(item.className).toContain('w-full');
      expect(item.className).not.toMatch(/border|divide/);
    }
    expect(edit.className).toContain('text-fg-soft');
    expect(del.className).toContain('text-rose-600');
  });

  it('exports exactly the rows given, as the CSV text', () => {
    const { fixture } = render();
    const list = fixture.debugElement.children[0].componentInstance as DataList<Row>;
    fixture.componentInstance.rows.set([ROWS[0]]);
    fixture.detectChanges();
    expect(list.csvText()).toBe(
      '﻿Placa;Situação;Aluguel (R$)\r\nQWE-4F21;Ativo;1234,56\r\n',
    );
  });
});

describe('pagerLabel', () => {
  it('says the page alone when the total is unknown, and uses the singular for one', () => {
    expect(pagerLabel(0, 2, null, ['usuário', 'usuários'])).toBe('Página 1 de 2');
    expect(pagerLabel(1, 2, 1, ['usuário', 'usuários'])).toBe('1 usuário · página 2 de 2');
  });
});

describe('buildCsv', () => {
  it('writes pt-BR money, quotes separators and neutralises formulas', () => {
    const csv = buildCsv<{ a: string; c: number }>(
      [
        { key: 'a', header: 'Nome; apelido', value: (r) => r.a },
        { key: 'c', header: 'Valor', kind: 'money-cents', value: (r) => r.c },
      ],
      [
        { a: 'Ana; "Nana"', c: 100000050 },
        { a: '=1+1', c: -250 },
        { a: 'sem', c: 5 },
      ],
    );
    expect(csv).toBe(
      '﻿"Nome; apelido";Valor\r\n"Ana; ""Nana""";1000000,50\r\n\'=1+1;-2,50\r\nsem;0,05\r\n',
    );
  });

  it('writes an empty cell, not NaN, for non-numeric money and integers', () => {
    const csv = buildCsv<{ v: string }>(
      [
        { key: 'm', header: 'M', kind: 'money-cents', value: (r) => r.v },
        { key: 'i', header: 'I', kind: 'integer', value: (r) => r.v },
      ],
      [{ v: 'abc' }],
    );
    expect(csv).toBe('﻿M;I\r\n;\r\n');
    expect(csv).not.toContain('NaN');
  });

  it('leaves empty cells empty', () => {
    expect(buildCsv([{ key: 'a', header: 'A', value: () => null }], [{}])).toBe('﻿A\r\n\r\n');
  });
});

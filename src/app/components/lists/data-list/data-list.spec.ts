import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { buildCsv } from './data-list-csv';
import { DataList, DataListActions, DataListCell, DataListColumn } from './data-list';

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
  imports: [DataList, DataListActions, DataListCell],
  template: `
    <app-data-list
      [columns]="columns"
      [rows]="rows()"
      [loading]="loading()"
      [exportFilename]="filename()"
      emptyText="Nenhum veículo."
      [rowId]="rowId"
    >
      <ng-template dataListActions let-row>
        <button type="button" role="menuitem">Editar {{ row.plate }}</button>
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
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
}

describe('DataList', () => {
  it('renders the same rows as a table (lg) and as cards (phone) from one column config', () => {
    const { el } = render();
    const table = el.querySelector('[data-table]')!;
    const cards = el.querySelector('[data-cards]')!;
    expect(table.className).toContain('hidden');
    expect(table.className).toContain('lg:table');
    expect(cards.className).toContain('lg:hidden');
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

  it('empty shows the empty text and disables Exportar', () => {
    const { fixture, el } = render();
    fixture.componentInstance.rows.set([]);
    fixture.detectChanges();
    expect(el.querySelector('[data-empty]')!.textContent).toContain('Nenhum veículo.');
    expect(el.querySelector('[data-table]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(true);
  });

  it('has no Exportar button without a file name', () => {
    const { fixture, el } = render();
    fixture.componentInstance.filename.set(null);
    fixture.detectChanges();
    expect(el.querySelector('[data-export]')).toBeNull();
  });

  it('draws no divider lines (spec on classes)', () => {
    const html = render().el.innerHTML;
    expect(html).not.toMatch(/divide-|border-b|border-t|border-y/);
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

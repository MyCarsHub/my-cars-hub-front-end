import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  contentChildren,
  inject,
  input,
  output,
} from '@angular/core';
import { formatKpiNumber } from '../../kpi-card/kpi-card';
import { ActionsMenu } from '../../core/actions-menu/actions-menu';
import { StatusChip, type StatusChipTone } from '../../core/status-chip/status-chip';
import { buildCsv, downloadCsv, type CsvColumn, type CsvKind } from './data-list-csv';

export interface DataListColumn<T> {
  readonly key: string;
  readonly header: string;
  /**
   * `text` (default), `status` (rendered as `app-status-chip`), `money-cents` (pt-BR BRL),
   * `integer`. A `[dataListCell]` template with the same key overrides the built-in cell.
   */
  readonly kind?: CsvKind;
  readonly value: (row: T) => string | number | null | undefined;
  /** Chip tone for `status` columns. */
  readonly tone?: (row: T) => StatusChipTone;
  /** Right-align (numbers and money). */
  readonly end?: boolean;
  /** The row's title on the phone card (one per list; first column when none is marked). */
  readonly primary?: boolean;
  /** Skip this column in the CSV (e.g. an actions-only or presentational column). */
  readonly noExport?: boolean;
}

/** `<ng-template dataListCell="status" let-row>` — custom cell for one column key. */
@Directive({ selector: 'ng-template[dataListCell]' })
export class DataListCell {
  readonly key = input.required<string>({ alias: 'dataListCell' });
  readonly template = inject<TemplateRef<{ $implicit: unknown }>>(TemplateRef);
}

/** `<ng-template dataListActions let-row>` — the menu items (buttons role=menuitem) of a row's kebab. */
@Directive({ selector: 'ng-template[dataListActions]' })
export class DataListActions {
  readonly template = inject<TemplateRef<{ $implicit: unknown }>>(TemplateRef);
}

interface Cell {
  readonly column: DataListColumn<unknown>;
  readonly text: string;
  readonly custom: TemplateRef<{ $implicit: unknown }> | null;
}

interface RenderedRow {
  readonly row: unknown;
  readonly id: string | number;
  readonly cells: readonly Cell[];
  readonly title: Cell;
  readonly rest: readonly Cell[];
}

/**
 * One list, two layouts: a table from `lg` up, stacked cards below, both from the SAME column
 * config. Row actions are the project's kebab (`app-actions-menu`), status is `app-status-chip`,
 * and the "Exportar" button writes the rows it was given (the filtered ones) as CSV.
 *
 * No divider lines anywhere: rows are separated by space and a tinted surface, never a rule.
 * States: `loading` shows skeleton rows (and `aria-busy`); no rows shows `emptyText`.
 */
@Component({
  selector: 'app-data-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, ActionsMenu, StatusChip],
  host: { class: 'block min-w-0' },
  template: `
    @if (exportFilename()) {
      <div class="flex justify-end mb-3">
        <button
          type="button"
          data-export
          class="inline-flex items-center min-h-[44px] sm:min-h-[36px] px-4 rounded-xl bg-surface-sunken text-fg-body text-sm font-semibold hover:bg-surface-strong transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-50"
          [disabled]="loading() || !rows().length"
          (click)="exportCsv()"
        >
          Exportar
        </button>
      </div>
    }

    <div [attr.aria-busy]="loading()" class="min-w-0">
      @if (loading()) {
        <div data-loading role="status" aria-label="Carregando" class="space-y-2">
          @for (n of skeletons; track n) {
            <div class="h-14 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
          }
        </div>
      } @else if (!rendered().length) {
        <p data-empty class="text-sm text-fg-subtle text-center py-10">{{ emptyText() }}</p>
      } @else {
        <!-- Table: lg and up -->
        <table data-table class="hidden lg:table w-full border-separate border-spacing-y-1.5 text-sm">
          <caption class="sr-only">
            {{ ariaLabel() }}
          </caption>
          <thead>
            <tr>
              @for (col of columns(); track col.key) {
                <th
                  scope="col"
                  class="px-4 py-2 text-xs font-semibold text-fg-muted"
                  [class.text-left]="!col.end"
                  [class.text-right]="col.end"
                >
                  {{ col.header }}
                </th>
              }
              @if (actions()) {
                <th scope="col" class="w-12 px-2"><span class="sr-only">Ações</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (r of rendered(); track r.id) {
              <tr data-row class="bg-surface-muted">
                @for (c of r.cells; track c.column.key) {
                  <td
                    class="px-4 py-3 first:rounded-l-xl last:rounded-r-xl text-fg-body"
                    [class.text-right]="c.column.end"
                    [class.tabular-nums]="c.column.end"
                  >
                    <ng-container
                      [ngTemplateOutlet]="cellTpl"
                      [ngTemplateOutletContext]="{ $implicit: c, row: r.row }"
                    />
                  </td>
                }
                @if (actions(); as menu) {
                  <td class="px-2 py-1 rounded-r-xl text-right">
                    <app-actions-menu [label]="actionsLabel()">
                      <ng-container
                        [ngTemplateOutlet]="menu.template"
                        [ngTemplateOutletContext]="{ $implicit: r.row }"
                      />
                    </app-actions-menu>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>

        <!-- Cards: below lg -->
        <ul data-cards class="lg:hidden space-y-2" [attr.aria-label]="ariaLabel()">
          @for (r of rendered(); track r.id) {
            <li data-card class="rounded-2xl bg-surface-muted p-4 min-w-0">
              <div class="flex items-start justify-between gap-2 min-w-0">
                <div class="min-w-0 font-semibold text-fg">
                  <ng-container
                    [ngTemplateOutlet]="cellTpl"
                    [ngTemplateOutletContext]="{ $implicit: r.title, row: r.row }"
                  />
                </div>
                @if (actions(); as menu) {
                  <app-actions-menu [label]="actionsLabel()">
                    <ng-container
                      [ngTemplateOutlet]="menu.template"
                      [ngTemplateOutletContext]="{ $implicit: r.row }"
                    />
                  </app-actions-menu>
                }
              </div>
              <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                @for (c of r.rest; track c.column.key) {
                  <div class="min-w-0">
                    <dt class="text-xs text-fg-muted">{{ c.column.header }}</dt>
                    <dd class="text-fg-body truncate" [class.tabular-nums]="c.column.end">
                      <ng-container
                        [ngTemplateOutlet]="cellTpl"
                        [ngTemplateOutletContext]="{ $implicit: c, row: r.row }"
                      />
                    </dd>
                  </div>
                }
              </dl>
            </li>
          }
        </ul>
      }
    </div>

    <ng-template #cellTpl let-c let-row="row">
      @if (c.custom) {
        <ng-container [ngTemplateOutlet]="c.custom" [ngTemplateOutletContext]="{ $implicit: row }" />
      } @else if (c.column.kind === 'status') {
        <app-status-chip size="sm" [tone]="tone(c.column, row)">{{ c.text }}</app-status-chip>
      } @else {
        {{ c.text }}
      }
    </ng-template>
  `,
})
export class DataList<T = unknown> {
  readonly columns = input.required<readonly DataListColumn<T>[]>();
  readonly rows = input.required<readonly T[]>();
  /** Stable id of a row, for `track`. Defaults to the row index. */
  readonly rowId = input<(row: T, index: number) => string | number>((_, i) => i);
  readonly loading = input(false);
  readonly emptyText = input('Nada por aqui.');
  readonly ariaLabel = input('Lista');
  readonly actionsLabel = input('Mais ações');
  /** File name for the CSV; `null` hides the Exportar button. */
  readonly exportFilename = input<string | null>(null);

  readonly exported = output<string>();

  protected readonly cellDefs = contentChildren(DataListCell);
  protected readonly actions = contentChild(DataListActions);
  protected readonly skeletons = [0, 1, 2, 3];

  protected readonly rendered = computed<RenderedRow[]>(() => {
    const cols = this.columns() as readonly DataListColumn<unknown>[];
    const defs = new Map(this.cellDefs().map((d) => [d.key(), d.template]));
    const idOf = this.rowId() as (row: unknown, index: number) => string | number;
    const primary = cols.find((c) => c.primary) ?? cols[0];
    return (this.rows() as readonly unknown[]).map((row, i) => {
      const cells = cols.map((column) => ({
        column,
        text: cellText(column, row),
        custom: defs.get(column.key) ?? null,
      }));
      return {
        row,
        id: idOf(row, i),
        cells,
        title: cells.find((c) => c.column === primary) ?? cells[0],
        rest: cells.filter((c) => c.column !== primary),
      };
    });
  });

  protected tone(column: DataListColumn<unknown>, row: unknown): StatusChipTone {
    return column.tone?.(row) ?? 'neutral';
  }

  /** The CSV of the rows currently given (the filtered ones). */
  csvText(): string {
    return buildCsv(this.csvColumns(), this.rows());
  }

  protected exportCsv(): void {
    const name = this.exportFilename();
    if (!name) return;
    downloadCsv(name, this.csvText());
    this.exported.emit(name);
  }

  private csvColumns(): CsvColumn<T>[] {
    return this.columns()
      .filter((c) => !c.noExport)
      .map((c) => ({ key: c.key, header: c.header, kind: c.kind, value: c.value }));
  }
}

function cellText(column: DataListColumn<unknown>, row: unknown): string {
  const raw = column.value(row);
  if (raw === null || raw === undefined || raw === '') return '—';
  if (column.kind === 'money-cents') return formatKpiNumber('brl-cents', Number(raw));
  if (column.kind === 'integer') return formatKpiNumber('integer', Number(raw));
  return String(raw);
}

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
  /** Column header, in normal case ("Situação", never "SITUAÇÃO"). Also the card label. */
  readonly header: string;
  /**
   * `text` (default), `status` (rendered as `app-status-chip`), `money-cents` (pt-BR BRL),
   * `integer`. A `[dataListCell]` template with the same key overrides the built-in cell.
   *
   * A role/plan/kind label is a `status` column WITHOUT `tone`: it renders as a neutral chip.
   * Colour is reserved for situation (green/amber/red/…), never for who someone is.
   */
  readonly kind?: CsvKind;
  readonly value: (row: T) => string | number | null | undefined;
  /** Chip tone for `status` columns. Omitted = neutral. */
  readonly tone?: (row: T) => StatusChipTone;
  /** Right-align (numbers and money). */
  readonly end?: boolean;
  /** The row's title on the phone card (one per list; first column when none is marked). */
  readonly primary?: boolean;
  /** Skip this column in the CSV (e.g. an actions-only or presentational column). */
  readonly noExport?: boolean;
}

/** Below this width the rows become stacked cards; from it up they are a table. */
export type DataListBreakpoint = 'sm' | 'md' | 'lg';

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
 * Literal class strings per breakpoint (Tailwind only generates classes it can read in source).
 * `table` = the table wrapper, `cards` = the phone card list.
 */
const LAYOUT: Record<DataListBreakpoint, { table: string; cards: string }> = {
  sm: { table: 'hidden sm:block', cards: 'sm:hidden' },
  md: { table: 'hidden md:block', cards: 'md:hidden' },
  lg: { table: 'hidden lg:block', cards: 'lg:hidden' },
};

/**
 * No lines at all, outlines included (owner rule "sem linhas entre informações"): the record
 * stands out by FILL. The list area is the muted surface; each record is the plain surface
 * (white in light, the raised `surface-sunken` tone in dark, which is lighter than the dark
 * muted area). Records are separated by the area showing through the space between them.
 */
const AREA = 'bg-surface-muted rounded-2xl p-2';
const ROW_FILL = 'bg-surface dark:bg-surface-sunken';
const CARD_PRESS = 'active:bg-surface-sunken dark:active:bg-surface-strong';

/** Each table cell paints its slice of the row's box; the ends round the row. */
const CELL_BOX =
  `${ROW_FILL} first:rounded-l-xl last:rounded-r-xl ` +
  'transition-colors duration-150 motion-reduce:transition-none';
const CELL_HOVER = 'group-hover:bg-surface-sunken dark:group-hover:bg-surface-strong';

const CARD_BOX = `${ROW_FILL} rounded-xl p-4 min-w-0 transition-colors duration-150 motion-reduce:transition-none`;

const PAGER_BUTTON =
  'inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-surface-sunken ' +
  'text-sm font-semibold text-fg-body hover:bg-surface-strong transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * The platform list (owner decision D1, 18/11/2026). One list, two layouts from the SAME column
 * config: a table from `cardsBelow` up, stacked cards below it (default `sm` = 640px).
 *
 * - The list area is the muted surface; every record is its own row in the plain surface (white
 *   in light, the raised tone in dark), separated by SPACE only. No line anywhere: no divider,
 *   no `divide-*`, no outline around a row.
 * - Headers are normal case. Status is `app-status-chip` (tinted, no dot); a column without
 *   `tone` is a neutral chip (roles, plans).
 * - Row actions are the kebab (`app-actions-menu`); use `[dataListMenuItem]` on each item.
 * - States: `loading` = skeleton rows + `aria-busy`; no rows = icon + `emptyText` (+ an optional
 *   `[dataListEmptyAction]` link/button); `page`/`totalPages` = Anterior/Próxima footer.
 * - "Exportar" writes the rows it was given (the filtered ones) as CSV.
 *
 * The envelope (`app-page-card title="Lista"`) and the search/filter header (`app-list-toolbar`)
 * live outside: see `components/lists/list-toolbar/list-toolbar.ts`.
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
        <div data-loading role="status" aria-label="Carregando" class="space-y-2" [class]="area">
          @for (n of skeletons; track n) {
            <div
              class="h-14 rounded-xl animate-pulse motion-reduce:animate-none"
              [class]="rowFill"
            ></div>
          }
        </div>
      } @else if (!rendered().length) {
        <div data-empty class="text-center py-10 space-y-3">
          <div
            class="w-14 h-14 rounded-full bg-surface-sunken flex items-center justify-center mx-auto"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-fg-faint"
            >
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path
                d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
              />
            </svg>
          </div>
          <p data-empty-text class="text-sm text-fg-subtle">{{ emptyText() }}</p>
          <ng-content select="[dataListEmptyAction]" />
        </div>
      } @else {
        <!-- Table: from cardsBelow up. Scrolls inside itself, never the page. -->
        <div
          data-table-wrap
          class="overflow-x-auto min-w-0 sm:px-3"
          [class]="area + ' ' + layout().table"
        >
          <table data-table class="w-full border-separate border-spacing-y-2 -my-2 text-sm">
            <caption class="sr-only">
              {{ ariaLabel() }}
            </caption>
            <thead>
              <tr>
                @for (col of columns(); track col.key) {
                  <th
                    scope="col"
                    class="pt-1 pb-0 text-xs font-medium text-fg-subtle"
                    [class.px-4]="!dense()"
                    [class.px-3]="dense()"
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
                <tr
                  data-row
                  class="group"
                  [class.cursor-pointer]="rowTarget()"
                  (click)="onRowClick($event, r.row)"
                >
                  @for (c of r.cells; track c.column.key) {
                    <td
                      class="text-fg-body align-middle"
                      [class]="cellClass()"
                      [class.px-4]="!dense()"
                      [class.py-3]="!dense()"
                      [class.px-3]="dense()"
                      [class.py-2]="dense()"
                      [class.whitespace-nowrap]="dense()"
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
                    <td class="px-2 py-1 text-right align-middle" [class]="cellClass()">
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
        </div>

        <!-- Cards: below cardsBelow (the phone) -->
        <ul
          data-cards
          class="space-y-2"
          [class]="area + ' ' + layout().cards"
          [attr.aria-label]="ariaLabel()"
        >
          @for (r of rendered(); track r.id) {
            <li
              data-card
              [class]="cardClass()"
              [class.cursor-pointer]="rowTarget()"
              (click)="onRowClick($event, r.row)"
            >
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
              @if (r.rest.length) {
                <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  @for (c of r.rest; track c.column.key) {
                    <div class="min-w-0">
                      <dt class="text-xs text-fg-subtle">{{ c.column.header }}</dt>
                      <dd class="text-fg-body truncate" [class.tabular-nums]="c.column.end">
                        <ng-container
                          [ngTemplateOutlet]="cellTpl"
                          [ngTemplateOutletContext]="{ $implicit: c, row: r.row }"
                        />
                      </dd>
                    </div>
                  }
                </dl>
              }
            </li>
          }
        </ul>
      }

      @if (showPager()) {
        <nav
          data-pager
          aria-label="Paginação"
          class="mt-4 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3"
        >
          <p data-pager-text class="text-xs text-fg-subtle tabular-nums">{{ pagerText() }}</p>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              data-page-prev
              [class]="pagerButton"
              [disabled]="!canPrev()"
              (click)="goTo(-1)"
            >
              Anterior
            </button>
            <button
              type="button"
              data-page-next
              [class]="pagerButton"
              [disabled]="!canNext()"
              (click)="goTo(1)"
            >
              Próxima
            </button>
          </div>
        </nav>
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
  /** Rows become cards BELOW this breakpoint. Default `sm` (phones, < 640px). */
  readonly cardsBelow = input<DataListBreakpoint>('sm');

  /**
   * The whole row is a pointer target (mouse and touch): a click outside any link, button or menu
   * item emits `rowActivate`. Keyboard users keep the row's own link (the name) as the ONE tab
   * stop, so the row itself is deliberately not focusable.
   */
  readonly rowTarget = input(false);
  /** Linhas baixas (~56px) e células sem quebra, para tabelas largas ao lado de outros blocos. */
  readonly dense = input(false);

  /**
   * Server pagination. `page` is 0-based; the footer shows when `totalPages > 1`. The list does
   * not page by itself: it emits `pageChange` with the target page and the page reloads.
   */
  readonly page = input<number | null>(null);
  readonly totalPages = input<number | null>(null);
  /** Total records across all pages (the "87 usuários" in the footer). Optional. */
  readonly total = input<number | null>(null);
  /** Singular and plural noun for the footer count, e.g. `['usuário', 'usuários']`. */
  readonly itemNoun = input<readonly [string, string]>(['registro', 'registros']);

  readonly exported = output<string>();
  readonly rowActivate = output<T>();
  readonly pageChange = output<number>();

  protected readonly cellDefs = contentChildren(DataListCell);
  protected readonly actions = contentChild(DataListActions);
  protected readonly skeletons = [0, 1, 2, 3];
  protected readonly area = AREA;
  protected readonly rowFill = ROW_FILL;
  protected readonly pagerButton = PAGER_BUTTON;
  protected readonly cellClass = computed(() =>
    this.rowTarget() ? `${CELL_BOX} ${CELL_HOVER}` : CELL_BOX,
  );
  protected readonly cardClass = computed(() =>
    this.rowTarget() ? `${CARD_BOX} ${CARD_PRESS}` : CARD_BOX,
  );

  protected readonly layout = computed(() => LAYOUT[this.cardsBelow()] ?? LAYOUT.sm);

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

  protected readonly showPager = computed(() => {
    const pages = this.totalPages();
    return this.page() !== null && pages !== null && pages > 1 && this.rows().length > 0;
  });

  protected readonly canPrev = computed(() => !this.loading() && (this.page() ?? 0) > 0);
  protected readonly canNext = computed(
    () => !this.loading() && (this.page() ?? 0) + 1 < (this.totalPages() ?? 0),
  );

  protected readonly pagerText = computed(() =>
    pagerLabel(this.page() ?? 0, this.totalPages() ?? 0, this.total(), this.itemNoun()),
  );

  protected goTo(delta: -1 | 1): void {
    if (delta < 0 ? !this.canPrev() : !this.canNext()) return;
    this.pageChange.emit((this.page() ?? 0) + delta);
  }

  protected onRowClick(event: Event, row: unknown): void {
    if (!this.rowTarget()) return;
    const target = event.target;
    // Links, buttons, form controls and kebab items own their clicks.
    if (target instanceof Element && target.closest('a, button, input, select, textarea, [role="menuitem"]')) return;
    this.rowActivate.emit(row as T);
  }

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

const INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "87 usuários · página 2 de 5" (count omitted when the total is unknown). */
export function pagerLabel(
  page: number,
  totalPages: number,
  total: number | null,
  noun: readonly [string, string],
): string {
  const where = `Página ${page + 1} de ${totalPages}`;
  if (total === null || !Number.isFinite(total)) return where;
  const count = `${INTEGER.format(total)} ${total === 1 ? noun[0] : noun[1]}`;
  return `${count} · ${where.charAt(0).toLowerCase()}${where.slice(1)}`;
}

function cellText(column: DataListColumn<unknown>, row: unknown): string {
  const raw = column.value(row);
  if (raw === null || raw === undefined || raw === '') return '—';
  if (column.kind === 'money-cents') return formatKpiNumber('brl-cents', Number(raw));
  if (column.kind === 'integer') return formatKpiNumber('integer', Number(raw));
  return String(raw);
}

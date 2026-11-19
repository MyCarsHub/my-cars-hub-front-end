import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  TemplateRef,
  afterRenderEffect,
  computed,
  contentChild,
  contentChildren,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
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
  /**
   * With `fit`, the table drops this column FIRST when not every column fits, before turning
   * into cards; a line under the table names what left. The cards and the CSV keep it.
   */
  readonly optional?: boolean;
}

/** What a `fit` list shows: every column, the table without its `optional` columns, or the cards. */
export type DataListFit = 'table' | 'compact' | 'cards';

/** Sub-pixel slack: widths come from layout as fractions. */
const FIT_SLACK = 1;

/**
 * The fit rule (pure; px). `fullMin` is the narrowest the whole table can lay out, `optionalMin`
 * the share of it the `optional` columns take (0 = none). The whole table while it fits the room;
 * else the table without the optional columns, if that fits; else the cards. Never a scroll.
 */
export function fitLayout(room: number, fullMin: number, optionalMin: number): DataListFit {
  if (fullMin <= room + FIT_SLACK) return 'table';
  if (optionalMin > 0 && fullMin - optionalMin <= room + FIT_SLACK) return 'compact';
  return 'cards';
}

/** "A", "A e B", "A, B e C" (the line that names the columns the table left out). */
export function joinPt(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
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
  /** The kebab's accessible name for this row. */
  readonly actionsLabel: string;
  /** `false` = this row draws no kebab (the table keeps the empty cell so columns stay aligned). */
  readonly hasActions: boolean;
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
 * stands out by FILL in light — the list area is the muted surface and each record the plain
 * surface (white), separated by the area showing through the space between them.
 *
 * Dark has TWO tones only (owner rule, 19/11/2026: page #000000, card #0E0E0E): the muted area
 * and the record both resolve to the card tone, so the list sits on the card and records are
 * apart by SPACE alone. Hover/press never paint a grey there: the row text brightens on hover
 * and a pressed card dims, the same opacity/text cues the rest of the app uses.
 */
const AREA = 'bg-surface-muted rounded-2xl p-2';
const ROW_FILL = 'bg-surface';
/** Loading rows: the plain row in light; the shared placeholder fill in dark, so they stay visible. */
const SKELETON_FILL = 'bg-surface dark:bg-placeholder-fill';
const CARD_PRESS = 'active:bg-surface-sunken dark:active:opacity-70';

/** Each table cell paints its slice of the row's box; the ends round the row. */
const CELL_BOX =
  `${ROW_FILL} first:rounded-l-xl last:rounded-r-xl ` +
  'transition-colors duration-150 motion-reduce:transition-none';
const CELL_HOVER = 'group-hover:bg-surface-sunken dark:group-hover:text-fg-strong';

const CARD_BOX =
  `${ROW_FILL} rounded-xl p-4 min-w-0 transition-[background-color,opacity] duration-150 ` +
  'motion-reduce:transition-none';

const PAGER_BUTTON =
  'inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-surface-sunken ' +
  'text-sm font-semibold text-fg-body hover:bg-surface-strong dark:hover:bg-transparent dark:hover:text-fg-strong transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * The platform list (owner decision D1, 18/11/2026). One list, two layouts from the SAME column
 * config: a table from `cardsBelow` up, stacked cards below it (default `sm` = 640px).
 *
 * - The list area is the muted surface; every record is its own row in the plain surface (white
 *   in light; in dark both are the card tone), separated by SPACE only. No line anywhere: no
 *   divider, no `divide-*`, no outline around a row.
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
          class="inline-flex items-center min-h-[44px] sm:min-h-[36px] px-4 rounded-xl bg-surface-sunken text-fg-body text-sm font-semibold hover:bg-surface-strong dark:hover:bg-transparent dark:hover:text-fg-strong transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-50"
          [disabled]="loading() || !rows().length"
          (click)="exportCsv()"
        >
          Exportar
        </button>
      </div>
    }

    <div [attr.aria-busy]="loading()" class="min-w-0" [class.relative]="fit()">
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
        <!-- Table: from cardsBelow up, never scrolling the page. With fit it never scrolls at all:
             it drops its optional columns, then hands over to the cards (staying laid out, unseen,
             to keep measuring). Without fit it scrolls inside itself as the last resort. -->
        <div
          #tableWrap
          data-table-wrap
          class="overflow-x-auto min-w-0 sm:px-3"
          [class]="area + ' ' + tableLayout()"
          [attr.aria-hidden]="fit() && fitMode() === 'cards' ? 'true' : null"
          [attr.data-fit]="fit() ? fitMode() : null"
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
                    [attr.data-optional]="col.optional ? '' : null"
                    [class.hidden]="dropped(col)"
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
              @for (r of rendered(); track r.id; let i = $index) {
                <tr
                  data-row
                  class="group"
                  [class.cursor-pointer]="rowTarget()"
                  [class.enter-up]="animateRows()"
                  [style.--stagger-i]="animateRows() ? i : null"
                  (click)="onRowClick($event, r.row)"
                >
                  @for (c of r.cells; track c.column.key) {
                    <td
                      class="text-fg-body align-middle"
                      [class]="cellClass()"
                      [class.hidden]="dropped(c.column)"
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
                      @if (r.hasActions) {
                        <app-actions-menu [label]="r.actionsLabel">
                          <ng-container
                            [ngTemplateOutlet]="menu.template"
                            [ngTemplateOutletContext]="{ $implicit: r.row }"
                          />
                        </app-actions-menu>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (droppedNote(); as note) {
          <!-- Nothing leaves in silence: the table names the columns it left out at this width. -->
          <p data-dropped-columns class="mt-2 text-xs text-fg-subtle" [class]="layout().table">{{ note }}</p>
        }

        <!-- Cards: below cardsBelow (the phone); with fit, also wherever the table does not fit. -->
        <ul
          data-cards
          class="space-y-2"
          [class]="area + ' ' + cardsLayout()"
          [attr.aria-label]="ariaLabel()"
        >
          @for (r of rendered(); track r.id; let i = $index) {
            <li
              data-card
              [class]="cardClass()"
              [class.cursor-pointer]="rowTarget()"
              [class.enter-up]="animateRows()"
              [style.--stagger-i]="animateRows() ? i : null"
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
                  @if (r.hasActions) {
                    <app-actions-menu [label]="r.actionsLabel">
                      <ng-container
                        [ngTemplateOutlet]="menu.template"
                        [ngTemplateOutletContext]="{ $implicit: r.row }"
                      />
                    </app-actions-menu>
                  }
                }
              </div>
              @if (r.rest.length) {
                <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  @for (c of r.rest; track c.column.key) {
                    <div class="min-w-0">
                      <dt class="text-xs text-fg-subtle">{{ c.column.header }}</dt>
                      <!-- Wraps, never cuts: a clipped "Locadoras e motori" hid the value on the
                           phone (visual 18/11). overflow-hidden only guards a nowrap child. -->
                      <dd
                        class="text-fg-body overflow-hidden break-words [overflow-wrap:anywhere]"
                        [class.tabular-nums]="c.column.end"
                      >
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
  /**
   * Accessible name of each row's kebab. A string names every kebab the same ("Mais ações", the
   * default); a function names each one after its row ("Ações da cobrança de Ana"), so a screen
   * reader can tell twenty kebabs apart.
   */
  readonly actionsLabel = input<string | ((row: T) => string)>('Mais ações');
  /**
   * Which rows draw a kebab. `null` (default) = every row, as before. A row for which it returns
   * `false` has no kebab at all, instead of a menu with nothing to do in it (e.g. a read-only
   * profile, or a record in a state with no action).
   */
  readonly hasActions = input<((row: T) => boolean) | null>(null);
  /**
   * Opt-in entry motion: each row/card rises 8px and fades in, 40ms apart (capped at 8 rows, the
   * shared `.enter-up` utility in `styles.css`). Only rows that are NEW to the list animate (rows
   * are tracked by `rowId`), so a page change or a filter replays it and a re-render does not.
   * `prefers-reduced-motion` turns it off. Default `false`: existing lists render as before.
   */
  readonly animateRows = input(false);
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
   * The table shows only while it FITS the list's own width (measured, so the sidebar, the data
   * and the card it sits in all count, not only the viewport): when it would not, it first drops
   * the `optional` columns (and says so under it), then turns into the cards. No horizontal
   * scroll, inside or outside. Below `cardsBelow` the cards show as before. Default `false`.
   */
  readonly fit = input(false);

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
  protected readonly rowFill = SKELETON_FILL;
  protected readonly pagerButton = PAGER_BUTTON;
  protected readonly cellClass = computed(() =>
    this.rowTarget() ? `${CELL_BOX} ${CELL_HOVER}` : CELL_BOX,
  );
  protected readonly cardClass = computed(() =>
    this.rowTarget() ? `${CARD_BOX} ${CARD_PRESS}` : CARD_BOX,
  );

  protected readonly layout = computed(() => LAYOUT[this.cardsBelow()] ?? LAYOUT.sm);

  /** Measured layout of a `fit` list: 'table' until measured (and always where there is no layout). */
  protected readonly fitMode = signal<DataListFit>('table');
  private readonly tableWrap = viewChild<ElementRef<HTMLElement>>('tableWrap');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Width the optional columns took the last time they were drawn (dropped ones measure 0). */
  private optionalMin = 0;

  /**
   * In `cards` the table stays laid out at the list's width to keep measuring, but out of the
   * flow, unseen and out of reach (`invisible` takes it off the accessibility tree and the Tab).
   */
  protected readonly tableLayout = computed(() =>
    this.fit() && this.fitMode() === 'cards'
      ? `${this.layout().table} absolute inset-x-0 top-0 h-0 invisible pointer-events-none`
      : this.layout().table,
  );
  protected readonly cardsLayout = computed(() =>
    this.fit() && this.fitMode() === 'cards' ? '' : this.layout().cards,
  );

  protected readonly droppedNote = computed(() => {
    if (!this.fit() || this.fitMode() !== 'compact') return null;
    const names = this.columns()
      .filter((c) => c.optional)
      .map((c) => c.header);
    return names.length ? `Sem espaço nesta largura para ${joinPt(names)}` : null;
  });

  protected dropped(column: { readonly optional?: boolean }): boolean {
    return !!column.optional && this.fit() && this.fitMode() === 'compact';
  }

  protected readonly rendered = computed<RenderedRow[]>(() => {
    const cols = this.columns() as readonly DataListColumn<unknown>[];
    const defs = new Map(this.cellDefs().map((d) => [d.key(), d.template]));
    const idOf = this.rowId() as (row: unknown, index: number) => string | number;
    const label = this.actionsLabel() as string | ((row: unknown) => string);
    const can = this.hasActions() as ((row: unknown) => boolean) | null;
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
        actionsLabel: typeof label === 'function' ? label(row) : label,
        hasActions: can ? can(row) : true,
      };
    });
  });

  constructor() {
    let observer: ResizeObserver | null = null;
    let watched: Element | null = null;
    let frame = 0;
    const win = () => this.host.nativeElement.ownerDocument?.defaultView ?? null;
    const schedule = (): void => {
      const w = win();
      if (!w || frame) return;
      frame = w.requestAnimationFrame(() => {
        frame = 0;
        this.measureFit();
      });
    };
    // Measure again when the list's width changes (window, sidebar), when the table's own size
    // does (rows, loading over), and after every render that changes the rows or the columns.
    afterRenderEffect(() => {
      if (!this.fit()) return;
      this.rendered();
      const wrap = this.tableWrap()?.nativeElement ?? null;
      untracked(() => {
        const w = win();
        if (!wrap || !w || typeof w.ResizeObserver !== 'function') return;
        const table = wrap.querySelector('table');
        if (wrap !== watched) {
          const ro = (observer ??= new w.ResizeObserver(schedule));
          ro.disconnect();
          ro.observe(wrap);
          if (table) ro.observe(table);
          watched = wrap;
        }
        schedule();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      if (frame) win()?.cancelAnimationFrame(frame);
    });
  }

  /**
   * How narrow the table can get (a table never lays out narrower than its content, so at width 0
   * it shows its minimum) against the room inside its wrap; then the layout that fits.
   */
  private measureFit(): void {
    const wrap = this.tableWrap()?.nativeElement;
    const table = wrap?.querySelector('table');
    const w = wrap?.ownerDocument.defaultView;
    if (!wrap || !table || !w) return;
    const style = w.getComputedStyle(wrap);
    // Below cardsBelow the wrap is display:none and the cards already show.
    if (style.display === 'none') return;
    const room =
      wrap.getBoundingClientRect().width -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0);
    if (!(room > 0)) return;
    const compact = this.fitMode() === 'compact';
    const before = table.style.width;
    table.style.width = '0px';
    const min = table.getBoundingClientRect().width;
    if (!compact) {
      let optional = 0;
      table.querySelectorAll('th[data-optional]').forEach((th) => {
        optional += th.getBoundingClientRect().width;
      });
      this.optionalMin = optional;
    }
    table.style.width = before;
    const fullMin = compact ? min + this.optionalMin : min;
    this.fitMode.set(fitLayout(room, fullMin, this.optionalMin));
  }

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

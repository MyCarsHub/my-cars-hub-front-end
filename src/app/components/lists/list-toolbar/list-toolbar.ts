import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FilterChipGroup, type FilterChipOption } from '../../filter-chip-group/filter-chip-group';

/**
 * A select on the toolbar's search line ("Papel: Todos", "Plano: Pro"): 44px, 16px text at every
 * width (no iOS zoom), full width on the phone. Write the prefix in the option text, like
 * Membros does: `<option>Papel: {{ o.label }}</option>`.
 */
@Directive({
  selector: 'select[listFilterSelect]',
  host: {
    class:
      'w-full sm:w-auto min-h-[44px] px-3 text-base border border-edge-field rounded-xl bg-surface ' +
      'text-fg focus:outline-none focus:ring-2 focus:ring-primary-400',
  },
})
export class ListFilterSelect {}

let nextId = 0;

/**
 * The header of a platform list, inside `app-page-card title="Lista"` and above `app-data-list`
 * (owner decision D1, 18/11/2026). Copies the tenant's Membros/Aluguéis header:
 *
 * 1. Search (`type=search`, 44px, magnifier on the left, 16px text) + any projected
 *    `select[listFilterSelect]` on the same line (stacked on the phone).
 * 2. One row of situation pills (`app-filter-chip-group`, scrollable on the phone; active =
 *    solid orange). Situation only: other dimensions go in a select, never in a second pill row.
 * 3. Results count ("12 resultados", `role=status`) and "Limpar filtros" when any filter is on.
 *
 * It holds no filter state: the page owns `query`/`status` and reacts to the outputs.
 */
@Component({
  selector: 'app-list-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilterChipGroup],
  host: { class: 'block min-w-0' },
  template: `
    <div class="space-y-3">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3">
        @if (search()) {
          <div class="relative flex-1 min-w-0">
            <label [for]="searchId" class="sr-only">{{ searchLabel() }}</label>
            <span
              class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-faint"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              data-list-search
              [id]="searchId"
              type="search"
              inputmode="search"
              enterkeyhint="search"
              autocomplete="off"
              [placeholder]="searchPlaceholder()"
              [value]="draft()"
              (input)="onInput($event)"
              class="w-full min-h-[44px] pl-9 pr-3 text-base border border-edge-field rounded-xl
                     bg-surface text-fg placeholder:text-fg-faint
                     focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
        }
        <div data-list-selects class="flex flex-col sm:flex-row gap-3 empty:hidden">
          <ng-content select="select, [listFilters]" />
        </div>
      </div>

      @if (statusOptions(); as options) {
        <app-filter-chip-group
          [options]="options"
          [value]="status()"
          [scrollable]="true"
          [ariaLabel]="statusLabel()"
          (selectionChange)="onStatus($event)"
        />
      }

      @if (resultCount() !== null || filtersActive()) {
        <div class="flex items-center justify-between gap-3 min-h-[44px]">
          <p data-list-results role="status" aria-live="polite" class="text-xs text-fg-subtle tabular-nums">
            {{ resultsText() }}
          </p>
          @if (filtersActive()) {
            <button
              type="button"
              data-list-clear
              (click)="clear()"
              class="min-h-[44px] px-3 -mr-3 text-sm font-semibold text-fg-muted
                     hover:text-primary-700 dark:hover:text-primary-400 rounded-lg
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              Limpar filtros
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class ListToolbar<T = string> {
  /** Show the search field. */
  readonly search = input(true);
  readonly searchLabel = input('Buscar');
  readonly searchPlaceholder = input('Buscar…');
  /** The page's current search text. Setting it (e.g. to '') rewrites the field. */
  readonly query = input('');
  /** Milliseconds to wait after the last keystroke before `queryChange` (server search: ~300). */
  readonly searchDebounce = input(0);

  /** Situation pills. `null` = no pill row. */
  readonly statusOptions = input<readonly FilterChipOption<T>[] | null>(null);
  readonly status = input<T | null>(null);
  readonly statusLabel = input('Filtrar por situação');

  /** Records matching the current filters. `null` hides the line. */
  readonly resultCount = input<number | null>(null);
  /** Singular and plural, e.g. `['usuário', 'usuários']`. */
  readonly resultNoun = input<readonly [string, string]>(['resultado', 'resultados']);
  /** Any filter (search, pill, select) differs from its default: shows "Limpar filtros". */
  readonly filtersActive = input(false);

  readonly queryChange = output<string>();
  readonly statusChange = output<T>();
  readonly clearFilters = output<void>();

  protected readonly searchId = `list-search-${++nextId}`;
  /** What the field shows; follows `query` and the user's typing. */
  protected readonly draft = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly resultsText = computed(() =>
    resultsLabel(this.resultCount() ?? 0, this.resultNoun()),
  );

  constructor() {
    effect(() => {
      const q = this.query();
      untracked(() => this.draft.set(q));
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draft.set(text);
    this.cancel();
    const wait = this.searchDebounce();
    if (wait <= 0) {
      this.queryChange.emit(text);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.queryChange.emit(text);
    }, wait);
  }

  protected onStatus(value: T | null): void {
    if (value !== null) this.statusChange.emit(value);
  }

  protected clear(): void {
    this.cancel();
    if (this.draft() !== '') {
      this.draft.set('');
      this.queryChange.emit('');
    }
    this.clearFilters.emit();
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

const COUNT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "1 resultado", "12 resultados", "1.234 usuários". */
export function resultsLabel(count: number, noun: readonly [string, string]): string {
  return `${COUNT.format(count)} ${count === 1 ? noun[0] : noun[1]}`;
}

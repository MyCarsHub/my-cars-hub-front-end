import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { BackLink } from '../../components/core/back-link/back-link';
import {
  DateRange,
  DateRangePicker,
} from '../../components/date-range-picker/date-range-picker';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../components/filter-chip-group/filter-chip-group';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverLedgerService } from '../../services/driver-ledger.service';
import {
  DriverDashboard,
  LedgerCategory,
  LedgerEntry,
  LedgerKind,
} from '../../types/driver-ledger.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import {
  LEDGER_CATEGORIES,
  categoriesOf,
  mergeEntry,
  periodTooLong,
} from '../../utils/driver-ledger';
import {
  DRIVER_PERIOD_PRESETS,
  ENTRIES_PAGE_SIZE,
  PERIOD_TOO_LONG_MESSAGE,
} from './driver-area.constants';
import { DriverEntryCard } from './driver-entry-card';
import { DriverEntryEditor } from './driver-entry-editor';
import { DriverKpiStrip } from './driver-kpi-strip';

/** Sentinel of the two "everything" chips; never sent to the server. */
export const ALL = 'ALL';
type KindFilter = LedgerKind | typeof ALL;
type CategoryFilter = LedgerCategory | typeof ALL;

const KIND_OPTIONS: readonly FilterChipOption<KindFilter>[] = [
  { value: ALL, label: 'Tudo' },
  { value: 'INCOME', label: 'Ganhos' },
  { value: 'EXPENSE', label: 'Custos' },
];

/**
 * `/meu-painel/lancamentos` — every entry the driver recorded, with the filters that answer
 * "quanto gastei de combustível este mês?": period, kind and category, paged, as phone cards.
 *
 * The totals strip above the list is the period's (the same numbers as the home, through
 * the same endpoint) and is deliberately NOT narrowed by the kind and category chips: it
 * says what the period was, the list below says which entries made it. The edit and delete
 * flow is the home's, through the same `DriverEntryEditor`.
 */
@Component({
  selector: 'app-driver-entries',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AlertBanner,
    BackLink,
    DateRangePicker,
    DefaultPageLayout,
    DriverEntryCard,
    DriverEntryEditor,
    DriverKpiStrip,
    FilterChipGroup,
  ],
  templateUrl: './driver-entries.html',
})
export class DriverEntries {
  private readonly ledger = inject(DriverLedgerService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly presetKeys = DRIVER_PERIOD_PRESETS;
  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly today = todayInBusinessTz();
  protected readonly pageSize = ENTRIES_PAGE_SIZE;

  protected readonly range = signal<DateRange | null>(null);
  protected readonly kind = signal<KindFilter>(ALL);
  protected readonly category = signal<CategoryFilter>(ALL);
  protected readonly page = signal(0);

  protected readonly entries = signal<LedgerEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly summary = signal<DriverDashboard | null>(null);

  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly editor = viewChild.required(DriverEntryEditor);

  protected readonly activeRental = computed(() => this.summary()?.activeRental ?? null);

  /**
   * The totals come from the dashboard endpoint, which refuses more than 366 days; the list
   * itself has no such limit. A longer custom period keeps its list and loses only the strip,
   * and says why instead of leaving the previous period's numbers under the new dates.
   */
  protected readonly summaryTooLong = computed(() => {
    const range = this.range();
    return range ? periodTooLong(range) : false;
  });
  protected readonly tooLongMessage = PERIOD_TOO_LONG_MESSAGE;

  /** The category chips follow the kind: "Combustível" is not offered under "Ganhos". */
  protected readonly categoryOptions = computed<readonly FilterChipOption<CategoryFilter>[]>(() => {
    const kind = this.kind();
    const source = kind === ALL ? LEDGER_CATEGORIES : categoriesOf(kind);
    return [
      { value: ALL, label: 'Todas' },
      ...source.map((c) => ({ value: c.value as CategoryFilter, label: c.label })),
    ];
  });

  protected readonly hasFilters = computed(
    () => this.kind() !== ALL || this.category() !== ALL,
  );

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );
  protected readonly hasPrevious = computed(() => this.page() > 0);
  protected readonly hasNext = computed(() => this.page() + 1 < this.totalPages());

  private readonly list$ = new Subject<void>();
  private readonly summary$ = new Subject<void>();

  constructor() {
    this.list$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap(() => {
          const range = this.range();
          if (!range) return EMPTY;
          const kind = this.kind();
          const category = this.category();
          return this.ledger
            .list({
              from: range.from,
              to: range.to,
              kind: kind === ALL ? null : kind,
              category: category === ALL ? null : category,
              page: this.page(),
              size: this.pageSize,
            })
            .pipe(
              catchError((err: unknown) => {
                this.loading.set(false);
                this.error.set(
                  this.apiErrors.messageFor(
                    err,
                    'Não foi possível carregar os lançamentos. Tente novamente.',
                  ),
                );
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this.entries.set(res.content);
        this.total.set(res.total);
        this.loading.set(false);
        this.loaded.set(true);
      });

    this.summary$
      .pipe(
        switchMap(() => {
          const range = this.range();
          if (!range) return EMPTY;
          if (periodTooLong(range)) {
            this.summary.set(null);
            return EMPTY;
          }
          // The strip is context, not the page: when it fails the list still works.
          return this.ledger.dashboard(range.from, range.to).pipe(catchError(() => EMPTY));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((summary) => this.summary.set(summary));
  }

  protected onRangeChange(range: DateRange): void {
    this.range.set(range);
    this.page.set(0);
    this.list$.next();
    this.summary$.next();
  }

  protected chooseKind(kind: KindFilter): void {
    if (kind === this.kind()) return;
    this.kind.set(kind);
    // A category of the other kind would filter everything out; reset it with the kind.
    const category = this.category();
    if (category !== ALL && kind !== ALL) {
      const belongs = categoriesOf(kind).some((c) => c.value === category);
      if (!belongs) this.category.set(ALL);
    }
    this.page.set(0);
    this.list$.next();
  }

  protected chooseCategory(category: CategoryFilter): void {
    if (category === this.category()) return;
    this.category.set(category);
    this.page.set(0);
    this.list$.next();
  }

  protected clearFilters(): void {
    this.kind.set(ALL);
    this.category.set(ALL);
    this.page.set(0);
    this.list$.next();
  }

  protected previous(): void {
    if (!this.hasPrevious()) return;
    this.page.update((p) => p - 1);
    this.list$.next();
  }

  protected next(): void {
    if (!this.hasNext()) return;
    this.page.update((p) => p + 1);
    this.list$.next();
  }

  protected reload(): void {
    this.list$.next();
  }

  protected add(kind: LedgerKind): void {
    this.editor().openCreate(kind);
  }

  protected onEdit(entry: LedgerEntry): void {
    this.editor().openEdit(entry);
  }

  protected onRemove(entry: LedgerEntry): void {
    this.editor().askDelete(entry);
  }

  /**
   * In place first, refetch behind. A row the current filters would not return is not
   * inserted (and is removed when an edit moved it out) — the list is "what the filters
   * match", and the next refetch must have nothing to undo.
   */
  protected onSaved(entry: LedgerEntry): void {
    const range = this.range();
    const kind = this.kind();
    const category = this.category();
    const matches =
      (kind === ALL || entry.kind === kind) && (category === ALL || entry.category === category);

    this.entries.update((list) =>
      matches
        ? mergeEntry(list, entry, {
            from: range?.from ?? null,
            to: range?.to ?? null,
            limit: this.pageSize,
          })
        : list.filter((e) => e.id !== entry.id),
    );
    this.list$.next();
    this.summary$.next();
  }

  protected onRemoved(id: string): void {
    this.entries.update((list) => list.filter((e) => e.id !== id));
    // Deleting the last row of a later page would leave an empty page: step back.
    if (this.entries().length === 0 && this.page() > 0) this.page.update((p) => p - 1);
    this.list$.next();
    this.summary$.next();
  }
}

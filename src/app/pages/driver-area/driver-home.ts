import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, forkJoin, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { DateRange, DateRangePicker } from '../../components/date-range-picker/date-range-picker';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverLedgerService } from '../../services/driver-ledger.service';
import { formatDate } from '../../types/dashboard.types';
import { DriverDashboard, LedgerEntry, LedgerKind } from '../../types/driver-ledger.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { mergeEntry, periodTooLong } from '../../utils/driver-ledger';
import {
  DRIVER_PERIOD_PRESETS,
  PERIOD_TOO_LONG_MESSAGE,
  RECENT_ENTRIES,
} from './driver-area.constants';
import { DriverBreakdown } from './driver-breakdown';
import { DriverCharges } from './driver-charges';
import { DriverEntryCard } from './driver-entry-card';
import { DriverEntryEditor } from './driver-entry-editor';
import { DriverKpiStrip } from './driver-kpi-strip';

/**
 * `/meu-painel` — the DRIVER's home: what came in, what went out, what is left, and the two
 * buttons that feed it.
 *
 * Mobile-first, in the order a driver reads it with a thumb: the two 48px actions, the
 * period, the three numbers, the active rental, the breakdown by category, the last entries.
 * For a driver with nothing recorded the actions move INTO an invitation card instead of
 * repeating: one place to press, never two.
 *
 * ## Why it is not the fleet Dashboard
 *
 * It reads `/v1/driver/**` only. Nothing here is a company number: the driver's ledger is
 * his own bookkeeping, scoped by the server to his identity, and never feeds the company's
 * finances.
 *
 * ## Refreshing after a save
 *
 * The editor reports the entry the server returned. The "recentes" list is patched at once
 * (`mergeEntry`), and the totals are refetched behind it without blanking the numbers —
 * the skeleton is for the first paint only. Requests are `switchMap`ped, so a slow answer
 * for a chip the driver already left can never overwrite the one he is looking at.
 */
@Component({
  selector: 'app-driver-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AlertBanner,
    DateRangePicker,
    DefaultPageLayout,
    DriverBreakdown,
    DriverCharges,
    DriverEntryCard,
    DriverEntryEditor,
    DriverKpiStrip,
  ],
  templateUrl: './driver-home.html',
})
export class DriverHome {
  private readonly ledger = inject(DriverLedgerService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly presetKeys = DRIVER_PERIOD_PRESETS;
  protected readonly today = todayInBusinessTz();

  protected readonly range = signal<DateRange | null>(null);
  protected readonly summary = signal<DriverDashboard | null>(null);
  protected readonly recent = signal<LedgerEntry[]>([]);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly editor = viewChild.required(DriverEntryEditor);

  protected readonly activeRental = computed(() => this.summary()?.activeRental ?? null);

  /** Loaded, and the period has no entry at all: time for the invitation. */
  protected readonly isEmpty = computed(
    () => this.loaded() && (this.summary()?.totals.entryCount ?? 0) === 0,
  );

  /** A custom period beyond what the server answers: the message has no "try again". */
  protected readonly tooLong = computed(() => {
    const range = this.range();
    return range ? periodTooLong(range) : false;
  });

  protected readonly hasBreakdown = computed(() => (this.summary()?.byCategory.length ?? 0) > 0);

  protected readonly entryCount = computed(() => this.summary()?.totals.entryCount ?? 0);

  protected readonly rentalSince = computed(() => {
    const start = this.activeRental()?.startDate;
    return start ? formatDate(start) : null;
  });

  protected readonly rentalVehicle = computed(() => {
    const r = this.activeRental();
    if (!r) return '';
    return [r.brand, r.model].filter(Boolean).join(' ');
  });

  /**
   * The two actions, white text on the 5.5:1 fills of the design system (`success-800` and
   * `primary-700`) — not the 500 steps, which are below AA for text of this size.
   */
  protected readonly actionClass =
    'min-h-12 w-full px-3 py-2 rounded-xl text-base font-semibold text-white shadow-sm ' +
    'inline-flex items-center justify-center gap-2 leading-tight text-center ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ';
  protected readonly incomeActionClass =
    this.actionClass + 'bg-success-800 hover:bg-success-900 focus-visible:ring-success-500';
  protected readonly expenseActionClass =
    this.actionClass + 'bg-primary-700 hover:bg-primary-800 focus-visible:ring-primary-400';

  private readonly reload$ = new Subject<void>();

  constructor() {
    this.reload$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap(() => {
          const range = this.range();
          if (!range) return EMPTY;
          // The server answers 400 beyond 366 days. Say it here, and let `switchMap` drop
          // whatever the previous period still had in flight.
          if (periodTooLong(range)) {
            this.loading.set(false);
            this.error.set(PERIOD_TOO_LONG_MESSAGE);
            // No numbers of the previous period under the new dates.
            this.summary.set(null);
            this.recent.set([]);
            this.loaded.set(false);
            return EMPTY;
          }
          return forkJoin({
            summary: this.ledger.dashboard(range.from, range.to),
            recent: this.ledger.list({
              from: range.from,
              to: range.to,
              page: 0,
              size: RECENT_ENTRIES,
            }),
          }).pipe(
            catchError((err: unknown) => {
              this.loading.set(false);
              this.error.set(
                this.apiErrors.messageFor(
                  err,
                  'Não foi possível carregar o seu painel. Tente novamente.',
                ),
              );
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ summary, recent }) => {
        this.summary.set(summary);
        this.recent.set(recent.content);
        this.loading.set(false);
        this.loaded.set(true);
      });
  }

  protected onRangeChange(range: DateRange): void {
    this.range.set(range);
    this.reload$.next();
  }

  protected reload(): void {
    this.reload$.next();
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

  /** The row is in the list before the refetch answers; the refetch then reconciles. */
  protected onSaved(entry: LedgerEntry): void {
    const range = this.range();
    this.recent.update((list) =>
      mergeEntry(list, entry, {
        from: range?.from ?? null,
        to: range?.to ?? null,
        limit: RECENT_ENTRIES,
      }),
    );
    this.reload$.next();
  }

  protected onRemoved(id: string): void {
    this.recent.update((list) => list.filter((e) => e.id !== id));
    this.reload$.next();
  }
}

import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, from, map, mergeMap, of, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import { RentalListItemDto, RentalStatus } from '../../../types/rental.types';
import { RENTAL_STATUS_META, rentalStatusMeta } from '../../../utils/status-maps';
import { RentalService } from '../../rentals/rental.service';
import {
  DRIVER_RENTAL_TODAY,
  ListAlert,
  fullDate,
  listAlert,
  plural,
  rateLine,
} from './driver-rental-view';

const LOAD_ERROR = 'Não foi possível carregar seus aluguéis.';

/** A driver has a handful of rentals: one request brings them all, the screen pages them. */
const FETCH_SIZE = 100;
export const DRIVER_RENTALS_PAGE_SIZE = 10;
/** Charges are read for the VISIBLE page only, at most this many requests at a time. */
export const CHARGES_CONCURRENCY = 3;

type Order = 'DESC' | 'ASC';

interface Card {
  readonly id: string;
  readonly plate: string;
  readonly model: string;
  readonly chipLabel: string;
  readonly chipClass: string;
  readonly period: string;
  readonly rate: string;
  readonly alert: ListAlert | null;
}

/**
 * "Meus aluguéis" — the DRIVER's list, from the owner's prototype: search by plate or
 * model, filter by situation, order by start, one card per rental with the line that
 * matters ("1 cobrança atrasada", "Próxima cobrança em 13/10", "Começa em 20/10").
 *
 * `GET /v1/rentals` already answers only the caller's rentals; the row carries plate and
 * model. The alert and the rate come from each rental's own charges
 * (`GET /v1/rentals/{id}/charges`) — a failure there only drops that card's line, never the
 * list. Four states: skeleton, error with "Tentar novamente", empty, empty with filters.
 */
@Component({
  selector: 'app-driver-rentals-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, DefaultPageLayout, RouterLink],
  templateUrl: './driver-rentals-list.html',
})
export class DriverRentalsList {
  private readonly rentals = inject(RentalService);
  private readonly chargesApi = inject(DriverRentalChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly todayFn = inject(DRIVER_RENTAL_TODAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  /** "Today" of the cards' alert lines; refreshed on reload and when the tab comes back. */
  private readonly today = signal(this.todayFn());

  /** "Todos" + the four situations, labels from status-maps (the prototype's chips). */
  protected readonly statusChips: readonly { value: RentalStatus | ''; label: string }[] = [
    { value: '', label: 'Todos' },
    ...(['ACTIVE', 'RESERVED', 'COMPLETED', 'CANCELED'] as const).map((value) => ({
      value,
      label: RENTAL_STATUS_META[value].label,
    })),
  ];

  /** Phone only: the situation chips and the order open under "Filtrar". */
  protected readonly filtersOpen = signal(false);

  protected readonly items = signal<RentalListItemDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Charges per rental id; `null` = could not be read (the card just has no alert line). */
  private readonly chargesById = signal<ReadonlyMap<string, DriverCharge[] | null>>(new Map());

  protected readonly query = signal('');
  protected readonly status = signal<RentalStatus | ''>('');
  protected readonly order = signal<Order>('DESC');
  protected readonly page = signal(0);

  protected readonly activeFilterCount = computed(
    () => (this.status() !== '' ? 1 : 0) + (this.order() !== 'DESC' ? 1 : 0),
  );

  protected readonly hasFilters = computed(
    () => this.query().trim() !== '' || this.status() !== '' || this.order() !== 'DESC',
  );

  private readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const status = this.status();
    const sign = this.order() === 'ASC' ? 1 : -1;
    return this.items()
      .filter((r) => !status || r.status === status)
      .filter((r) => {
        if (!q) return true;
        const hay = [r.vehiclePlate, r.vehicleBrand, r.vehicleModel].filter(Boolean).join(' ');
        return hay.toLowerCase().includes(q);
      })
      .sort((a, b) => sign * a.startDate.localeCompare(b.startDate));
  });

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / DRIVER_RENTALS_PAGE_SIZE)),
  );

  private readonly pageItems = computed(() => {
    const start = this.page() * DRIVER_RENTALS_PAGE_SIZE;
    return this.filtered().slice(start, start + DRIVER_RENTALS_PAGE_SIZE);
  });

  /** The visible ids as one string, so the same page does not re-trigger the fetch. */
  private readonly pageKey = computed(() =>
    this.pageItems()
      .map((r) => r.id)
      .join(','),
  );

  protected readonly cards = computed<readonly Card[]>(() => {
    const today = this.today();
    const charges = this.chargesById();
    return this.pageItems().map((r) => {
        const meta = rentalStatusMeta(r.status);
        const own = charges.get(r.id) ?? null;
        return {
          id: r.id,
          plate: (r.vehiclePlate ?? '').toUpperCase() || 'Veículo',
          model: [r.vehicleBrand, r.vehicleModel].filter(Boolean).join(' '),
          chipLabel: meta.label,
          chipClass: meta.chip,
          period: `${fullDate(r.startDate)} → ${fullDate(r.endDate)}`,
          rate: rateLine(own, r.billingFrequency),
          alert: listAlert(r.status, r.startDate, own, today),
        };
      });
  });

  protected readonly countLabel = computed(() =>
    plural(this.filtered().length, 'aluguel', 'aluguéis'),
  );

  protected readonly emptyAll = computed(() => this.loaded() && this.items().length === 0);
  protected readonly emptyFiltered = computed(
    () => this.loaded() && this.items().length > 0 && this.filtered().length === 0,
  );

  private readonly load$ = new Subject<void>();
  private readonly chargesFor$ = new Subject<string[]>();
  /** Bumped on every successful load, so the same page of a reload fetches again. */
  private readonly loadGen = signal(0);

  constructor() {
    this.load$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
          this.today.set(this.todayFn());
          // A reload drops what was read and cancels what is still in flight.
          this.chargesById.set(new Map());
          this.chargesFor$.next([]);
        }),
        switchMap(() =>
          this.rentals.list({ size: FETCH_SIZE }).pipe(
            map((page) => page.content ?? []),
            catchError((err: unknown) => {
              this.error.set(this.apiErrors.messageFor(err, LOAD_ERROR));
              this.loading.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((items) => {
        this.items.set(items);
        this.loading.set(false);
        this.loaded.set(true);
        this.loadGen.update((n) => n + 1);
      });

    this.chargesFor$
      .pipe(
        switchMap((ids) => {
          const known = untracked(() => this.chargesById());
          return from(ids.filter((id) => !known.has(id))).pipe(
            mergeMap(
              (id) =>
                this.chargesApi.list(id).pipe(
                  map((list): [string, DriverCharge[] | null] => [id, list]),
                  catchError((err: unknown) => {
                    this.apiErrors.claim(err);
                    return of<[string, DriverCharge[] | null]>([id, null]);
                  }),
                ),
              CHARGES_CONCURRENCY,
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(([id, list]) =>
        this.chargesById.update((m) => new Map(m).set(id, list)),
      );

    // The visible page (after a load, a filter or a page turn) asks for its own charges.
    effect(() => {
      this.loadGen();
      const key = this.pageKey();
      untracked(() => this.chargesFor$.next(key ? key.split(',') : []));
    });

    const onVisible = (): void => {
      if (this.document.visibilityState === 'visible') this.today.set(this.todayFn());
    };
    this.document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisible),
    );

    this.load$.next();
  }

  protected reload(): void {
    this.load$.next();
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(0);
  }

  protected setStatus(value: RentalStatus | ''): void {
    this.status.set(value);
    this.page.set(0);
  }

  protected toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onOrder(event: Event): void {
    this.order.set((event.target as HTMLSelectElement).value === 'ASC' ? 'ASC' : 'DESC');
    this.page.set(0);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.status.set('');
    this.order.set('DESC');
    this.page.set(0);
  }

  protected prev(): void {
    this.page.update((p) => Math.max(0, p - 1));
  }

  protected next(): void {
    this.page.update((p) => Math.min(this.pageCount() - 1, p + 1));
  }
}

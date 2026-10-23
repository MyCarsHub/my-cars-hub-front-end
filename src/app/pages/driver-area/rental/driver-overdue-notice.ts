import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import { groupDriverCharges } from '../../../utils/driver-charges';
import { DRIVER_RENTAL_TODAY, daysBetween, money, plural } from './driver-rental-view';

/**
 * The rose notice at the top of the driver's dashboard: HIS overdue charges, with the total
 * and how late the oldest one is. "Pagar agora" takes him to his rental, where the Pix popup
 * lives (one place to pay).
 *
 * Reads `GET /v1/rentals/{id}/charges`, which only answers for the caller's own rental, so it
 * can never show another driver's debt. It stays silent while loading, on error (the
 * "Aluguel da semana" card beside it already offers a retry) and when nothing is overdue.
 */
@Component({
  selector: 'app-driver-overdue-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (summary(); as s) {
      <section
        class="flex items-center gap-3 px-3.5 py-2.5 min-h-14 rounded-xl border bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200"
        aria-label="Cobranças em atraso"
        data-driver-overdue-notice
      >
        <span
          class="shrink-0 size-9 rounded-[10px] flex items-center justify-center bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300"
          aria-hidden="true"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16h.01" />
          </svg>
        </span>
        <span class="flex-1 min-w-0 flex flex-col">
          <span class="text-xs font-medium opacity-80" data-notice-title>{{ s.title }}</span>
          <span class="text-base font-semibold tabular-nums" data-notice-amount>{{ s.amount }}</span>
          <span class="text-xs opacity-80" data-notice-late>{{ s.late }}</span>
        </span>
        <a
          [routerLink]="['/alugueis', rentalId()]"
          data-pay-now
          class="shrink-0 min-h-11 px-4 inline-flex items-center rounded-xl bg-rose-700 dark:bg-rose-400 text-white dark:text-rose-950 text-sm font-semibold hover:bg-rose-800 dark:hover:bg-rose-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
        >
          Pagar agora
        </a>
      </section>
    }
  `,
})
export class DriverOverdueNotice {
  readonly rentalId = input.required<string>();

  private readonly service = inject(DriverRentalChargesService);
  private readonly todayFn = inject(DRIVER_RENTAL_TODAY);
  private readonly document = inject(DOCUMENT);

  private readonly today = signal(this.todayFn());
  private readonly charges = signal<DriverCharge[]>([]);

  /** `null` when there is nothing overdue (the notice is not drawn at all). */
  protected readonly summary = computed(() => {
    const overdue = groupDriverCharges(this.charges(), this.today()).overdue;
    if (overdue.length === 0) return null;
    const total = overdue.reduce((sum, c) => sum + c.amount, 0);
    // `overdue` is sorted oldest first; a charge with no due date has no "days" to count.
    const oldest = overdue.find((c) => c.dueDate !== null)?.dueDate ?? null;
    const days = oldest ? Math.max(daysBetween(oldest, this.today()), 0) : 0;
    return {
      title: plural(overdue.length, 'cobrança atrasada', 'cobranças atrasadas'),
      amount: money(total),
      late: oldest
        ? `${plural(days, 'dia', 'dias')} de atraso${overdue.length > 1 ? ' na mais antiga' : ''}`
        : 'Pode incluir multa e juros',
    };
  });

  private readonly load$ = new Subject<string>();

  constructor() {
    this.load$
      .pipe(
        tap(() => this.today.set(this.todayFn())),
        switchMap((id) => this.service.list(id).pipe(catchError(() => EMPTY))),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.charges.set(list));

    effect(() => this.load$.next(this.rentalId()));

    const onVisible = (): void => {
      if (this.document.visibilityState === 'visible') this.load$.next(this.rentalId());
    };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisible),
    );
  }
}

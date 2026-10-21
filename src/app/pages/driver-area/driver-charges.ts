import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverRentalChargesService } from '../../services/driver-rental-charges.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { formatDate } from '../../types/dashboard.types';
import { DriverCharge, DriverChargeGroups } from '../../types/driver-charges.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { driverChargeKindLabel, groupDriverCharges, paidDayOf } from '../../utils/driver-charges';

const LOAD_ERROR = 'Não foi possível carregar os pagamentos.';
const NOT_FOUND = 'Não encontramos os pagamentos deste aluguel.';

/** A second tap inside this window is the same tap: it would open the payment twice. */
const DOUBLE_TAP_LOCK_MS = 1000;

const EMPTY_GROUPS: DriverChargeGroups = { overdue: [], next: null, upcoming: [], history: [] };

/**
 * "Pagamentos" — what the DRIVER owes on his rental, and the way to pay it.
 *
 * Reads `GET /v1/rentals/{id}/charges` (the DRIVER's own view), never the operator's `charges`
 * of the rental detail. What is overdue comes first and red, then the one to pay next with a
 * big value and a big button, then the other open ones, then what is already paid.
 *
 * "Pagar" opens the gateway's invoice page (QR Pix and copy-and-paste) OUTSIDE the app, through
 * `ExternalNavigationService`: it is an external payment link, not a document of ours.
 *
 * The driver leaves the app to pay and comes back to this tab, so the list is refetched
 * quietly (no skeleton, no error banner) whenever the tab becomes visible again.
 */
@Component({
  selector: 'app-driver-charges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, NgTemplateOutlet],
  templateUrl: './driver-charges.html',
})
export class DriverCharges {
  /** The rental to list. A new id reloads. */
  readonly rentalId = input.required<string>();

  private readonly service = inject(DriverRentalChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly externalNav = inject(ExternalNavigationService);
  private readonly document = inject(DOCUMENT);

  protected readonly charges = signal<DriverCharge[]>([]);
  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A 404 is not a hiccup: trying again would answer the same. */
  protected readonly notFound = signal(false);

  private readonly today = signal(todayInBusinessTz());

  /** The charge whose payment link was just tried, and whether the new tab really opened. */
  protected readonly paying = signal<{ id: string; opened: boolean } | null>(null);
  /** True for a moment after a tap on "Pagar", so a double tap opens one tab, not two. */
  protected readonly payLocked = signal(false);
  private lockTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly groups = computed<DriverChargeGroups>(() =>
    this.loaded() ? groupDriverCharges(this.charges(), this.today()) : EMPTY_GROUPS,
  );

  /** Loaded, but there is nothing the driver can see or do. */
  protected readonly isEmpty = computed(() => {
    const g = this.groups();
    return (
      this.loaded() &&
      g.overdue.length === 0 &&
      !g.next &&
      g.upcoming.length === 0 &&
      g.history.length === 0
    );
  });

  /** `quiet` is a refetch behind a screen that already shows data. */
  private readonly reload$ = new Subject<{ quiet: boolean }>();

  constructor() {
    this.reload$
      .pipe(
        tap(({ quiet }) => {
          this.today.set(todayInBusinessTz());
          if (quiet) return;
          this.loading.set(true);
          this.error.set(null);
          this.notFound.set(false);
        }),
        switchMap(({ quiet }) =>
          this.service.list(this.rentalId()).pipe(
            catchError((err: unknown) => {
              this.apiErrors.claim(err);
              this.loading.set(false);
              if (quiet) return EMPTY;
              const missing = err instanceof HttpErrorResponse && err.status === 404;
              this.notFound.set(missing);
              this.error.set(missing ? NOT_FOUND : LOAD_ERROR);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.charges.set(list);
        this.loading.set(false);
        this.loaded.set(true);
      });

    // First load, and every change of rental. Nothing of the previous rental stays on screen.
    effect(() => {
      this.rentalId();
      this.charges.set([]);
      this.loaded.set(false);
      this.reload$.next({ quiet: false });
    });

    const onVisible = (): void => {
      if (this.document.visibilityState === 'visible' && this.loaded()) {
        this.reload$.next({ quiet: true });
      }
    };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisible);
      if (this.lockTimer) clearTimeout(this.lockTimer);
    });
  }

  protected reload(): void {
    this.reload$.next({ quiet: false });
  }

  protected pay(charge: DriverCharge): void {
    if (!charge.checkoutUrl || this.payLocked()) return;
    this.payLocked.set(true);
    const opened = this.externalNav.openExternal(charge.checkoutUrl);
    this.paying.set({ id: charge.id, opened });
    this.lockTimer = setTimeout(() => this.payLocked.set(false), DOUBLE_TAP_LOCK_MS);
  }

  protected label(charge: DriverCharge): string {
    return driverChargeKindLabel(charge.kind);
  }

  protected money(cents: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      cents / 100,
    );
  }

  /** "Vence hoje" / "Vence em 05/11/2026"; empty when the charge has no due date. */
  protected dueText(charge: DriverCharge): string {
    if (!charge.dueDate) return '';
    return charge.dueDate === this.today()
      ? 'Vence hoje'
      : `Vence em ${formatDate(charge.dueDate)}`;
  }

  protected overdueText(charge: DriverCharge): string {
    return charge.dueDate ? `Venceu em ${formatDate(charge.dueDate)}` : '';
  }

  protected paidText(charge: DriverCharge): string {
    if (charge.status === 'REFUNDED') return 'Devolvido';
    const day = paidDayOf(charge.paidAt);
    return day ? `Pago em ${formatDate(day)}` : 'Pago';
  }

  /** Spoken name of a pay button: the visible words plus what is being paid. */
  protected payLabel(verb: string, charge: DriverCharge): string {
    return `${verb}: ${this.label(charge)}, ${this.money(charge.amount)}`;
  }
}

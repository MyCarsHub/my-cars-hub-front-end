import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import { DRIVER_RENTAL_TODAY, buildHero, dayMonth, weekday } from './driver-rental-view';

/**
 * The "Aluguel da semana" card of the driver's dashboard, from the prototype: the next
 * charge (or the overdue one) in one line, and "Como pagar", which takes him to his rental
 * where the "Pagar cobrança" popup lives. Paying is NOT done from here: one place to pay.
 */
@Component({
  selector: 'app-driver-next-charge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden mb-4"
      aria-labelledby="driver-next-charge-title"
      data-driver-next-charge
    >
      <div class="px-4 sm:px-6 pt-5 pb-1">
        <h2 id="driver-next-charge-title" class="text-base font-semibold text-neutral-800">
          Aluguel da semana
        </h2>
      </div>
      <div class="px-4 sm:px-6 pt-3 pb-4 sm:pb-6">
        @if (failed()) {
          <p class="text-sm text-neutral-600" data-next-error>
            Não foi possível carregar a próxima cobrança.
            <button
              type="button"
              (click)="reload()"
              class="min-h-11 inline-flex items-center font-semibold underline underline-offset-2 text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-sm cursor-pointer"
            >
              Tentar novamente
            </button>
          </p>
        } @else if (!loaded()) {
          <div class="h-11 rounded-xl bg-neutral-100 animate-pulse" aria-hidden="true"></div>
        } @else {
          <div class="flex items-center justify-between gap-3">
            <span class="flex flex-col gap-0.5 min-w-0">
              <span
                class="text-xs uppercase tracking-wide"
                [class.text-rose-700]="overdue()"
                [class.text-neutral-500]="!overdue()"
                >{{ label() }}</span
              >
              <span class="text-sm font-semibold text-neutral-900 tabular-nums" data-next-line>
                @if (amount(); as value) {
                  <span class="font-mono">{{ value }}</span>
                  @if (when(); as w) {
                    · {{ w }}
                  }
                } @else {
                  Nenhuma cobrança em aberto
                }
              </span>
            </span>
            <a
              [routerLink]="['/alugueis', rentalId()]"
              class="shrink-0 min-h-11 inline-flex items-center text-sm font-semibold text-primary-700 hover:text-primary-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-sm"
              data-how-to-pay
            >
              {{ amount() ? 'Como pagar' : 'Ver aluguel' }}
            </a>
          </div>
        }
      </div>
    </section>
  `,
})
export class DriverNextCharge {
  readonly rentalId = input.required<string>();

  private readonly service = inject(DriverRentalChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly todayFn = inject(DRIVER_RENTAL_TODAY);

  private readonly charges = signal<DriverCharge[]>([]);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);

  /** Same choice as the colored block of the rental: overdue first, then the next one. */
  private readonly hero = computed(() =>
    this.loaded()
      ? buildHero('ACTIVE', this.charges(), this.todayFn(), { startDate: '', endDate: '' })
      : null,
  );

  protected readonly overdue = computed(() => this.hero()?.tone === 'overdue');

  protected readonly label = computed(() =>
    this.overdue() ? 'Cobrança atrasada' : 'Próxima cobrança',
  );

  /** "R$ 650,00", or empty when nothing is open. */
  protected readonly amount = computed(() => {
    const h = this.hero();
    return h && (h.tone === 'overdue' || h.tone === 'next') ? h.value : '';
  });

  /** "terça, 13/10" / "venceu em 06/10". */
  protected readonly when = computed(() => {
    const c = this.hero()?.charge;
    if (!c?.dueDate) return '';
    return this.overdue()
      ? `venceu em ${dayMonth(c.dueDate)}`
      : `${weekday(c.dueDate)}, ${dayMonth(c.dueDate)}`;
  });

  private readonly load$ = new Subject<string>();

  constructor() {
    this.load$
      .pipe(
        tap(() => this.failed.set(false)),
        switchMap((id) =>
          this.service.list(id).pipe(
            catchError((err: unknown) => {
              this.apiErrors.claim(err);
              this.failed.set(true);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.charges.set(list);
        this.loaded.set(true);
      });

    effect(() => {
      const id = this.rentalId();
      this.loaded.set(false);
      this.load$.next(id);
    });
  }

  protected reload(): void {
    this.load$.next(this.rentalId());
  }
}

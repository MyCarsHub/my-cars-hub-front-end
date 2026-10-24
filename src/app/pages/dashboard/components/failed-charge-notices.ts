import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { RentalService } from '../../rentals/rental.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import type { FailedChargeNoticeDto } from '../../../types/rental.types';

/** Quantos avisos o painel mostra antes de "ver todos". */
export const FAILED_NOTICES_COLLAPSED = 3;

/**
 * V118 — "Cobranças que precisam de você": as cobranças de aluguel que não foram criadas
 * no Asaas (ou precisam de link novo), com a frase pronta do backend e o "Gerar de novo"
 * ali mesmo. Só aparece para OWNER/MANAGER (o dashboard só a monta para o operador) e só
 * quando há pelo menos uma; o motorista nunca recebe estas cobranças antes de terem link.
 *
 * Mobile-first: uma coluna, alvos de 44px, a frase inteira (é ela que diz o que fazer).
 */
@Component({
  selector: 'app-failed-charge-notices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (visible().length > 0) {
      <section
        id="cobrancas-paradas"
        data-failed-charge-notices
        aria-label="Cobranças que precisam de você"
        class="mb-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 sm:p-4"
      >
        <h2 class="text-base font-semibold text-amber-900 dark:text-amber-100">
          Cobranças que precisam de você
        </h2>
        <ul class="mt-2 space-y-3">
          @for (n of visible(); track n.chargeId) {
            <li class="rounded-lg bg-white/70 dark:bg-white/5 p-3" data-failed-charge-notice>
              <p class="text-base text-amber-950 dark:text-amber-50 leading-snug">{{ n.message }}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-regenerate
                  (click)="regenerate(n)"
                  [disabled]="busy() !== null"
                  class="min-h-11 px-4 rounded-xl bg-amber-700 dark:bg-amber-400 text-white dark:text-amber-950 text-sm font-semibold disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                >
                  {{ busy() === n.chargeId ? 'Gerando…' : 'Gerar de novo' }}
                </button>
                <a
                  [routerLink]="['/alugueis', n.rentalId]"
                  class="min-h-11 px-4 inline-flex items-center rounded-xl border border-amber-300 dark:border-amber-500/40 text-sm font-medium text-amber-900 dark:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                >
                  Abrir aluguel
                </a>
              </div>
            </li>
          }
        </ul>
        @if (hidden() > 0) {
          <button
            type="button"
            (click)="expanded.set(true)"
            class="mt-2 min-h-11 px-1 text-sm font-medium underline text-amber-900 dark:text-amber-100"
          >
            Ver todas ({{ attention().length }})
          </button>
        }
      </section>
    }
  `,
})
export class FailedChargeNotices {
  private readonly http = inject(HttpClient);
  private readonly rentals = inject(RentalService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly notices = signal<FailedChargeNoticeDto[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly expanded = signal(false);

  /** Só as que pedem ação: transitória ainda em nova tentativa automática não é alarme. */
  protected readonly attention = computed(() => this.notices().filter((n) => n.needsAttention));
  protected readonly visible = computed(() =>
    this.expanded() ? this.attention() : this.attention().slice(0, FAILED_NOTICES_COLLAPSED),
  );
  protected readonly hidden = computed(() => this.attention().length - this.visible().length);

  constructor() {
    this.load();
  }

  private load(): void {
    this.http
      .get<FailedChargeNoticeDto[]>(`${environment.apiUrl}/charges/attention`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.notices.set(list ?? []),
        // Silencioso: o chip do dashboard já mostra a contagem; o detalhe do aluguel tem o resto.
        error: () => this.notices.set([]),
      });
  }

  protected regenerate(n: FailedChargeNoticeDto): void {
    if (this.busy()) return;
    this.busy.set(n.chargeId);
    this.rentals
      .retryCharge(n.rentalId, n.chargeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(null);
          this.notifications.push(
            'success',
            res.outcome === 'RETRIED'
              ? 'Cobrança gerada de novo. O motorista recebe o link novo.'
              : 'A cobrança mudou de situação. Confira o aluguel.',
          );
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(null);
          this.notifications.push(
            'error',
            this.apiErrors.messageFor(err, 'Não foi possível gerar a cobrança de novo. Tente novamente.'),
          );
          this.load();
        },
      });
  }
}

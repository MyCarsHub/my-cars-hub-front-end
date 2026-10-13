import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { HttpErrorResponse } from '@angular/common/http';

import { ApiErrorService } from '../../services/api-error.service';
import { ImpersonationService } from '../../services/impersonation.service';
import { NotificationService } from '../../services/notification.service';
import {
  isToastedBySupportEditInterceptor,
  supportEditLifecycleMessage,
} from '../../services/support-edit-errors';

const TICK_MS = 15_000;

/**
 * Barra VERMELHA do modo edição de suporte. Mesma altura fixa (56 px) da barra
 * âmbar de leitura, para o `app-shell` reservar o mesmo espaço; as duas nunca
 * aparecem juntas — o modo vem do servidor (`ImpersonationService.mode`).
 *
 * Sem botão de fechar: só "Encerrar" a faz sumir. Montada de forma preguiçosa
 * pelo `App` (`import()` + NgComponentOutlet), então não pesa no bundle inicial;
 * enquanto ela não renderiza, o `app.html` mostra uma barra mínima de reserva.
 */
@Component({
  selector: 'app-support-edit-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (impersonation.editMode() && impersonation.state(); as session) {
      <div
        role="alert"
        class="fixed inset-x-0 top-0 z-[100] flex h-14 items-center gap-2 border-b
               border-rose-900 bg-rose-700 px-3 text-white shadow-md sm:gap-3 sm:px-6"
      >
        <div class="min-w-0 flex-1 leading-tight">
          <p class="text-[11px] font-bold uppercase tracking-wide sm:text-xs">Modo edição</p>
          <p class="truncate text-xs sm:text-sm">
            <span class="font-semibold">{{ session.companyName }}</span>
            <span class="font-normal"> · {{ remainingLabel() }}</span>
          </p>
        </div>

        <button
          type="button"
          class="min-h-11 shrink-0 rounded-xl border border-white/70 px-3 py-2 text-xs
                 font-semibold text-white transition-colors hover:bg-rose-800 focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                 focus-visible:ring-offset-rose-700 disabled:opacity-60 sm:px-4 sm:text-sm"
          [disabled]="extending() || ending() || capReached()"
          (click)="extend()"
        >
          {{ extending() ? 'Estendendo…' : 'Extender' }}
          <span class="sr-only"> a sessão de edição de {{ session.companyName }}</span>
        </button>

        <button
          type="button"
          class="min-h-11 shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold
                 text-rose-800 transition-colors hover:bg-rose-50 focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                 focus-visible:ring-offset-rose-700 disabled:opacity-60 sm:px-4 sm:text-sm"
          [disabled]="ending()"
          (click)="stop()"
        >
          {{ ending() ? 'Encerrando…' : 'Encerrar' }}
          <span class="sr-only"> a sessão de edição de {{ session.companyName }}</span>
        </button>
      </div>
    }
  `,
})
export class SupportEditBanner implements OnInit {
  protected readonly impersonation = inject(ImpersonationService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ending = signal(false);
  protected readonly extending = signal(false);
  /** Relógio próprio: `remainingMs()` não é um sinal. */
  private readonly now = signal(Date.now());

  protected readonly remainingLabel = computed(() => {
    const session = this.impersonation.state();
    if (!session) return '';
    this.now();
    if (Number.isNaN(Date.parse(session.expiresAt))) return 'expira em instantes';
    const minutes = Math.ceil(this.impersonation.remainingMs(session) / 60_000);
    if (minutes <= 0) return 'expirando…';
    if (minutes === 1) return 'expira em 1 minuto';
    return `expira em ${minutes} minutos`;
  });

  /** O servidor recusa passar do teto absoluto; o botão já nasce desabilitado nesse caso. */
  protected readonly capReached = computed(() => {
    const session = this.impersonation.state();
    if (!session?.absoluteExpiresAt) return false;
    const cap = Date.parse(session.absoluteExpiresAt);
    const end = Date.parse(session.expiresAt);
    return !Number.isNaN(cap) && !Number.isNaN(end) && end >= cap;
  });

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    const handle = window.setInterval(() => this.now.set(Date.now()), TICK_MS);
    this.destroyRef.onDestroy(() => window.clearInterval(handle));
  }

  protected extend(): void {
    if (this.extending() || this.ending()) return;
    this.extending.set(true);
    this.impersonation.extendEdit().subscribe({
      next: () => {
        this.extending.set(false);
        this.notifications.success('Sessão de edição estendida.');
      },
      error: (err: unknown) => {
        this.extending.set(false);
        // Sessão que mudou/terminou no meio do voo (não é erro HTTP): o aviso de
        // expiração/encerramento já veio de outro caminho. E o interceptor já
        // avisou as recusas de edição.
        if (!(err instanceof HttpErrorResponse)) return;
        if (isToastedBySupportEditInterceptor(err)) return;
        this.notifications.warning(
          supportEditLifecycleMessage(err) ??
            this.apiErrors.messageFor(err, 'Não foi possível estender a sessão de edição.'),
        );
      },
    });
  }

  protected stop(): void {
    if (this.ending()) return;
    this.ending.set(true);
    this.impersonation.end().subscribe({
      next: () => this.ending.set(false),
      error: () => this.ending.set(false),
    });
  }
}

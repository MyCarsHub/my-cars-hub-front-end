import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { ImpersonationService } from '../../services/impersonation.service';

/** Altura fixa da barra, em px. O `app-shell` reserva exatamente isto (`pt-14`). */
export const IMPERSONATION_BANNER_HEIGHT_PX = 56;

const TICK_MS = 15_000;

/**
 * Barra de aviso da sessão de impersonação — requisito de segurança, não
 * decoração.
 *
 * Decisões que a mantêm impossível de ignorar:
 * - montada na raiz da aplicação, acima do `<router-outlet>`, logo aparece em
 *   QUALQUER rota enquanto a sessão durar;
 * - `position: fixed` no topo com `z-[100]` (acima do drawer da sidebar, que
 *   usa `z-50`), e o `app-shell` compensa a altura em vez de deixá-la cobrir
 *   conteúdo;
 * - sem botão de fechar. O único jeito de fazê-la sumir é encerrar a sessão;
 * - `role="alert"`: como o elemento só entra no DOM quando a sessão começa, o
 *   leitor de tela anuncia o aviso na hora.
 *
 * A contagem regressiva não é enfeite: torna visível que a janela é curta (15
 * minutos) e que o fim vai chegar sozinho.
 */
@Component({
  selector: 'app-impersonation-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (impersonation.state(); as session) {
      <div
        role="alert"
        class="fixed inset-x-0 top-0 z-[100] flex h-14 items-center gap-2 border-b
               border-amber-600 bg-amber-300 px-3 text-amber-950 shadow-md sm:gap-3 sm:px-6"
      >
        <svg
          class="hidden h-6 w-6 shrink-0 sm:block"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>

        <div class="min-w-0 flex-1 leading-tight">
          <p class="text-[11px] font-bold uppercase tracking-wide sm:text-xs">
            Modo somente leitura · vendo como empresa
          </p>
          <p class="truncate text-xs sm:text-sm">
            <span class="font-semibold">{{ session.companyName }}</span>
            <span class="font-normal"> · {{ remainingLabel() }}</span>
          </p>
        </div>

        <button
          type="button"
          class="min-h-11 shrink-0 rounded-xl bg-amber-950 px-3 py-2 text-xs font-semibold
                 text-amber-50 transition-colors hover:bg-amber-900 focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-amber-950 focus-visible:ring-offset-2
                 focus-visible:ring-offset-amber-300 disabled:opacity-60 sm:px-4 sm:text-sm"
          [disabled]="ending()"
          (click)="stop()"
        >
          {{ ending() ? 'Encerrando…' : 'Encerrar' }}
          <span class="sr-only">
            a sessão somente leitura de {{ session.companyName }} e voltar ao acesso de
            administrador
          </span>
        </button>
      </div>
    }
  `,
})
export class ImpersonationBanner implements OnInit {
  protected readonly impersonation = inject(ImpersonationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ending = signal(false);
  /** Relógio próprio: sinal só recalcula quando alguma dependência muda. */
  private readonly now = signal(Date.now());

  /**
   * O tempo restante vem de `ImpersonationService.remainingMs()`, que corrige o
   * desvio entre o relógio do servidor (dono de `expiresAt`) e o do cliente.
   * Calcular aqui com `Date.parse(expiresAt) - Date.now()` comparava duas
   * linhas do tempo diferentes: num cliente com relógio adiantado o banner
   * anunciava menos tempo do que existia, e num atrasado prometia mais.
   *
   * `this.now()` é lido só para reavaliar a cada tick — `remainingMs()` não é
   * um sinal do relógio.
   */
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

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    const handle = window.setInterval(() => this.now.set(Date.now()), TICK_MS);
    this.destroyRef.onDestroy(() => window.clearInterval(handle));
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

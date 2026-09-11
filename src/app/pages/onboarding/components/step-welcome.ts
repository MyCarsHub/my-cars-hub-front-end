import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Para onde o wizard navega depois do `/onboarding/finish`. */
export type WelcomeDestination = 'vehicle' | 'dashboard';

/**
 * Passo 4 — conclusão do onboarding e condutor da ativação (FIX-0271 +
 * FEAT-0080). Os "próximos passos" deixaram de ser texto morto: a ação
 * principal leva ao cadastro do primeiro veículo (espelha o padrão visual do
 * `quick-action-card`) e "Pular por enquanto" é a saída discreta para o
 * dashboard. Ambas passam pelo MESMO `finish` do container — o wizard sempre
 * conclui no backend antes de navegar.
 *
 * Verde de sucesso: `success-50/100` só como preenchimento e `success-700`
 * no ícone (contraste — nunca `success-500` atrás/na frente de texto).
 */
@Component({
  selector: 'app-step-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="py-2">
      <div class="flex flex-col items-center text-center mb-7">
        <div
          class="w-14 h-14 rounded-full bg-success-50 border border-success-100 flex items-center justify-center mb-4"
          aria-hidden="true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            stroke-linejoin="round" class="text-success-700">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h2 class="text-2xl font-bold text-gray-900 mb-2 focus:outline-none" tabindex="-1">
          Sua conta está pronta
        </h2>
        <p class="text-sm text-gray-600 leading-relaxed max-w-[38ch]">
          Falta um passo para o painel trabalhar para você: cadastrar o primeiro veículo da
          sua frota.
        </p>
      </div>

      <button
        type="button"
        class="group w-full flex items-center gap-3 p-4 rounded-xl border border-primary-300 bg-white
               text-left transition-all min-h-[64px]
               hover:border-primary-500 hover:shadow-sm
               focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
               focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        [disabled]="loading()"
        [attr.aria-busy]="loading()"
        (click)="finish.emit('vehicle')"
      >
        <span
          class="w-10 h-10 shrink-0 rounded-lg bg-primary-50 text-primary-500
                 flex items-center justify-center group-hover:bg-primary-100 transition-colors"
          aria-hidden="true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
            <circle cx="6.5" cy="16.5" r="2.5" />
            <circle cx="16.5" cy="16.5" r="2.5" />
          </svg>
        </span>
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-semibold text-gray-900">
            Cadastrar meu primeiro veículo
          </span>
          <span class="block text-xs text-gray-500">
            Destrava o painel, os alertas e as cobranças.
          </span>
        </span>
        @if (loading()) {
          <span
            class="w-5 h-5 shrink-0 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          ></span>
        } @else {
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true"
            class="shrink-0 text-gray-400 group-hover:text-primary-500 transition-colors">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        }
      </button>

      <div class="mt-4 text-center">
        <button
          type="button"
          class="min-h-11 px-3 py-2 text-sm font-medium text-gray-500 rounded-lg
                 hover:text-gray-800 hover:bg-gray-100 transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400
                 disabled:opacity-40 disabled:cursor-not-allowed"
          [disabled]="loading()"
          (click)="finish.emit('dashboard')"
        >
          Pular por enquanto
        </button>
      </div>
    </div>
  `,
})
export class StepWelcome {
  readonly isValid = output<boolean>();
  readonly finish = output<WelcomeDestination>();
  readonly loading = input<boolean>(false);

  ngOnInit(): void {
    // This step is always valid
    setTimeout(() => {
      this.isValid.emit(true);
    });
  }
}

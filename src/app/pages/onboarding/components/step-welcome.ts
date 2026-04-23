import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-step-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text-center py-6">
      <div class="inline-flex items-center justify-center w-20 h-20 bg-primary-50 rounded-full mb-6 text-4xl" aria-hidden="true">
        🎉
      </div>
      
      <h2 class="text-2xl font-bold text-gray-900 mb-3">Bem-vindo ao MyCarsHub!</h2>
      <p class="text-gray-600 leading-relaxed mb-8">
        Sua conta foi configurada com sucesso. Agora você já pode começar a gerenciar sua frota de forma inteligente e eficiente.
      </p>

      <div class="p-4 bg-gray-50 rounded-xl border border-gray-100 text-left mb-8">
        <p class="text-sm text-gray-600">
          <span class="font-bold text-primary-500">Próximos passos:</span><br>
          • Adicione seus primeiros veículos<br>
          • Cadastre seus motoristas<br>
          • Configure seus planos de manutenção
        </p>
      </div>

      <button type="button" 
        class="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-base font-semibold text-white transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        [class.bg-primary-500]="!loading()"
        [class.hover:bg-primary-600]="!loading()"
        [class.shadow-sm]="!loading()"
        [class.bg-gray-400]="loading()"
        [class.cursor-not-allowed]="loading()"
        [disabled]="loading()"
        [attr.aria-busy]="loading()"
        (click)="finish.emit()">
        {{ loading() ? 'Acessando...' : 'Acessar Plataforma' }}
        @if (!loading()) {
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        } @else {
          <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
        }
      </button>
    </div>
  `,
})
export class StepWelcome {
  readonly isValid = output<boolean>();
  readonly finish = output<void>();
  readonly loading = input<boolean>(false);

  ngOnInit(): void {
    // This step is always valid
    setTimeout(() => {
      this.isValid.emit(true);
    });
  }
}

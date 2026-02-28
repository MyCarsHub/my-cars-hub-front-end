import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AccountSetupStore } from '../account-setup.store';

@Component({
    selector: 'app-step-complete',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="flex flex-col items-center text-center py-4">
      <!-- Success icon -->
      <div class="w-16 h-16 bg-primary-500 rounded-2xl flex items-center justify-center mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
             fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/>
          <circle cx="6.5" cy="16.5" r="2.5"/>
          <circle cx="16.5" cy="16.5" r="2.5"/>
        </svg>
      </div>

      <h2 class="text-xl font-bold text-gray-900 mb-2">Bem-vindo ao MyCarsHub! 🎉</h2>
      <p class="text-sm text-gray-500 max-w-xs">
        Tudo pronto! Sua conta e organização
        "<strong class="text-gray-900">{{ store.formData().companyName || 'MyCarsHub' }}</strong>"
        foram configuradas. Comece a gerenciar sua frota agora.
      </p>
    </div>
  `,
})
export class StepComplete {
    protected readonly store = inject(AccountSetupStore);
    private readonly router = inject(Router);

    navigateToDashboard(): void {
        this.store.reset();
        this.router.navigate(['/dashboard']);
    }
}

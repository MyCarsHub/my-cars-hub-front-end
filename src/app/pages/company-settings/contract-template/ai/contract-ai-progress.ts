import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, output } from '@angular/core';
import { ContractAiService } from './contract-ai.service';

/**
 * Tela 2 — lendo o contrato. O polling vive no serviço, com backoff e limite; aqui ele é
 * (re)iniciado ao entrar e CANCELADO ao sair da tela.
 */
@Component({
  selector: 'app-contract-ai-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-4" role="status" aria-live="polite">
      @if (svc.pollTimedOut()) {
        <p class="text-sm text-neutral-700">
          A análise está demorando mais do que o normal. Você pode continuar esperando ou montar
          o contrato sozinho.
        </p>
        <button
          type="button"
          (click)="svc.startPolling()"
          class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm"
        >
          Continuar esperando
        </button>
      } @else {
        <div class="flex items-center gap-3">
          <span
            class="h-6 w-6 shrink-0 rounded-full border-4 border-primary-200 border-t-primary-500 animate-spin"
            aria-hidden="true"
          ></span>
          <p class="text-sm font-semibold text-neutral-900">Lendo o seu contrato…</p>
        </div>
        <ul class="text-sm text-neutral-600 space-y-1">
          <li>Arquivo recebido</li>
          <li>Procurando nomes, valores e datas</li>
          <li>Preparando a conferência</li>
        </ul>
        <p class="text-xs text-neutral-500">
          Pode levar até um minuto. Se recarregar a página, a análise continua de onde parou.
        </p>
      }
      <button
        type="button"
        (click)="leave.emit()"
        class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Cancelar e montar sozinho
      </button>
    </div>
  `,
})
export class ContractAiProgress implements OnInit {
  protected readonly svc = inject(ContractAiService);
  readonly leave = output<void>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.svc.stopPolling());
  }

  ngOnInit(): void {
    this.svc.startPolling();
  }
}

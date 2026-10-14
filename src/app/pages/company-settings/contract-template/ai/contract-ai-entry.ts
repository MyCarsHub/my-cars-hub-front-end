import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { ContractAiService } from './contract-ai.service';
import { LEGAL_DISCLAIMER } from './contract-ai.messages';
import { ContractAiIntro } from './contract-ai-intro';
import { ContractAiProgress } from './contract-ai-progress';
import { ContractAiConsent } from './contract-ai-consent';
import { ContractAiDoubts } from './contract-ai-doubts';
import { ContractAiPreview } from './contract-ai-preview';
import { ContractAiFields } from './contract-ai-fields';

/**
 * Ponto de entrada do fluxo de contrato com IA (FEAT-0304/0305/0337). Carregado sob demanda
 * pela página (`@defer`). Com a capacidade desligada (ou ainda desconhecida) NÃO renderiza
 * nada: a página fica exatamente como era.
 */
@Component({
  selector: 'app-contract-ai-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    ContractAiIntro,
    ContractAiConsent,
    ContractAiProgress,
    ContractAiDoubts,
    ContractAiPreview,
    ContractAiFields,
  ],
  template: `
    @if (svc.enabled()) {
      @if (collapsed()) {
        <button
          type="button"
          (click)="collapsed.set(false)"
          class="w-full min-h-[44px] rounded-xl border border-primary-200 bg-primary-50 px-4 text-sm font-semibold text-primary-700 hover:bg-primary-100"
        >
          Montar o contrato com ajuda da IA
        </button>
      } @else {
        <section
          class="rounded-xl border border-neutral-200 bg-white shadow-sm"
          aria-labelledby="contract-ai-title"
        >
          <header class="border-b border-neutral-100 px-4 py-3 sm:px-6">
            <h2 id="contract-ai-title" class="text-base font-bold text-neutral-900">
              Montar o contrato com a IA
            </h2>
          </header>
          <div class="p-4 sm:p-6 space-y-4">
            @if (svc.error(); as msg) {
              <p role="alert"
                class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {{ msg }}
              </p>
            }

            @switch (svc.step()) {
              @case ('intro') {
                <app-contract-ai-intro (manual)="collapsed.set(true)" />
              }
              @case ('consent') {
                <app-contract-ai-consent />
              }
              @case ('progress') {
                <app-contract-ai-progress (leave)="leave()" />
              }
              @case ('doubts') {
                <app-contract-ai-doubts />
              }
              @case ('preview') {
                <app-contract-ai-preview />
              }
              @case ('fields') {
                <app-contract-ai-fields />
              }
              @case ('failed') {
                <div class="space-y-3" role="alert">
                  <p class="text-sm text-neutral-800">{{ svc.failureText() }}</p>
                  <button type="button" (click)="svc.discard()" [disabled]="svc.busy()"
                    class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold disabled:opacity-60">
                    Enviar outro arquivo
                  </button>
                  <button type="button" (click)="leave()"
                    class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700">
                    Prefiro montar sozinho
                  </button>
                </div>
              }
              @case ('expired') {
                <div class="space-y-3" role="alert">
                  <p class="text-sm text-neutral-800">
                    Esta análise expirou. Envie o arquivo de novo para começar outra.
                  </p>
                  <button type="button" (click)="svc.clearDraft()"
                    class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold">
                    Enviar arquivo
                  </button>
                </div>
              }
              @case ('saved') {
                <div class="space-y-3" role="status">
                  <p class="text-sm font-semibold text-emerald-800">
                    Contrato salvo. Os próximos aluguéis já usam este template.
                  </p>
                  <button type="button" (click)="svc.acknowledgeSaved()"
                    class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700">
                    Entendi
                  </button>
                </div>
              }
            }

            <p class="text-xs text-neutral-500">{{ disclaimer }}</p>
          </div>
        </section>
      }
    }
  `,
})
export class ContractAiEntry implements OnInit {
  protected readonly svc = inject(ContractAiService);
  protected readonly disclaimer = LEGAL_DISCLAIMER;
  protected readonly collapsed = signal(false);

  /** A página recarrega o template atual quando o contrato é salvo. */
  readonly saved = output<void>();

  constructor() {
    effect(() => {
      if (this.svc.step() === 'saved') this.saved.emit();
    });
  }

  ngOnInit(): void {
    this.svc.init();
  }

  /** Sai do fluxo de IA e abandona o rascunho local; o caminho manual fica na página. */
  protected leave(): void {
    this.svc.clearDraft();
    this.collapsed.set(true);
  }
}

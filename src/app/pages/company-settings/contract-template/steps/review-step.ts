import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LEGAL_DISCLAIMER } from '../ai/contract-ai.messages';

/** Última etapa dos dois caminhos: contagem, aviso de substituição e aviso jurídico. */
@Component({
  selector: 'app-contract-review-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    <h3 class="m-0 text-lg font-semibold text-neutral-900">Confira e salve</h3>
    <p class="m-0 text-[15px] leading-relaxed text-neutral-700">
      Leia o contrato {{ where() }}. As partes
      <span class="rounded bg-emerald-100 px-1.5 py-px font-semibold text-emerald-800">em verde</span>
      são preenchidas sozinhas em cada aluguel.
    </p>
    <dl class="m-0 grid grid-cols-2 gap-3 rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3.5">
      <div class="flex flex-col gap-0.5">
        <dt class="text-[13px] font-semibold uppercase tracking-wide text-neutral-600">Campos</dt>
        <dd class="m-0 font-mono text-xl font-semibold text-neutral-900 tabular-nums">{{ fields() }}</dd>
      </div>
      <div class="flex flex-col gap-0.5">
        <dt class="text-[13px] font-semibold uppercase tracking-wide text-neutral-600">Cláusulas</dt>
        <dd class="m-0 font-mono text-xl font-semibold text-neutral-900 tabular-nums">{{ clauses() }}</dd>
      </div>
    </dl>
    @if (currentName(); as name) {
      <p class="m-0 text-sm leading-normal text-neutral-600">
        Ao salvar, este contrato substitui «{{ name }}» nos próximos aluguéis. Os contratos já gerados não mudam.
      </p>
    }
    <p class="m-0 text-[13px] leading-normal text-neutral-600">{{ disclaimer }}</p>
  `,
})
export class ContractReviewStep {
  readonly fields = input(0);
  readonly clauses = input(0);
  readonly currentName = input<string | null>(null);
  readonly where = input('ao lado');
  protected readonly disclaimer = LEGAL_DISCLAIMER;
}

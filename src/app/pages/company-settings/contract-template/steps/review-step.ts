import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LEGAL_DISCLAIMER } from '../ai/contract-ai.messages';
import { ContractIcon } from '../contract-icon';

/** Última etapa dos dois caminhos: contagem, aviso de substituição e aviso jurídico. */
@Component({
  selector: 'app-contract-review-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5' },
  imports: [ContractIcon],
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-neutral-900 focus:outline-none">
        Tudo pronto! Confira e salve
      </h3>
      <p class="m-0 text-[15px] leading-relaxed text-neutral-700">
        Leia o contrato {{ where() }}. As partes
        <span class="rounded-[3px] border-b-2 border-emerald-500 bg-emerald-100 px-1 font-semibold text-emerald-900">em verde</span>
        são preenchidas sozinhas em cada aluguel.
      </p>
    </div>
    <dl class="m-0 grid grid-cols-2 gap-2.5">
      <div class="flex flex-col gap-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
        <dt class="order-2 text-[13px] font-medium leading-snug text-emerald-900">{{ fields() === 1 ? 'dado preenchido sozinho' : 'dados preenchidos sozinhos' }}</dt>
        <dd class="order-1 m-0 flex items-center gap-2 text-[28px] font-bold leading-none text-emerald-800 tabular-nums">
          <app-contract-icon name="sparkles" [size]="20" />{{ fields() }}
        </dd>
      </div>
      <div class="flex flex-col gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3.5">
        <dt class="order-2 text-[13px] font-medium leading-snug text-neutral-700">{{ clauses() === 1 ? 'cláusula' : 'cláusulas' }}</dt>
        <dd class="order-1 m-0 flex items-center gap-2 text-[28px] font-bold leading-none text-neutral-900 tabular-nums">
          <app-contract-icon name="listChecks" [size]="20" class="text-neutral-600" />{{ clauses() }}
        </dd>
      </div>
    </dl>
    <div class="flex flex-col gap-2">
      <span class="text-[13px] font-semibold uppercase tracking-wide text-neutral-600">Ao salvar</span>
      <ul class="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-snug text-neutral-800">
        @if (currentName(); as name) {
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="refresh" [size]="18" class="mt-px text-neutral-600" />
            <span class="min-w-0 [overflow-wrap:anywhere]">Este contrato substitui «{{ name }}» nos próximos aluguéis.</span>
          </li>
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="shield" [size]="18" class="mt-px text-emerald-700" />
            <span>Os contratos já gerados não mudam.</span>
          </li>
        } @else {
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="checkCircle" [size]="18" class="mt-px text-emerald-700" />
            <span>Os próximos aluguéis já saem com este contrato, preenchido sozinho.</span>
          </li>
        }
      </ul>
    </div>
    <p class="m-0 flex items-start gap-2.5 rounded-xl bg-sky-50 px-3.5 py-3 text-[13px] leading-normal text-sky-900">
      <app-contract-icon name="info" [size]="16" class="mt-px text-sky-700" />
      <span>{{ disclaimer }}</span>
    </p>
  `,
})
export class ContractReviewStep {
  readonly fields = input(0);
  readonly clauses = input(0);
  readonly currentName = input<string | null>(null);
  readonly where = input('ao lado');
  protected readonly disclaimer = LEGAL_DISCLAIMER;
}

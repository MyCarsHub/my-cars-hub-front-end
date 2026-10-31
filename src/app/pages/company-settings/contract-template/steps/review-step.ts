import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LEGAL_DISCLAIMER } from '../ai/contract-ai.messages';
import { FieldOption } from '../ai/contract-ai.types';
import { ContractExistingFields } from '../contract-existing-fields';
import { ContractIcon } from '../contract-icon';

/** Última etapa dos dois caminhos: contagem, aviso de substituição e aviso jurídico. */
@Component({
  selector: 'app-contract-review-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5' },
  imports: [ContractIcon, ContractExistingFields],
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-fg focus:outline-none">
        Tudo pronto! Confira e salve
      </h3>
      <p class="m-0 text-[15px] leading-relaxed text-fg-soft">
        Leia o contrato {{ where() }}. As partes
        <span class="rounded-[3px] border-b-2 border-emerald-500 bg-emerald-100 dark:bg-emerald-500/15 px-1 font-semibold text-emerald-900 dark:text-emerald-200">em verde</span>
        são preenchidas sozinhas em cada aluguel.
      </p>
    </div>
    <dl class="m-0 grid grid-cols-2 gap-2.5">
      <div class="flex flex-col gap-1 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3.5">
        <dt class="order-2 text-[13px] font-medium leading-snug text-emerald-900 dark:text-emerald-200">{{ fields() === 1 ? 'dado preenchido sozinho' : 'dados preenchidos sozinhos' }}</dt>
        <dd class="order-1 m-0 flex items-center gap-2 text-[28px] font-bold leading-none text-emerald-800 dark:text-emerald-200 tabular-nums">
          <app-contract-icon name="sparkles" [size]="20" />{{ fields() }}
        </dd>
      </div>
      <div class="flex flex-col gap-1 rounded-2xl border border-edge bg-surface-muted px-4 py-3.5">
        <dt class="order-2 text-[13px] font-medium leading-snug text-fg-soft">{{ clauses() === 1 ? 'cláusula' : 'cláusulas' }}</dt>
        <dd class="order-1 m-0 flex items-center gap-2 text-[28px] font-bold leading-none text-fg tabular-nums">
          <app-contract-icon name="listChecks" [size]="20" class="text-fg-muted" />{{ clauses() }}
        </dd>
      </div>
    </dl>
    <app-contract-existing-fields [fields]="existing()" />
    @if (unanswered().length > 0) {
      <section data-unanswered aria-labelledby="contract-unanswered-title"
        class="flex flex-col gap-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3.5 text-amber-950 dark:text-amber-100">
        <h4 id="contract-unanswered-title" class="m-0 text-[15px] font-semibold leading-snug">
          {{ unanswered().length === 1 ? '1 pergunta sem resposta' : unanswered().length + ' perguntas sem resposta' }}
        </h4>
        <p class="m-0 text-[13px] leading-snug">
          {{ unanswered().length === 1 ? 'Este dado fica' : 'Estes dados ficam' }} igual em todos os aluguéis.
          Para responder, volte às perguntas.
        </p>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          @for (u of unanswered(); track u.id) {
            <li class="flex min-w-0 flex-col gap-0.5 text-[13px] leading-snug">
              <span class="font-semibold [overflow-wrap:anywhere]">{{ u.value }}</span>
              <span class="[overflow-wrap:anywhere]">{{ u.where }}</span>
            </li>
          }
        </ul>
      </section>
    }
    @if (driverMissing()) {
      <p class="m-0 flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3.5 py-3 text-[13px] leading-normal text-amber-950 dark:text-amber-100">
        <app-contract-icon name="info" [size]="16" class="mt-px" />
        <span>Este contrato vai sair sem o nome e o CPF do motorista de cada aluguel.</span>
      </p>
    }
    <div class="flex flex-col gap-2">
      <span class="text-[13px] font-semibold uppercase tracking-wide text-fg-muted">Ao salvar</span>
      <ul class="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-snug text-fg-body">
        @if (currentName(); as name) {
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="refresh" [size]="18" class="mt-px text-fg-muted" />
            <span class="min-w-0 [overflow-wrap:anywhere]">Este contrato substitui «{{ name }}» nos próximos aluguéis.</span>
          </li>
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="shield" [size]="18" class="mt-px text-emerald-700 dark:text-emerald-300" />
            <span>Os contratos já gerados não mudam.</span>
          </li>
        } @else {
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="checkCircle" [size]="18" class="mt-px text-emerald-700 dark:text-emerald-300" />
            <span>Os próximos aluguéis já saem com este contrato, preenchido sozinho.</span>
          </li>
        }
      </ul>
    </div>
    <p class="m-0 flex items-start gap-2.5 rounded-xl bg-sky-50 dark:bg-sky-500/10 px-3.5 py-3 text-[13px] leading-normal text-sky-900 dark:text-sky-200">
      <app-contract-icon name="info" [size]="16" class="mt-px text-sky-700 dark:text-sky-300" />
      <span>{{ disclaimer }}</span>
    </p>
  `,
})
export class ContractReviewStep {
  readonly fields = input(0);
  readonly clauses = input(0);
  /** O que o contrato enviado já trazia: sem perguntas, aqui é o único lugar que mostra. */
  readonly existing = input<readonly FieldOption[]>([]);
  /** Perguntas sem resposta: o dado fica fixo. Texto já mascarado e legível. */
  readonly unanswered = input<readonly { id: string; value: string; where: string }[]>([]);
  /** Nenhum campo identifica o motorista: todo aluguel sairia sem dizer quem é. */
  readonly driverMissing = input(false);
  readonly currentName = input<string | null>(null);
  readonly where = input('ao lado');
  protected readonly disclaimer = LEGAL_DISCLAIMER;
}

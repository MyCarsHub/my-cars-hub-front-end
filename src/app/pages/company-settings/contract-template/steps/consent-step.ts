import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * «Ajustar o meu contrato», etapa 2: as três frases sobre privacidade e a autorização. O
 * texto exato que a IA lê (já mascarado) está no contrato ao vivo, ao lado/abaixo.
 */
@Component({
  selector: 'app-contract-consent-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    <h3 class="m-0 text-lg font-semibold text-neutral-900">A IA vai ler o seu contrato</h3>
    <p class="m-0 text-[15px] leading-relaxed text-neutral-700">
      Ela procura o que muda em cada aluguel, como o nome do motorista, a placa e os valores.
    </p>
    <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
      <li class="flex items-start gap-2.5 text-[15px] leading-normal text-neutral-800">
        <svg class="mt-0.5 shrink-0 text-emerald-700" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        <span>Nome, CPF, CNH, placa e endereços ficam escondidos. No contrato eles aparecem em cinza.</span>
      </li>
      <li class="flex items-start gap-2.5 text-[15px] leading-normal text-neutral-800">
        <svg class="mt-0.5 shrink-0 text-neutral-600" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
        <span>Valores, datas e o modelo do carro aparecem como estão.</span>
      </li>
      <li class="flex items-start gap-2.5 text-[15px] leading-normal text-neutral-800">
        <svg class="mt-0.5 shrink-0 text-emerald-700" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        <span>Nada muda no seu contrato até você salvar.</span>
      </li>
    </ul>
    @if (notMasked().length > 0) {
      <p class="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-normal text-amber-900">
        Não conseguimos esconder: {{ notMasked().join(', ') }}. Confira o texto antes de autorizar.
      </p>
    }
    <label
      class="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 focus-within:ring-2 focus-within:ring-primary-400"
      [class]="agreed() ? 'border-primary-200 bg-primary-50' : 'border-neutral-200 bg-white'"
    >
      <input
        type="checkbox"
        class="mt-0.5 h-[22px] w-[22px] shrink-0 accent-primary-600"
        [checked]="agreed()"
        [disabled]="disabled()"
        (change)="agreedChange.emit($any($event.target).checked)"
      />
      <span class="text-base leading-normal text-neutral-900">
        Vi o texto {{ where() }} e autorizo a IA a ler o meu contrato.
      </span>
    </label>
  `,
})
export class ContractConsentStep {
  readonly agreed = input(false);
  /** Enquanto o texto mascarado não chegou, não há o que autorizar. */
  readonly disabled = input(false);
  readonly where = input('ao lado');
  /** Rótulos do que o backend avisou que NÃO conseguiu mascarar. */
  readonly notMasked = input<readonly string[]>([]);
  readonly agreedChange = output<boolean>();
}

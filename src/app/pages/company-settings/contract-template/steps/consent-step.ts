import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ContractIcon, ContractIconName } from '../contract-icon';

/**
 * «Ajustar o meu contrato», etapa 2: as três frases sobre privacidade e a autorização. O
 * texto exato que a IA lê (já mascarado) está no contrato ao vivo, ao lado/abaixo.
 */
@Component({
  selector: 'app-contract-consent-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  imports: [ContractIcon],
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-neutral-900 focus:outline-none">
        A IA vai ler o seu contrato
      </h3>
      <p class="m-0 text-[15px] leading-relaxed text-neutral-600">
        Ela procura o que muda em cada aluguel, como o nome do motorista, a placa e os valores.
      </p>
    </div>
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      @for (row of rows; track row.text) {
        <li class="flex items-start gap-3 rounded-xl bg-neutral-50 px-3.5 py-3 text-[15px] leading-normal text-neutral-800">
          <span aria-hidden="true" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" [class]="row.tile">
            <app-contract-icon [name]="row.icon" [size]="18" />
          </span>
          <span class="pt-1">{{ row.text }}</span>
        </li>
      }
    </ul>
    @if (notMasked().length > 0) {
      <p class="m-0 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[15px] leading-normal text-amber-900">
        <app-contract-icon name="alert" [size]="18" class="mt-0.5 text-amber-700" />
        <span>Não conseguimos esconder: {{ notMasked().join(', ') }}. Confira o texto antes de autorizar.</span>
      </p>
    }
    <label
      class="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-4 transition-colors focus-within:ring-2 focus-within:ring-primary-400"
      [class]="agreed() ? 'border-emerald-500 bg-emerald-50' : disabled() ? 'border-neutral-200 bg-neutral-50 cursor-wait' : 'border-neutral-300 bg-white hover:border-neutral-400'"
    >
      <input
        type="checkbox"
        class="mt-0.5 h-6 w-6 shrink-0 accent-emerald-700"
        [checked]="agreed()"
        [disabled]="disabled()"
        (change)="agreedChange.emit($any($event.target).checked)"
      />
      <span class="flex flex-col gap-0.5">
        <span class="text-base font-semibold leading-normal text-neutral-900">
          Vi o texto {{ where() }} e autorizo a IA a ler o meu contrato.
        </span>
        @if (disabled()) {
          <span class="text-[13px] text-neutral-600">Preparando o texto que a IA vai ler…</span>
        }
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

  protected readonly rows: readonly { icon: ContractIconName; tile: string; text: string }[] = [
    {
      icon: 'eyeOff',
      tile: 'bg-emerald-100 text-emerald-800',
      text: 'Nome, CPF, CNH, placa e endereços ficam escondidos. No contrato eles aparecem em cinza.',
    },
    {
      icon: 'eye',
      tile: 'bg-white text-neutral-700 ring-1 ring-neutral-200',
      text: 'Valores, datas e o modelo do carro aparecem como estão.',
    },
    {
      icon: 'shield',
      tile: 'bg-emerald-100 text-emerald-800',
      text: 'Nada muda no seu contrato até você salvar.',
    },
  ];
}

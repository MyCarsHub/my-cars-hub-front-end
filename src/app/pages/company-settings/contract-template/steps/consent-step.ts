import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ContractIcon, ContractIconName } from '../contract-icon';
import { AI_SEND_NOTICE } from '../ai/contract-ai.messages';
import { AiProviderView } from '../ai/contract-ai.types';

/**
 * «Ajustar o meu contrato», etapa 2: o consentimento v2 (provedor, país, o que vai escondido e o
 * que vai em claro) e a autorização. O texto exato que a IA lê (já mascarado) está no contrato
 * ao vivo, ao lado/abaixo. As frases vêm de AI_SEND_NOTICE, o mesmo texto da seção 6 da Política.
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
      <p class="m-0 text-[15px] leading-relaxed text-neutral-600">{{ notice.sent }}</p>
      <p class="m-0 text-[15px] leading-relaxed text-neutral-600">{{ notice.transfer }}</p>
    </div>
    @if (reason()) {
      <p role="alert" class="m-0 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[15px] leading-normal text-amber-900">
        <app-contract-icon name="alert" [size]="18" class="mt-0.5 text-amber-700" />
        <span>{{ reason() }}</span>
      </p>
    }
    @if (providers().length > 0) {
      <div data-ai-route class="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
        <span class="text-[13px] font-semibold uppercase tracking-wide text-neutral-500">Quem recebe o texto</span>
        @for (p of providers(); track p.provider) {
          <span class="text-[15px] leading-normal text-neutral-800">
            <span class="font-semibold">{{ p.label }}</span>
            <span class="break-words text-neutral-600"> · {{ modelsText(p.models) }}</span>
          </span>
        }
      </div>
    }
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
    <a
      [href]="notice.policyHref"
      target="_blank"
      rel="noopener"
      class="inline-flex min-h-[44px] items-center text-[15px] font-medium text-primary-700 underline"
      >{{ notice.policyLabel }}</a
    >
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
          Li o texto {{ where() }} e as informações acima e autorizo o envio deste texto à {{ recipients() }},
          nos Estados Unidos, para análise.
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
  /** Provedores e modelos da rota que o servidor vai usar (o aceite vale só para eles). */
  readonly providers = input<readonly AiProviderView[]>([]);
  /** Por que a autorização foi pedida de novo (ex.: o provedor mudou); null = primeira vez. */
  readonly reason = input<string | null>(null);
  readonly agreedChange = output<boolean>();

  /** Nomes dos provedores na frase da autorização; sem rota ainda, o do texto v2. */
  protected readonly recipients = computed(() => {
    const names = this.providers().map((p) => p.label);
    return names.length > 0 ? names.join(' e ') : 'Anthropic';
  });

  protected modelsText(models: readonly string[]): string {
    const label = models.length > 1 ? 'modelos' : 'modelo';
    return `${label} ${models.join(' e ')}`;
  }

  protected readonly notice = AI_SEND_NOTICE;

  protected readonly rows: readonly { icon: ContractIconName; tile: string; text: string }[] = [
    {
      icon: 'eyeOff',
      tile: 'bg-emerald-100 text-emerald-800',
      text: AI_SEND_NOTICE.masked,
    },
    {
      icon: 'eye',
      tile: 'bg-white text-neutral-700 ring-1 ring-neutral-200',
      text: AI_SEND_NOTICE.inClear,
    },
    {
      icon: 'shield',
      tile: 'bg-emerald-100 text-emerald-800',
      text: 'Nada muda no seu contrato até você salvar.',
    },
  ];
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Contagem em laranja sólido, no segmento e nas linhas. Zero não mostra nada: quem usa
 * decide com `@if`, porque um zero aqui seria um aviso de que não há o que avisar.
 */
@Component({
  selector: 'app-count-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'inline-grid place-items-center min-w-6 h-6 px-[7px] rounded-full bg-primary-500 ' +
      'text-white text-[13px] font-bold tabular-nums flex-none',
    '[attr.aria-label]': 'label()',
  },
  template: `{{ count() }}`,
})
export class CountBadge {
  readonly count = input.required<number>();
  /** O que o número conta, para o leitor de tela: "7 pendências". */
  readonly label = input<string | null>(null);
}

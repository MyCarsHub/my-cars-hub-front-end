import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ContractIconName = 'file' | 'fileUp' | 'check';

/**
 * Ícones de traço da página de contrato (traço 2, currentColor, sempre decorativos), no
 * mesmo molde do `MembersIcon`: o app não tem um set global, cada área tem o seu com os
 * desenhos Lucide que já usa. `file` é o mesmo documento do cartão «Contrato atual».
 */
@Component({
  selector: 'app-contract-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" [attr.width]="size()" [attr.height]="size()"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="stroke()"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('file') {
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        }
        @case ('fileUp') {
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />
        }
        @case ('check') {
          <polyline points="20 6 9 17 4 12" />
        }
      }
    </svg>
  `,
})
export class ContractIcon {
  readonly name = input.required<ContractIconName>();
  readonly size = input(20);
  readonly stroke = input(2);
}

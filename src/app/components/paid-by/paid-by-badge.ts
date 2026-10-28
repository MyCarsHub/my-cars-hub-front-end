import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ExpensePaidBy } from '../../types/expense-paid-by.types';

/**
 * Selo "Pago pelo motorista" (V123). Só aparece quando o motorista pagou —
 * Locadora é o normal e não ganha selo, senão toda linha da lista teria um.
 */
@Component({
  selector: 'app-paid-by-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (paidBy() === 'DRIVER') {
      <span
        class="inline-flex items-center rounded-full font-semibold bg-surface-sunken text-fg-soft ring-1 ring-inset ring-edge"
        [class]="size() === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'"
      >Pago pelo motorista</span>
    }
  `,
})
export class PaidByBadge {
  readonly paidBy = input<ExpensePaidBy | null | undefined>(null);
  /** `sm` nas listas, `md` no detalhe — casa com os chips vizinhos. */
  readonly size = input<'sm' | 'md'>('sm');
}

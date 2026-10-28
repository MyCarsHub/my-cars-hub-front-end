import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EXPENSE_PAID_BY_BADGES, ExpensePaidBy } from '../../types/expense-paid-by.types';

/**
 * Selo "Pago pelo motorista" / "Pago pelo dono" (V123). Só aparece quando não foi a locadora —
 * Locadora é o normal e não ganha selo, senão toda linha da lista teria um.
 */
@Component({
  selector: 'app-paid-by-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (label(); as text) {
      <span
        class="inline-flex items-center rounded-full font-semibold bg-surface-sunken text-fg-soft ring-1 ring-inset ring-edge"
        [class]="size() === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'"
      >{{ text }}</span>
    }
  `,
})
export class PaidByBadge {
  readonly paidBy = input<ExpensePaidBy | null | undefined>(null);
  /** `sm` nas listas, `md` no detalhe — casa com os chips vizinhos. */
  readonly size = input<'sm' | 'md'>('sm');

  protected readonly label = computed(() => {
    const value = this.paidBy();
    return value ? (EXPENSE_PAID_BY_BADGES[value] ?? null) : null;
  });
}

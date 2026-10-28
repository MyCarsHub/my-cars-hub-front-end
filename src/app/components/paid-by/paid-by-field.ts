import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { map, startWith, switchMap } from 'rxjs';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../segmented-toggle/segmented-toggle';
import {
  EXPENSE_PAID_BY_LABELS,
  ExpensePaidBy,
  paidByOrDefault,
} from '../../types/expense-paid-by.types';

/**
 * Pill marcado: superfície clara sobre o trilho sunken, texto escuro. Fundo e
 * sombra vão por `style` porque o `SegmentedToggle` escreve os dois inline —
 * mesmo acento do seletor de ordenação do roadmap, com tokens que já trocam no
 * tema escuro. O laranja da marca fica de fora de propósito: isto é uma
 * marcação neutra, não uma ação primária.
 */
const ACTIVE_BACKGROUND = 'var(--color-surface)';
const ACTIVE_SHADOW = '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';

const OPTIONS: readonly SegmentedToggleOption<ExpensePaidBy>[] = (
  ['COMPANY', 'DRIVER'] as const
).map((value) => ({
  value,
  label: EXPENSE_PAID_BY_LABELS[value],
  activeBackground: ACTIVE_BACKGROUND,
  activeShadow: ACTIVE_SHADOW,
}));

let nextId = 0;

/**
 * "Quem pagou? Locadora | Motorista" — a marcação de manutenção, sinistro e
 * multa (V123). Escreve direto no `FormControl` recebido.
 *
 * `text-base` nas opções: 16px é o piso para o iOS não dar zoom no foco.
 */
@Component({
  selector: 'app-paid-by-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SegmentedToggle],
  host: { class: 'block' },
  template: `
    <p class="block text-sm font-medium text-fg-soft mb-1.5" [id]="labelId">Quem pagou?</p>
    <app-segmented-toggle
      class="w-full sm:w-auto"
      [options]="options"
      [value]="value()"
      [ariaLabelledby]="labelId"
      activeClass="text-fg"
      textClass="text-base"
      (selectionChange)="select($event)"
    />
    <p class="text-xs text-fg-muted mt-1">{{ hint() }}</p>
  `,
})
export class PaidByField {
  readonly control = input.required<FormControl<ExpensePaidBy>>();

  protected readonly options = OPTIONS;
  protected readonly labelId = `paid-by-label-${++nextId}`;

  protected readonly value = toSignal(
    toObservable(this.control).pipe(
      switchMap((c) => c.valueChanges.pipe(startWith(c.value))),
      map((v) => paidByOrDefault(v)),
    ),
    { initialValue: 'COMPANY' as ExpensePaidBy },
  );

  protected readonly hint = computed(() =>
    this.value() === 'DRIVER'
      ? 'Pago pelo motorista: não é descontado do faturamento da locadora.'
      : 'Pago pela locadora: entra como despesa no faturamento.',
  );

  protected select(next: ExpensePaidBy): void {
    const control = this.control();
    if (control.value === next) return;
    control.setValue(next);
    control.markAsDirty();
    control.markAsTouched();
  }
}

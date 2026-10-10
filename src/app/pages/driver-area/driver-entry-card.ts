import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formatBRL, formatDate } from '../../types/dashboard.types';
import { LedgerEntry } from '../../types/driver-ledger.types';
import { LEDGER_KIND_LABELS, categoryLabel } from '../../utils/driver-ledger';

/**
 * One ledger entry as a mobile card: what it was, when, how much — and the two things a
 * driver does to an entry, as real text buttons (44px) rather than a kebab he has to find.
 *
 * The sign of the amount carries the meaning, not only the colour: "+" for income and "−"
 * (a true minus, U+2212) for expense, plus a visually hidden "Ganho de" / "Custo de" so a
 * screen reader does not read a bare number.
 */
@Component({
  selector: 'app-driver-entry-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <article class="rounded-2xl bg-white border border-gray-200 p-4 min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-neutral-900 truncate">{{ label() }}</p>
          @if (entry().description; as note) {
            <p class="text-sm text-neutral-600 mt-0.5 break-words">{{ note }}</p>
          }
          <p class="text-xs text-neutral-600 mt-1 tabular-nums">{{ date() }}</p>
        </div>
        <p
          class="shrink-0 text-lg font-semibold tabular-nums"
          [class.text-emerald-700]="entry().kind === 'INCOME'"
          [class.text-primary-700]="entry().kind === 'EXPENSE'"
        >
          <span class="sr-only">{{ kindLabel() }} de </span>{{ signedAmount() }}
        </p>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          data-entry-edit
          (click)="edit.emit(entry())"
          [attr.aria-label]="'Editar ' + summary()"
          class="min-h-11 px-4 rounded-xl text-sm font-medium text-neutral-700 bg-neutral-100
                 hover:bg-neutral-200 focus:outline-none focus-visible:ring-2
                 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
        >
          Editar
        </button>
        <button
          type="button"
          data-entry-remove
          (click)="remove.emit(entry())"
          [attr.aria-label]="'Excluir ' + summary()"
          class="min-h-11 px-4 rounded-xl text-sm font-medium text-rose-700 hover:bg-rose-50
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500
                 focus-visible:ring-offset-1"
        >
          Excluir
        </button>
      </div>
    </article>
  `,
})
export class DriverEntryCard {
  readonly entry = input.required<LedgerEntry>();
  readonly edit = output<LedgerEntry>();
  readonly remove = output<LedgerEntry>();

  protected readonly label = computed(() => categoryLabel(this.entry().category));
  protected readonly kindLabel = computed(() => LEDGER_KIND_LABELS[this.entry().kind]);
  protected readonly date = computed(() => formatDate(this.entry().occurredOn));
  protected readonly signedAmount = computed(() => {
    const e = this.entry();
    return `${e.kind === 'INCOME' ? '+' : '−'} ${formatBRL(e.amountCents)}`;
  });
  /** "ganho Corridas de 12/10/2026" — what the button acts on, for assistive tech. */
  protected readonly summary = computed(
    () => `${this.kindLabel().toLowerCase()} ${this.label()} de ${this.date()}`,
  );
}

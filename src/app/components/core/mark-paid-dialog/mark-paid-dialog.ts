import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

/**
 * Reusable "mark as paid" dialog with a date picker + amount readout.
 * Not a variant of {@link ConfirmDialog} because that one is text-only —
 * this one has a real form control.
 */
@Component({
  selector: 'app-mark-paid-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mark-paid-dialog.html',
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0 })),
      ]),
    ]),
    trigger('dialog', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        animate(
          '200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        ),
      ]),
    ]),
  ],
})
export class MarkPaidDialog {
  open = input.required<boolean>();
  title = input<string>('Marcar como paga');
  amountCents = input<number>(0);
  entityLabel = input<string>('');

  /** Optional lower bound (yyyy-MM-dd). Undefined = no min. */
  minDate = input<string | undefined>(undefined);
  /** Optional upper bound (yyyy-MM-dd). Defaults to today. */
  maxDate = input<string | undefined>(undefined);
  /** Optional default value (yyyy-MM-dd). Defaults to today. */
  defaultDate = input<string | undefined>(undefined);

  busy = input<boolean>(false);

  confirmed = output<string>();
  cancelled = output<void>();

  private readonly _today = todayIso();
  protected readonly selectedDate = signal<string>(this._today);

  protected readonly effectiveMax = computed(() => this.maxDate() ?? this._today);
  protected readonly effectiveMin = computed(() => this.minDate() ?? '');
  protected readonly formattedAmount = computed(() => formatBRL(this.amountCents()));

  constructor() {
    // Reset the picker every time the dialog re-opens so the user always starts
    // from `defaultDate` (or today), not from whatever they typed last time.
    effect(() => {
      if (this.open()) {
        this.selectedDate.set(this.defaultDate() ?? this._today);
      }
    });
  }

  protected onDateInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.selectedDate.set(value);
  }

  protected onConfirm(): void {
    if (this.busy()) return;
    const value = this.selectedDate();
    if (!value) return;
    // Clamp against max (browser natives sometimes let you type past max).
    const max = this.effectiveMax();
    const min = this.effectiveMin();
    let clamped = value;
    if (max && clamped > max) clamped = max;
    if (min && clamped < min) clamped = min;
    this.confirmed.emit(clamped);
  }

  protected onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }

  protected onEscape(event: Event): void {
    if (!this.open() || this.busy()) return;
    event.preventDefault();
    this.cancelled.emit();
  }

  protected onBackdrop(): void {
    this.onCancel();
  }
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((cents ?? 0) / 100);
}

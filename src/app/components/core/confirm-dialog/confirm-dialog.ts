import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-dialog.html',
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
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' })),
      ]),
      transition(':leave', [
        animate('150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' })),
      ]),
    ]),
  ],
})
export class ConfirmDialog {
  /** Controls visibility */
  open = input.required<boolean>();

  /** Dialog title */
  title = input<string>('Confirmar ação');

  /** Dialog body message */
  message = input<string>('Tem certeza que deseja continuar?');

  /** Label for the confirm button */
  confirmLabel = input<string>('Confirmar');

  /** Label for the cancel button */
  cancelLabel = input<string>('Cancelar');

  /**
   * Visual variant:
   * - 'info'    → blue (default)
   * - 'warning' → amber
   * - 'danger'  → red
   */
  variant = input<'info' | 'warning' | 'danger'>('info');

  /** Emitted when the user clicks the confirm button */
  confirmed = output<void>();

  /** Emitted when the user clicks cancel or the backdrop */
  cancelled = output<void>();

  protected iconBgClass(): string {
    const map: Record<string, string> = {
      info: 'bg-primary-50',
      warning: 'bg-amber-50',
      danger: 'bg-red-50',
    };
    return map[this.variant()] ?? 'bg-primary-50';
  }

  protected confirmBtnClass(): string {
    const map: Record<string, string> = {
      info: 'bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-400',
      warning: 'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-400',
      danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-400',
    };
    return map[this.variant()] ?? map['info'];
  }

  protected onConfirm(): void {
    this.confirmed.emit();
  }

  protected onCancel(): void {
    this.cancelled.emit();
  }
}

import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
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

  /**
   * Label for the confirm button. An empty string drops the button — for the
   * informational variant where there is nothing to confirm (e.g. a blocking
   * notice that only offers the way back through the cancel button).
   */
  confirmLabel = input<string>('Confirmar');

  /**
   * Label for the cancel button. An empty string drops the button entirely —
   * for the acknowledgement-only dialog, where confirming and cancelling do the
   * same thing and two differently-labelled buttons would lie about that. The
   * backdrop still emits `cancelled`, so the dialog is never a trap.
   */
  cancelLabel = input<string>('Cancelar');

  /**
   * Visual variant:
   * - 'info'    → blue (default)
   * - 'warning' → amber
   * - 'danger'  → red
   */
  variant = input<'info' | 'warning' | 'danger'>('info');

  /**
   * Opt-in checkbox (opcional). Só é renderizado quando `optionLabel` tem
   * conteúdo — os callers que não passam nada seguem com o dialog original.
   * Estado é do pai: `[(optionChecked)]` ou input + `(optionCheckedChange)`.
   */
  optionLabel = input<string>('');

  /** Linha de apoio abaixo do label do checkbox (opcional). */
  optionHint = input<string>('');

  /** Estado do checkbox opcional. Nunca deve vir pré-marcado em ação destrutiva. */
  optionChecked = input<boolean>(false);

  /** Emitted whenever the optional checkbox is toggled. */
  optionCheckedChange = output<boolean>();

  /**
   * While true both buttons are disabled and the backdrop stops cancelling: a
   * request started by `confirmed` is in flight and must not be repeated or
   * abandoned from the dialog. The caller shows the progress in `confirmLabel`.
   */
  busy = input<boolean>(false);

  /**
   * 'large' (opt-in, só para diálogos destrutivos): mensagem, opção e dica em 16px, alvo do
   * checkbox >= 44px, e foco inicial no botão seguro (cancelar). 'default' não muda nada.
   */
  size = input<'default' | 'large'>('default');

  private readonly cancelBtn = viewChild<ElementRef<HTMLButtonElement>>('cancelBtn');

  protected readonly large = computed(() => this.size() === 'large');

  constructor() {
    afterRenderEffect(() => {
      if (this.open() && this.large()) this.cancelBtn()?.nativeElement.focus();
    });
  }

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

  protected onOptionToggle(event: Event): void {
    this.optionCheckedChange.emit((event.target as HTMLInputElement).checked);
  }

  protected onConfirm(): void {
    if (this.busy()) return;
    this.confirmed.emit();
  }

  protected onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }
}

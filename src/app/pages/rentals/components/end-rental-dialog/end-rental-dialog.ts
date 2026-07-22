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
import {
  CaucaoRefundMethod,
  CaucaoRefundPayload,
  RentalResponseDto,
} from '../../../../types/rental.types';

/**
 * Payload emitido pelo dialog — mesma forma que o backend aceita em
 * complete/cancel. O caller decide se envia como completedAt/canceledAt.
 */
export interface EndRentalDialogPayload {
  date: string; // yyyy-MM-dd
  endReason?: string;
  caucaoRefund?: CaucaoRefundPayload;
}

export type EndRentalIntent = 'complete' | 'cancel';

/**
 * Dialog rico de encerramento (Concluir ou Cancelar). Coleta data,
 * motivo opcional e — quando há caução paga — método + valor da devolução.
 */
@Component({
  selector: 'app-end-rental-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './end-rental-dialog.html',
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
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
export class EndRentalDialog {
  open = input.required<boolean>();
  rental = input.required<RentalResponseDto>();
  busy = input<boolean>(false);
  /** `complete` (verde, "Concluir aluguel") ou `cancel` (vermelho, "Cancelar aluguel"). */
  intent = input<EndRentalIntent>('complete');

  confirmed = output<EndRentalDialogPayload>();
  cancelled = output<void>();

  private readonly _today = todayIso();

  protected readonly selectedDate = signal<string>(this._today);
  protected readonly reason = signal<string>('');
  protected readonly refundMethod = signal<CaucaoRefundMethod>('AUTOMATIC');
  protected readonly refundAmountCents = signal<number>(0);

  protected readonly minDate = computed(() => this.rental().startDate);
  protected readonly maxDate = computed(() => this._today);

  /** Valor total da caução paga (somando charges CAUCAO com status=PAID). */
  protected readonly caucaoPaidCents = computed<number>(() => {
    const r = this.rental();
    const fromCharges = r.charges
      .filter((c) => c.kind === 'CAUCAO' && c.status === 'PAID')
      .reduce((acc, c) => acc + c.amount, 0);
    // Fallback: caução marcada manualmente (`caucaoPaid=true`) sem charge.
    if (fromCharges > 0) return fromCharges;
    if (r.caucaoPaid && r.caucaoAmount > 0) return r.caucaoAmount;
    return 0;
  });

  /** Só mostra a seção de devolução quando há caução paga. */
  protected readonly showRefundSection = computed<boolean>(() => this.caucaoPaidCents() > 0);

  /** Diferença em dias entre a data escolhida e o endDate programado. */
  protected readonly daysBeforeEnd = computed<number>(() => {
    const r = this.rental();
    const chosen = this.selectedDate();
    if (!chosen) return 0;
    const chosenMs = new Date(chosen + 'T00:00:00').getTime();
    const endMs = new Date(r.endDate + 'T00:00:00').getTime();
    return Math.round((endMs - chosenMs) / 86_400_000);
  });

  protected readonly previewLabel = computed<string>(() => {
    const chosen = this.selectedDate();
    if (!chosen) return '';
    const chosenLabel = new Date(chosen + 'T00:00:00').toLocaleDateString('pt-BR');
    if (this.intent() === 'cancel') {
      return `Cancelamento em ${chosenLabel}`;
    }
    const diff = this.daysBeforeEnd();
    if (diff <= 0) return `Concluído em ${chosenLabel} (dentro do prazo)`;
    return `Concluído em ${chosenLabel} — ${diff} dia(s) antes do fim programado`;
  });

  protected readonly formattedRefund = computed(() => formatBRL(this.refundAmountCents()));
  protected readonly formattedCaucaoPaid = computed(() => formatBRL(this.caucaoPaidCents()));

  protected readonly confirmLabel = computed(() =>
    this.intent() === 'cancel' ? 'Cancelar aluguel' : 'Concluir aluguel',
  );

  protected readonly cancelLabel = computed(() =>
    this.intent() === 'cancel' ? 'Voltar' : 'Cancelar',
  );

  protected readonly titleLabel = computed(() =>
    this.intent() === 'cancel' ? 'Cancelar aluguel' : 'Concluir aluguel',
  );

  protected readonly confirmBtnClass = computed(() =>
    this.intent() === 'cancel'
      ? 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-400'
      : 'bg-emerald-500 hover:bg-emerald-600 focus-visible:ring-emerald-400',
  );

  protected readonly iconBgClass = computed(() =>
    this.intent() === 'cancel' ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500',
  );

  constructor() {
    // Reset a cada abertura: hoje / campos limpos / refund default.
    effect(() => {
      if (this.open()) {
        this.selectedDate.set(this._today);
        this.reason.set('');
        const paid = this.caucaoPaidCents();
        this.refundMethod.set(paid > 0 ? 'AUTOMATIC' : 'NONE');
        this.refundAmountCents.set(paid);
      }
    });
  }

  protected onDateInput(event: Event): void {
    this.selectedDate.set((event.target as HTMLInputElement).value);
  }

  protected onReasonInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.reason.set(value.slice(0, 500));
  }

  protected onRefundMethodChange(method: CaucaoRefundMethod): void {
    this.refundMethod.set(method);
    if (method === 'NONE') {
      this.refundAmountCents.set(0);
    } else if (this.refundAmountCents() === 0) {
      // Volta ao total pago quando reativa AUTOMATIC / MANUAL.
      this.refundAmountCents.set(this.caucaoPaidCents());
    }
  }

  protected onRefundAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const digits = raw.replace(/\D/g, '');
    const cents = digits === '' ? 0 : Number(digits);
    const max = this.caucaoPaidCents();
    this.refundAmountCents.set(Math.min(cents, max));
  }

  protected onConfirm(): void {
    if (this.busy()) return;
    const chosen = this.clampDate(this.selectedDate());
    const reason = this.reason().trim();
    const payload: EndRentalDialogPayload = { date: chosen };
    if (reason.length > 0) payload.endReason = reason;
    if (this.showRefundSection()) {
      payload.caucaoRefund = {
        method: this.refundMethod(),
        amount: this.refundMethod() === 'NONE' ? 0 : this.refundAmountCents(),
      };
    }
    this.confirmed.emit(payload);
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

  private clampDate(value: string): string {
    let clamped = value;
    const min = this.minDate();
    const max = this.maxDate();
    if (min && clamped < min) clamped = min;
    if (max && clamped > max) clamped = max;
    return clamped;
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

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ReasonOption, ReasonPicker } from '../../../components/core/reason-picker/reason-picker';
import { DateField } from '../../../components/core/date-field/date-field';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import {
  RECEIVED_OUTSIDE_REASON_OPTIONS,
  ReceivedOutsideReason,
  ReceivedOutsideRequestDto,
} from '../../../types/agreement.types';
import { brl } from './charges-flex';

/**
 * FEAT-0573 — jornada E, passo 2: "Recebida por fora". Só o formulário: data (de início do
 * aluguel até hoje), motivo da lista e observação opcional. O valor é sempre o da cobrança.
 * A confirmação ("não dá para desfazer") e o envio ficam com a tela do aluguel, num diálogo
 * por cima — como no canvas aprovado.
 */
@Component({
  selector: 'app-received-outside-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, ReasonPicker, DateField, AlertBanner],
  template: `
    <app-bottom-sheet title="Recebida por fora" [subtitle]="subtitle()" (closed)="onClosed()">
      <div class="flex flex-col gap-4" data-testid="received-outside-sheet">
        <label class="flex flex-col gap-1" for="rf-value">
          <span class="text-sm font-medium text-fg-muted">Valor</span>
          <input
            id="rf-value"
            type="text"
            readonly
            data-testid="received-outside-value"
            [value]="money(amountCents())"
            aria-describedby="rf-value-help"
            class="min-h-12 w-full rounded-xl border border-edge bg-surface-sunken px-3 text-base text-fg-soft tabular-nums"
          />
          <span id="rf-value-help" class="text-xs text-fg-subtle">Sempre o valor da cobrança.</span>
        </label>

        <app-date-field
          label="Recebida em"
          hint="Hoje ou uma data anterior."
          [min]="minDate()"
          [max]="today()"
          [value]="receivedOn()"
          (valueChange)="receivedOn.set($event)"
        />

        <app-reason-picker
          [options]="reasonOptions"
          legend="Motivo"
          [reason]="reason()"
          (reasonChange)="reason.set($event)"
          [note]="note()"
          (noteChange)="note.set($event)"
          noteHint="Opcional. Fica no histórico do aluguel."
        />

        <app-alert-banner
          variant="warning"
          message="Depois de registrar, o Pix desta cobrança para de funcionar e não dá para desfazer."
        />
      </div>

      <div sheetFooter class="flex flex-col-reverse gap-2 lg:flex-row lg:justify-end lg:gap-3">
        <button type="button" (click)="cancel()"
          class="press min-h-12 w-full rounded-xl bg-surface-sunken px-5 text-base font-medium text-fg-muted transition-colors hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 lg:w-auto">
          Cancelar
        </button>
        <button type="button" data-testid="received-outside-submit" [disabled]="!valid()" (click)="submit()"
          class="press min-h-12 w-full rounded-xl bg-emerald-600 px-5 text-base font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 lg:w-auto">
          Registrar recebimento
        </button>
      </div>
    </app-bottom-sheet>
  `,
})
export class ReceivedOutsideSheet implements OnInit {
  readonly subtitle = input<string | null>(null);
  readonly amountCents = input.required<number>();
  /** Início do aluguel (yyyy-MM-dd): a data não pode ser anterior. */
  readonly minDate = input<string | null>(null);
  readonly today = input.required<string>();
  /** Rascunho de uma volta do diálogo de confirmação ("Voltar"). */
  readonly draft = input<ReceivedOutsideRequestDto | null>(null);

  readonly submitted = output<ReceivedOutsideRequestDto>();
  readonly closed = output<void>();

  private readonly sheet = viewChild(BottomSheet);
  private submitting = false;

  protected readonly reasonOptions: ReasonOption[] = RECEIVED_OUTSIDE_REASON_OPTIONS.map((o) => ({ ...o }));
  protected readonly receivedOn = signal('');
  protected readonly reason = signal<string | null>(null);
  protected readonly note = signal('');

  protected readonly valid = computed(() => {
    const day = this.receivedOn();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    if (day > this.today()) return false;
    const min = this.minDate();
    if (min && day < min) return false;
    return this.reason() !== null;
  });

  ngOnInit(): void {
    const d = this.draft();
    this.receivedOn.set(d?.receivedOn ?? this.today());
    this.reason.set(d?.reason ?? null);
    this.note.set(d?.note ?? '');
  }

  protected money(cents: number): string {
    return brl(cents);
  }

  protected submit(): void {
    if (!this.valid()) return;
    this.submitting = true;
    this.sheet()?.requestClose(true);
  }

  protected cancel(): void {
    this.sheet()?.requestClose();
  }

  /** O pai só abre a confirmação DEPOIS que a folha saiu da tela (sem duas camadas). */
  protected onClosed(): void {
    if (this.submitting) {
      const note = this.note().trim();
      this.submitted.emit({
        receivedOn: this.receivedOn(),
        reason: this.reason() as ReceivedOutsideReason,
        note: note.length > 0 ? note : null,
      });
    }
    this.closed.emit();
  }
}

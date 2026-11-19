import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ApiErrorService } from '../../../services/api-error.service';
import type { PlatformCostSchedule } from '../../../types/admin-finance.types';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';
import { AdminFinanceService } from '../finance/admin-finance.service';
import { brl, costErrorMessage, isStale, monthName } from './costs-copy';
import { MAX_AMOUNT_CENTS } from './fixed-cost-sheet';
import { FIELD } from './vendor-fields';

/** `amount` = "Mudar valor daqui para frente"; `end` = "Encerrar custo fixo". */
export type FixedCostChange = 'amount' | 'end';

/** O mês inicial dos campos: o corrente, dentro do que o custo fixo aceita. */
export function clampMonth(month: string, min: string, max: string | null): string {
  if (month < min) return min;
  if (max && month > max) return max;
  return month;
}

/**
 * Mudanças que valem "daqui para frente" num custo fixo: o valor a partir de um mês (o servidor
 * fecha o custo fixo no mês anterior e abre outro; meses editados e tirados ficam como estão) e o
 * último mês (lançamentos depois dele que não foram editados saem).
 */
@Component({
  selector: 'app-fixed-cost-change-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, BottomSheet],
  template: `
    <app-bottom-sheet [title]="title()" [subtitle]="subtitle()" [busy]="saving()" (closed)="closed.emit()">
      <form class="flex flex-col gap-4" data-testid="fixed-change-sheet" (ngSubmit)="submit()" novalidate>
        @if (mode() === 'amount') {
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1 min-w-0">
              <span class="text-sm font-medium text-fg-muted">Novo valor por mês</span>
              <input type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"
                     [formControl]="amountControl" (input)="onAmountInput($event)"
                     data-testid="change-amount" [class]="field + ' tabular-nums'" />
            </label>
            <label class="flex flex-col gap-1 min-w-0">
              <span class="text-sm font-medium text-fg-muted">A partir de</span>
              <input type="month" [min]="schedule().startMonth" [attr.max]="schedule().endMonth"
                     [formControl]="monthControl" data-testid="change-month" [class]="field + ' tabular-nums'" />
            </label>
          </div>
        } @else {
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-fg-muted">Último mês</span>
            <input type="month" [min]="schedule().startMonth" [formControl]="monthControl"
                   data-testid="change-month" [class]="field + ' tabular-nums'" />
          </label>
        }

        @if (summary(); as text) {
          <p class="rounded-2xl bg-surface-sunken px-4 py-3 text-sm text-fg" data-testid="change-summary" aria-live="polite">{{ text }}</p>
        }

        <button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Salvar</button>
      </form>

      <div sheetFooter class="pt-3 flex flex-col gap-3">
        <!-- O erro do servidor (ex.: 409) fica colado no botão: no fim do formulário ele caía abaixo da dobra. -->
        @if (error(); as msg) {
          <app-alert-banner variant="error" [message]="msg" data-testid="change-error" />
        }
        <div class="flex flex-col-reverse gap-2 lg:flex-row lg:justify-end">
          <button type="button" data-testid="change-cancel" (click)="cancel()"
                  class="press min-h-12 rounded-xl border border-edge px-5 text-base font-semibold text-fg hover:bg-surface-muted
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
            Cancelar
          </button>
          <button type="button" data-testid="change-save" [disabled]="saving()" (click)="submit()"
                  class="press min-h-12 rounded-xl bg-primary-500 px-5 text-base font-semibold text-white hover:bg-primary-600
                         disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
            {{ saving() ? 'Salvando…' : mode() === 'amount' ? 'Mudar daqui para frente' : 'Encerrar' }}
          </button>
        </div>
      </div>
    </app-bottom-sheet>
  `,
})
export class FixedCostChangeSheet implements OnInit {
  private readonly service = inject(AdminFinanceService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly sheet = viewChild.required(BottomSheet);

  readonly mode = input.required<FixedCostChange>();
  /** O último custo fixo da cadeia (só ele aceita mudanças). */
  readonly schedule = input.required<PlatformCostSchedule>();
  readonly currentMonth = input.required<string>();
  readonly saved = output<PlatformCostSchedule>();
  readonly closed = output<void>();
  /** O servidor disse que a tela ficou velha: a página recarrega. */
  readonly stale = output<void>();

  protected readonly field = FIELD;
  protected readonly amountControl = new FormControl('', { nonNullable: true, validators: [ptBrMoneyValidator()] });
  protected readonly monthControl = new FormControl('', { nonNullable: true });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly amountText = signal('');
  private readonly monthValue = signal('');

  protected readonly title = computed(() =>
    this.mode() === 'amount' ? 'Mudar valor daqui para frente' : 'Encerrar custo fixo',
  );
  protected readonly subtitle = computed(() => {
    const s = this.schedule();
    return `${s.vendorName} · ${s.service} · hoje ${brl(s.amountCents)} por mês`;
  });

  protected readonly summary = computed(() => {
    const month = this.monthValue();
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const s = this.schedule();
    if (this.mode() === 'end') {
      return (
        `Lança até ${monthName(month)}. Os lançamentos depois disso que não foram editados saem; ` +
        'os meses editados ficam como estão.'
      );
    }
    const cents = ptBrMoneyCents(this.amountText());
    if (cents === null) return null;
    return (
      `De ${monthName(month)} em diante, ${s.service} passa de ${brl(s.amountCents)} para ${brl(cents)}. ` +
      'Meses antes disso e linhas editadas só naquele mês não mudam.'
    );
  });

  ngOnInit(): void {
    this.amountControl.valueChanges.subscribe((v) => this.amountText.set(v));
    this.monthControl.valueChanges.subscribe((v) => this.monthValue.set(v));
    const s = this.schedule();
    const max = this.mode() === 'amount' ? s.endMonth : null;
    this.monthControl.setValue(clampMonth(this.currentMonth(), s.startMonth, max));
  }

  protected onAmountInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.amountControl);
  }

  protected cancel(): void {
    this.sheet().requestClose();
  }

  private validate(): string | null {
    const s = this.schedule();
    const month = this.monthControl.value;
    if (!/^\d{4}-\d{2}$/.test(month)) return 'Escolha o mês.';
    if (month < s.startMonth) return `O mês vem depois de ${monthName(s.startMonth)}, quando este valor começou.`;
    if (this.mode() === 'end') return null;
    if (s.endMonth && month > s.endMonth) return `Este custo fixo termina em ${monthName(s.endMonth)}.`;
    if (this.amountControl.invalid) return 'Informe o novo valor.';
    const cents = ptBrMoneyCents(this.amountControl.value) ?? 0;
    if (cents > MAX_AMOUNT_CENTS) return 'O valor passa do limite.';
    if (cents === s.amountCents) return 'O valor é o mesmo de hoje.';
    return null;
  }

  protected submit(): void {
    this.error.set(null);
    const invalid = this.validate();
    if (invalid) {
      this.error.set(invalid);
      return;
    }
    const s = this.schedule();
    const month = this.monthControl.value;
    const request$ =
      this.mode() === 'amount'
        ? this.service.changeAmount(s.id, { fromMonth: month, amountCents: ptBrMoneyCents(this.amountControl.value) ?? 0 })
        : this.service.endSchedule(s.id, { endMonth: month });
    this.saving.set(true);
    request$.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
        this.sheet().requestClose(true);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.apiErrors.claim(err);
        this.error.set(costErrorMessage(err));
        if (isStale(err)) this.stale.emit();
      },
    });
  }
}

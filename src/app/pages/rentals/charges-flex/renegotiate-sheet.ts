import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';

import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ReasonPicker, ReasonOption } from '../../../components/core/reason-picker/reason-picker';
import { DateField } from '../../../components/core/date-field/date-field';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';
import { IdempotencyKeyKeeper } from '../../../utils/adjustments-view';
import {
  AGREEMENT_ERROR_MESSAGES,
  AGREEMENT_LIMITS,
  AGREEMENT_REASON_OPTIONS,
  AgreementDto,
  AgreementPreviewDto,
  AgreementReason,
  AgreementRequestDto,
  agreementReasonLabel,
} from '../../../types/agreement.types';
import { RentalChargeDto, RentalResponseDto } from '../../../types/rental.types';
import { ChargesFlexService } from './charges-flex.service';
import { apiErrorCode, flexErrorMessage, planBlockerMessage } from './flex-errors';
import {
  INTERVAL_UNIT_OPTIONS,
  IntervalUnit,
  MIN_GATEWAY_CENTS,
  brDate,
  brDayMonth,
  brl,
  buildInstalments,
  instalmentProblems,
  intervalToDays,
  splitEvenly,
} from './charges-flex';

/** Uma cobrança que pode entrar no acordo, já com o rótulo que a tela do aluguel usa. */
export interface RenegotiableOption {
  charge: RentalChargeDto;
  label: string;
  /** "Venceu em 23/11/2026" / "Vence em 07/12/2026". */
  dueLabel: string;
  chip: { label: string; chip: string };
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: 'Cobranças',
  2: 'Valor e parcelas',
  3: 'Motivo',
  4: 'Conferir',
};

/** Códigos em que a lista do aluguel mudou: o pai recarrega e o usuário revê o passo 1. */
const STALE_CODES = new Set([
  'AGREEMENT_SOURCE_NOT_OPEN',
  'AGREEMENT_SOURCE_ALREADY_PAID',
  'AGREEMENT_SOURCE_BUSY',
  'AGREEMENT_NEEDS_ATTENTION',
]);

/**
 * FEAT-0573 — jornada D (e H3, aluguel manual): "Renegociar". Folha em 4 passos, como o
 * canvas aprovado: escolher as cobranças, combinar valor e parcelas, motivo e descrição
 * (os dois obrigatórios), conferir e confirmar. A conta final é a da prévia do backend.
 */
@Component({
  selector: 'app-renegotiate-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, ReasonPicker, DateField, AlertBanner, ReactiveFormsModule],
  templateUrl: './renegotiate-sheet.html',
})
export class RenegotiateSheet {
  private readonly api = inject(ChargesFlexService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly rental = input.required<RentalResponseDto>();
  readonly options = input.required<readonly RenegotiableOption[]>();
  readonly preselectedId = input<string | null>(null);
  readonly today = input.required<string>();
  readonly subtitle = input<string | null>(null);

  readonly created = output<AgreementDto>();
  /** A recusa mostra que a lista do aluguel mudou — o pai recarrega. */
  readonly stale = output<void>();
  readonly closed = output<void>();

  private readonly sheet = viewChild(BottomSheet);

  protected readonly step = signal<Step>(1);
  protected readonly stepLabel = computed(() => `Passo ${this.step()} de 4 · ${STEP_LABELS[this.step()]}`);
  protected readonly bar = computed(() => [1, 2, 3, 4].map((i) => i <= this.step()));

  // ---------------------------------------------------------------- passo 1
  private readonly picked = signal<ReadonlySet<string> | null>(null);
  protected readonly selectedIds = computed<ReadonlySet<string>>(() => {
    const explicit = this.picked();
    if (explicit) return explicit;
    const pre = this.preselectedId();
    return new Set(pre && this.options().some((o) => o.charge.id === pre) ? [pre] : []);
  });
  protected readonly selected = computed(() =>
    this.options().filter((o) => this.selectedIds().has(o.charge.id)),
  );
  protected readonly originalTotal = computed(() =>
    this.selected().reduce((acc, o) => acc + o.charge.amount, 0),
  );

  protected toggle(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else if (next.size < AGREEMENT_LIMITS.maxSources) next.add(id);
    this.picked.set(next);
    this.preview.set(null);
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  // ---------------------------------------------------------------- passo 2
  protected readonly amount = new FormControl('', {
    nonNullable: true,
    validators: [ptBrMoneyValidator({ minCents: 1 })],
  });
  private readonly amountText = toSignal(this.amount.valueChanges, { initialValue: '' });
  protected readonly agreedCents = computed(() => ptBrMoneyCents(this.amountText()) ?? 0);
  protected readonly difference = computed(() => this.agreedCents() - this.originalTotal());

  protected readonly payMode = signal<'ONCE' | 'SPLIT'>('SPLIT');
  protected readonly count = signal(2);
  protected readonly intervalN = signal(1);
  protected readonly intervalUnit = signal<IntervalUnit>('WEEKS');
  protected readonly firstDue = signal('');
  protected readonly intervalUnits = INTERVAL_UNIT_OPTIONS;

  protected readonly effectiveCount = computed(() => (this.payMode() === 'ONCE' ? 1 : this.count()));
  protected readonly firstDueOrToday = computed(() => this.firstDue() || this.today());
  protected readonly instalments = computed(() =>
    buildInstalments(
      this.agreedCents(),
      this.effectiveCount(),
      this.firstDueOrToday(),
      intervalToDays(this.intervalN(), this.intervalUnit()),
    ),
  );
  /** Multa fixa do aluguel dividida pelas parcelas (G3), só para mostrar antes da prévia. */
  protected readonly fineShares = computed<number[] | null>(() => {
    const r = this.rental();
    if (r.lateFineType !== 'FIXED' || !r.lateFineValue) return null;
    return splitEvenly(r.lateFineValue, this.effectiveCount());
  });
  private readonly minCents = computed(() =>
    this.rental().automaticCharge === false ? 1 : MIN_GATEWAY_CENTS,
  );
  protected readonly step2Problems = computed(() => {
    if (this.agreedCents() <= 0) return [];
    return instalmentProblems(this.instalments(), {
      expectedTotal: this.agreedCents(),
      today: this.today(),
      minCents: this.minCents(),
    });
  });

  protected onAmountInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.amount);
    this.preview.set(null);
  }

  protected setCount(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.count.set(Number.isFinite(n) ? Math.min(AGREEMENT_LIMITS.maxInstalments, Math.max(2, n)) : 2);
    // O campo mostra o número que vale (2 a 24), não o digitado fora da faixa.
    (event.target as HTMLInputElement).value = String(this.count());
    this.preview.set(null);
  }

  protected setIntervalN(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.intervalN.set(Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 1);
    this.preview.set(null);
  }

  protected setIntervalUnit(event: Event): void {
    this.intervalUnit.set((event.target as HTMLSelectElement).value as IntervalUnit);
    this.preview.set(null);
  }

  protected setFirstDue(value: string): void {
    this.firstDue.set(value);
    this.preview.set(null);
  }

  protected setPayMode(mode: 'ONCE' | 'SPLIT'): void {
    this.payMode.set(mode);
    this.preview.set(null);
  }

  // ---------------------------------------------------------------- passo 3
  protected readonly reasonOptions: ReasonOption[] = AGREEMENT_REASON_OPTIONS.map((o) => ({ ...o }));
  protected readonly reason = signal<string | null>(null);
  protected readonly description = signal('');
  protected readonly descriptionOk = computed(() => {
    const len = this.description().trim().length;
    return len >= AGREEMENT_LIMITS.descriptionMin && len <= AGREEMENT_LIMITS.descriptionMax;
  });

  protected onDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
    this.preview.set(null);
  }

  protected onReason(value: string | null): void {
    this.reason.set(value);
    this.preview.set(null);
  }

  // ---------------------------------------------------------------- passo 4
  protected readonly preview = signal<AgreementPreviewDto | null>(null);
  protected readonly loadingPreview = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly keys = new IdempotencyKeyKeeper();

  protected readonly manual = computed(() => this.rental().automaticCharge === false);
  protected readonly reasonLabel = computed(() => agreementReasonLabel(this.reason()));
  protected readonly lastDue = computed(() => {
    const p = this.preview();
    if (p?.lastDueDate) return p.lastDueDate;
    const list = this.instalments();
    return list[list.length - 1]?.dueDate ?? null;
  });

  protected readonly canContinue = computed(() => {
    switch (this.step()) {
      case 1:
        return this.selected().length > 0;
      case 2:
        // Só sinais aqui: `amount.valid` não é reativo e congelaria o computed.
        return this.agreedCents() > 0 && this.step2Problems().length === 0;
      case 3:
        return this.reason() !== null && this.descriptionOk();
      default:
        return !!this.preview() && !this.preview()!.blocker && !this.busy() && !this.done();
    }
  });

  private body(): AgreementRequestDto {
    return {
      sourceChargeIds: this.selected().map((o) => o.charge.id),
      reason: this.reason() as AgreementReason,
      description: this.description().trim(),
      agreedTotalCents: this.agreedCents(),
      instalments: this.instalments(),
    };
  }

  protected next(): void {
    if (!this.canContinue()) return;
    this.error.set(null);
    const s = this.step();
    if (s === 2 && !this.firstDue()) this.firstDue.set(this.today());
    if (s === 3) {
      this.step.set(4);
      this.loadPreview();
      return;
    }
    if (s < 4) this.step.set((s + 1) as Step);
  }

  protected back(): void {
    if (this.busy()) return;
    this.error.set(null);
    const s = this.step();
    if (s === 1) {
      this.close();
      return;
    }
    this.step.set((s - 1) as Step);
  }

  private loadPreview(): void {
    const r = this.rental();
    this.loadingPreview.set(true);
    this.api.agreementPreview(r.id, this.body()).subscribe({
      next: (p) => {
        this.loadingPreview.set(false);
        this.preview.set(p);
      },
      error: (err: HttpErrorResponse) => {
        this.loadingPreview.set(false);
        const server = this.apiErrors.messageFor(err, 'Não foi possível conferir o acordo. Tente de novo.');
        this.error.set(flexErrorMessage(err, AGREEMENT_ERROR_MESSAGES, server));
      },
    });
  }

  protected retryPreview(): void {
    this.error.set(null);
    this.loadPreview();
  }

  protected confirm(): void {
    if (!this.canContinue() || this.step() !== 4) return;
    const r = this.rental();
    const body = this.body();
    const key = this.keys.keyFor(JSON.stringify(body));
    this.busy.set(true);
    this.error.set(null);
    this.api.createAgreement(r.id, body, key).subscribe({
      next: (agreement) => {
        this.busy.set(false);
        this.done.set(true);
        this.keys.reset();
        this.created.emit(agreement);
        this.sheet()?.requestClose(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const server = this.apiErrors.messageFor(err, 'Não foi possível criar o acordo. Tente de novo.');
        this.error.set(flexErrorMessage(err, AGREEMENT_ERROR_MESSAGES, server));
        const code = apiErrorCode(err);
        if (code && STALE_CODES.has(code)) {
          this.stale.emit();
          if (code !== 'AGREEMENT_NEEDS_ATTENTION') {
            this.picked.set(new Set());
            this.preview.set(null);
            this.step.set(1);
          }
        }
      },
    });
  }

  protected close(): void {
    this.sheet()?.requestClose();
  }

  // ---------------------------------------------------------------- texto
  protected blockerMessage(b: { code: string; message: string }): string {
    return AGREEMENT_ERROR_MESSAGES[b.code] ?? planBlockerMessage(b);
  }

  protected money(cents: number | null | undefined): string {
    return brl(cents);
  }

  protected date(iso: string | null | undefined): string {
    return brDate(iso);
  }

  protected dayMonth(iso: string | null | undefined): string {
    return brDayMonth(iso);
  }

  protected signedMoney(cents: number): string {
    if (cents === 0) return brl(0);
    return `${cents > 0 ? '+' : '−'} ${brl(Math.abs(cents))}`;
  }

  protected readonly selectedCaption = computed(() => {
    const n = this.selected().length;
    return n === 1 ? '1 cobrança' : `${n} cobranças`;
  });

  protected readonly instalmentsSummary = computed(() => {
    const list = this.preview()?.instalments ?? this.instalments();
    if (list.length === 0) return '';
    const amounts = new Set(list.map((i) => i.amountCents));
    const n = list.length;
    if (n === 1) return `1 parcela de ${brl(list[0].amountCents)}`;
    return amounts.size === 1
      ? `${n} parcelas de ${brl(list[0].amountCents)}`
      : `${n} parcelas, de ${brl(Math.min(...amounts))} a ${brl(Math.max(...amounts))}`;
  });

  protected readonly instalmentsDates = computed(() => {
    const list = this.preview()?.instalments ?? this.instalments();
    if (list.length === 0) return '';
    if (list.length === 1) return `Vence em ${brDate(list[0].dueDate)}`;
    return `De ${brDayMonth(list[0].dueDate)} a ${brDate(list[list.length - 1].dueDate)}`;
  });

  protected readonly sourcesNames = computed(() => {
    const labels = this.selected().map((o) => o.label);
    if (labels.length <= 1) return labels.join('');
    return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
  });
}

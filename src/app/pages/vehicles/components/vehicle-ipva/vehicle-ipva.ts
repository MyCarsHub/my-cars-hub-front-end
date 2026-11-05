import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { AlertBanner } from '../../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../../components/core/actions-menu/actions-menu';
import { BottomSheet } from '../../../../components/core/bottom-sheet/bottom-sheet';
import { ConfirmDialog } from '../../../../components/core/confirm-dialog/confirm-dialog';
import { ListGroup, ListRow } from '../../../../components/core/list-group/list-group';
import { PillTabOption, PillTabs } from '../../../../components/core/pill-tabs/pill-tabs';
import {
  StatusChip,
  StatusChipTone,
} from '../../../../components/core/status-chip/status-chip';
import { FieldControl, FormField } from '../../../../components/form-field/form-field';
import { KpiCard } from '../../../../components/kpi-card/kpi-card';
import { KpiGlyph } from '../../../../components/kpi-card/kpi-glyph';
import { todayIso } from '../../../../components/vehicles/insurance-form-fields/insurance-utils';
import { ApiErrorService } from '../../../../services/api-error.service';
import { NotificationService } from '../../../../services/notification.service';
import { VehicleIpvaService } from '../../../../services/vehicle-ipva.service';
import {
  IpvaInstallment,
  IpvaInstallmentStatus,
  IpvaYear,
} from '../../../../types/vehicle-ipva.types';
import { applyPtBrMoneyMaskToControl } from '../../../../utils/ptbr-money-mask';
import { formatPtBrMoney } from '../../../../utils/ptbr-number';
import {
  ptBrMoneyCents,
  ptBrMoneyValidator,
} from '../../../../utils/validators/ptbr-money.validator';

import { MAX_IPVA_INSTALLMENTS, ipvaSplitPreview } from './ipva-split';

export { MAX_IPVA_INSTALLMENTS } from './ipva-split';

export type IpvaSheet = 'generate' | 'add' | 'edit' | 'pay';

const STATUS_CHIP: Record<IpvaInstallmentStatus, { label: string; tone: StatusChipTone }> = {
  PAID: { label: 'Paga', tone: 'green' },
  OVERDUE: { label: 'Vencida', tone: 'orange' },
  PENDING: { label: 'Em aberto', tone: 'neutral' },
};

const MONEY_MESSAGES: Readonly<Record<string, string>> = {
  required: 'Informe o valor.',
  moneyFormat: 'Informe um valor válido (ex.: 1.200,00).',
  min: 'O valor precisa ser maior que zero.',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Exercício sem parcelas: o que a tela usa quando o ano escolhido não veio do GET. */
function emptyYear(vehicleId: string, year: number): IpvaYear {
  return {
    vehicleId,
    year,
    totalCents: 0,
    paidCents: 0,
    openCents: 0,
    installmentsCount: 0,
    paidCount: 0,
    nextDueDate: null,
    status: null,
    installments: [],
  };
}

/**
 * IPVA por exercício com parcelas, no segmento Gerência do veículo (FEAT-0422).
 *
 * Os números do resumo (total, pago, próximo vencimento) vêm prontos do backend
 * em `IpvaYear` — a tela não soma de novo, para os dois nunca discordarem. Toda
 * mutação devolve o exercício completo e substitui o que está na lista.
 *
 * Os campos de IPVA do formulário do veículo ficam como estão (decisão do dono
 * pendente); este bloco é só a gestão por ano.
 */
@Component({
  selector: 'app-vehicle-ipva',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0 scroll-mt-16' },
  imports: [
    ReactiveFormsModule,
    AlertBanner,
    ActionsMenu,
    BottomSheet,
    ConfirmDialog,
    FieldControl,
    FormField,
    KpiCard,
    KpiGlyph,
    ListGroup,
    ListRow,
    PillTabs,
    StatusChip,
  ],
  templateUrl: './vehicle-ipva.html',
})
export class VehicleIpva implements OnInit {
  private readonly ipvaService = inject(VehicleIpvaService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly vehicleId = input.required<string>();
  /** Veículo vendido: gerar, adicionar e excluir são recusados (409) — a tela trava antes. */
  readonly sold = input(false);
  readonly lockReason = input<string | null>(null);
  /** Ano pedido por quem abriu a página (`?ipva=AAAA`): seleciona o ano e rola até a seção. */
  readonly focusYear = input<number | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);

  protected readonly today = todayIso();
  protected readonly currentYear = Number(this.today.slice(0, 4));
  protected readonly maxInstallments = MAX_IPVA_INSTALLMENTS;
  protected readonly moneyMessages = MONEY_MESSAGES;
  protected readonly countMessages: Readonly<Record<string, string>> = {
    required: 'Informe o número de parcelas.',
    min: `De 1 a ${MAX_IPVA_INSTALLMENTS} parcelas.`,
    max: `De 1 a ${MAX_IPVA_INSTALLMENTS} parcelas.`,
  };
  protected readonly dateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data.',
  };

  protected readonly years = signal<IpvaYear[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly selectedYear = signal<number>(this.currentYear);

  protected readonly sheet = signal<IpvaSheet | null>(null);
  protected readonly target = signal<IpvaInstallment | null>(null);
  protected readonly saving = signal(false);
  protected readonly sheetError = signal<string | null>(null);

  protected readonly unpayTarget = signal<IpvaInstallment | null>(null);
  protected readonly deleteTarget = signal<IpvaInstallment | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  private readonly sheetRef = viewChild(BottomSheet);

  protected readonly generateForm = this.fb.nonNullable.group({
    totalReais: ['', [ptBrMoneyValidator({ minCents: 1 })]],
    installments: [
      3,
      [Validators.required, Validators.min(1), Validators.max(MAX_IPVA_INSTALLMENTS)],
    ],
    firstDueDate: ['', [Validators.required]],
  });

  protected readonly installmentForm = this.fb.nonNullable.group({
    dueDate: ['', [Validators.required]],
    amountReais: ['', [ptBrMoneyValidator({ minCents: 1 })]],
  });

  protected readonly payForm = this.fb.nonNullable.group({
    paidDate: [this.today, [Validators.required]],
    paidAmountReais: ['', [ptBrMoneyValidator({ optional: true, minCents: 1 })]],
  });

  /** Anos com parcelas + o ano corrente (sempre dá para cadastrar o do ano). */
  protected readonly yearOptions = computed<readonly PillTabOption<string>[]>(() => {
    const set = new Set<number>(this.years().map((y) => y.year));
    set.add(this.currentYear);
    set.add(this.selectedYear());
    return [...set]
      .sort((a, b) => b - a)
      .map((y) => ({ value: String(y), label: String(y), testId: `ipva-year-${y}` }));
  });

  protected readonly current = computed<IpvaYear>(() => {
    const year = this.selectedYear();
    return this.years().find((y) => y.year === year) ?? emptyYear(this.vehicleId(), year);
  });

  protected readonly installments = computed(() =>
    [...this.current().installments].sort((a, b) => a.number - b.number),
  );
  protected readonly hasInstallments = computed(() => this.installments().length > 0);

  protected readonly paidProgress = computed<number | null>(() => {
    const y = this.current();
    return y.installmentsCount > 0 ? y.paidCount / y.installmentsCount : null;
  });

  protected readonly paidDetail = computed(
    () => `${this.current().paidCount} de ${this.current().installmentsCount} parcelas`,
  );

  /** A parcela em aberto que vence primeiro — o backend já devolve a data. */
  protected readonly nextInstallment = computed<IpvaInstallment | null>(() => {
    const due = this.current().nextDueDate;
    if (!due) return null;
    return this.installments().find((i) => !i.paid && i.dueDate === due) ?? null;
  });

  protected readonly nextDueValue = computed(() => {
    const due = this.current().nextDueDate;
    if (due) return this.formatDate(due);
    return this.current().installmentsCount > 0 ? 'Tudo pago' : '—';
  });

  protected readonly nextDueDetail = computed<string | null>(() => {
    const next = this.nextInstallment();
    if (!next) return null;
    const amount = next.amountCents == null ? 'sem valor' : this.formatCurrency(next.amountCents);
    return `${amount} · parcela ${next.number}/${this.current().installmentsCount}`;
  });

  protected readonly nextDueTone = computed(() =>
    this.nextInstallment()?.status === 'OVERDUE' ? 'warning' : 'default',
  );

  protected readonly paidNote = computed(
    () => `${this.current().paidCount} de ${this.current().installmentsCount} pagas`,
  );

  /** Prévia da divisão no gerar: mesma regra do backend (resto nas primeiras). */
  protected readonly generatePreview = signal<string | null>(null);

  protected readonly sheetTitle = computed(() => {
    const year = this.selectedYear();
    switch (this.sheet()) {
      case 'generate':
        return `Gerar parcelas de ${year}`;
      case 'add':
        return `Adicionar parcela em ${year}`;
      case 'edit':
        return `Editar parcela ${this.target()?.number ?? ''}`;
      case 'pay':
        return `Pagar parcela ${this.target()?.number ?? ''}`;
      default:
        return '';
    }
  });

  protected readonly sheetSubtitle = computed<string | null>(() => {
    const row = this.target();
    if (this.sheet() === 'pay' && row) {
      return `Vence ${this.formatDate(row.dueDate)} · ${this.formatCurrency(row.amountCents)}`;
    }
    if (this.sheet() === 'generate') return 'Vencimentos mensais a partir da 1ª parcela.';
    return null;
  });

  protected readonly unpayMessage = computed(() => {
    const row = this.unpayTarget();
    if (!row) return '';
    return (
      `Desfazer o pagamento da parcela ${row.number} de ${row.year}? ` +
      'Ela volta a contar como em aberto e a data de pagamento é apagada.'
    );
  });

  protected readonly deleteMessage = computed(() => {
    const row = this.deleteTarget();
    if (!row) return '';
    return `A parcela ${row.number} de ${row.year} será excluída. Esta ação não pode ser desfeita.`;
  });

  ngOnInit(): void {
    this.load();
    this.generateForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updatePreview());
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.ipvaService.listYears(this.vehicleId()).subscribe({
      next: (years) => {
        this.years.set(years);
        this.loading.set(false);
        const focus = this.focusYear();
        if (focus !== null) {
          // Veio da página IPVA da frota: abre no ano da linha tocada e traz a seção à vista.
          this.selectedYear.set(focus);
          this.scrollIntoView();
        } else if (!years.some((y) => y.year === this.currentYear) && years.length > 0) {
          // Abre no ano corrente quando ele tem parcelas; senão no exercício mais novo cadastrado.
          this.selectedYear.set(years[0].year);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.apiErrors.messageFor(err, 'Não foi possível carregar o IPVA.'));
      },
    });
  }

  /** Depois do próximo quadro, quando a seção já tem altura. Movimento reduzido: salto seco. */
  private scrollIntoView(): void {
    const view = this.doc.defaultView;
    if (!view) return;
    view.setTimeout(() => {
      const el = this.host.nativeElement;
      if (typeof el.scrollIntoView !== 'function') return;
      const reduced =
        typeof view.matchMedia === 'function' &&
        view.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }, 0);
  }

  protected selectYear(value: string): void {
    this.selectedYear.set(Number(value));
    this.actionError.set(null);
  }

  // ---- folhas ------------------------------------------------------------

  protected openGenerate(): void {
    if (this.sold()) return;
    this.generateForm.reset({ totalReais: '', installments: 3, firstDueDate: '' });
    this.openSheet('generate', null);
  }

  protected openAdd(): void {
    if (this.sold()) return;
    this.installmentForm.reset({ dueDate: '', amountReais: '' });
    this.openSheet('add', null);
  }

  protected openEdit(row: IpvaInstallment): void {
    if (row.paid) return;
    this.installmentForm.reset({
      dueDate: row.dueDate,
      amountReais: row.amountCents == null ? '' : formatPtBrMoney(row.amountCents),
    });
    this.openSheet('edit', row);
  }

  protected openPay(row: IpvaInstallment): void {
    if (row.paid) return;
    this.payForm.reset({
      paidDate: this.today,
      paidAmountReais: row.amountCents == null ? '' : formatPtBrMoney(row.amountCents),
    });
    this.openSheet('pay', row);
  }

  private openSheet(kind: IpvaSheet, row: IpvaInstallment | null): void {
    this.sheetError.set(null);
    this.actionError.set(null);
    this.target.set(row);
    this.sheet.set(kind);
  }

  protected requestCloseSheet(): void {
    if (this.saving()) return;
    const ref = this.sheetRef();
    if (ref) ref.requestClose();
    else this.onSheetClosed();
  }

  protected onSheetClosed(): void {
    this.sheet.set(null);
    this.target.set(null);
    this.saving.set(false);
  }

  protected onMoneyInput(event: Event, field: 'total' | 'amount' | 'paid'): void {
    const control =
      field === 'total'
        ? this.generateForm.controls.totalReais
        : field === 'amount'
          ? this.installmentForm.controls.amountReais
          : this.payForm.controls.paidAmountReais;
    applyPtBrMoneyMaskToControl(event, control);
  }

  protected submitSheet(): void {
    if (this.saving()) return;
    switch (this.sheet()) {
      case 'generate':
        return this.submitGenerate();
      case 'add':
      case 'edit':
        return this.submitInstallment();
      case 'pay':
        return this.submitPay();
    }
  }

  private submitGenerate(): void {
    const form = this.generateForm;
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const raw = form.getRawValue();
    const totalCents = ptBrMoneyCents(raw.totalReais) ?? 0;
    this.run(
      this.ipvaService.generate(this.vehicleId(), this.selectedYear(), {
        totalCents,
        installments: Number(raw.installments),
        firstDueDate: raw.firstDueDate,
      }),
      form,
      'Parcelas geradas.',
      'Não foi possível gerar as parcelas.',
    );
  }

  private submitInstallment(): void {
    const form = this.installmentForm;
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const raw = form.getRawValue();
    const payload = { dueDate: raw.dueDate, amountCents: ptBrMoneyCents(raw.amountReais) ?? 0 };
    const row = this.target();
    const year = this.selectedYear();
    if (this.sheet() === 'edit' && row) {
      this.run(
        this.ipvaService.update(this.vehicleId(), year, row.id, payload),
        form,
        'Parcela atualizada.',
        'Não foi possível salvar a parcela.',
      );
    } else {
      this.run(
        this.ipvaService.add(this.vehicleId(), year, payload),
        form,
        'Parcela adicionada.',
        'Não foi possível adicionar a parcela.',
      );
    }
  }

  private submitPay(): void {
    const form = this.payForm;
    const row = this.target();
    if (!row) return;
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const raw = form.getRawValue();
    this.run(
      this.ipvaService.pay(this.vehicleId(), row.year, row.id, {
        paidDate: raw.paidDate || null,
        paidAmountCents: ptBrMoneyCents(raw.paidAmountReais),
      }),
      form,
      'Parcela marcada como paga.',
      'Não foi possível marcar a parcela.',
    );
  }

  private run(
    request: Observable<IpvaYear>,
    form: AbstractControl,
    success: string,
    fallback: string,
  ): void {
    this.saving.set(true);
    this.sheetError.set(null);
    request.subscribe({
      next: (year) => {
        this.applyYear(year);
        this.notifications.success(success);
        this.saving.set(false);
        const ref = this.sheetRef();
        if (ref) ref.requestClose(true);
        else this.onSheetClosed();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(err, form, fallback);
        this.sheetError.set(formMessage);
      },
    });
  }

  // ---- ações de linha ----------------------------------------------------

  protected askUnpay(row: IpvaInstallment): void {
    if (row.paid) this.unpayTarget.set(row);
  }

  protected cancelUnpay(): void {
    if (!this.busyId()) this.unpayTarget.set(null);
  }

  protected confirmUnpay(): void {
    const row = this.unpayTarget();
    if (!row || this.busyId()) return;
    this.rowAction(
      row,
      this.ipvaService.unpay(this.vehicleId(), row.year, row.id),
      'Pagamento desfeito.',
      'Não foi possível desfazer o pagamento.',
      () => this.unpayTarget.set(null),
    );
  }

  protected askDelete(row: IpvaInstallment): void {
    if (row.paid || this.sold()) return;
    this.deleteTarget.set(row);
  }

  protected cancelDelete(): void {
    if (!this.busyId()) this.deleteTarget.set(null);
  }

  protected confirmDelete(): void {
    const row = this.deleteTarget();
    if (!row || this.busyId()) return;
    this.rowAction(
      row,
      this.ipvaService.remove(this.vehicleId(), row.year, row.id),
      'Parcela excluída.',
      'Não foi possível excluir a parcela.',
      () => this.deleteTarget.set(null),
    );
  }

  private rowAction(
    row: IpvaInstallment,
    request: Observable<IpvaYear>,
    success: string,
    fallback: string,
    done: () => void,
  ): void {
    this.actionError.set(null);
    this.busyId.set(row.id);
    request.subscribe({
      next: (year) => {
        this.busyId.set(null);
        done();
        this.applyYear(year);
        this.notifications.success(success);
      },
      error: (err: HttpErrorResponse) => {
        this.busyId.set(null);
        done();
        this.actionError.set(this.apiErrors.messageFor(err, fallback));
      },
    });
  }

  /** Ponto único de escrita: o exercício devolvido substitui o da lista (ou entra nela). */
  private applyYear(year: IpvaYear): void {
    this.years.update((list) => {
      const rest = list.filter((y) => y.year !== year.year);
      const next = year.installmentsCount > 0 ? [...rest, year] : rest;
      return next.sort((a, b) => b.year - a.year);
    });
  }

  private updatePreview(): void {
    const raw = this.generateForm.getRawValue();
    this.generatePreview.set(
      ipvaSplitPreview(ptBrMoneyCents(raw.totalReais), Number(raw.installments), (c) =>
        this.formatCurrency(c),
      ),
    );
  }

  // ---- apresentação ------------------------------------------------------

  protected chipFor(row: IpvaInstallment): { label: string; tone: StatusChipTone } {
    return STATUS_CHIP[row.status] ?? STATUS_CHIP.PENDING;
  }

  protected rowDetail(row: IpvaInstallment): string {
    if (row.paid) {
      const paid = row.paidAmountCents ?? row.amountCents;
      const when = `Paga em ${this.formatDate(row.paidDate)}`;
      // O valor pago só aparece quando difere do devido — aí é informação.
      return paid !== row.amountCents ? `${when} · ${this.formatCurrency(paid)}` : when;
    }
    return `Vence ${this.formatDate(row.dueDate)}`;
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return 'Sem valor';
    return BRL.format(cents / 100);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { CompareRow, CompareRows } from '../../../components/core/compare-rows/compare-rows';
import { DateField, todayInSaoPaulo } from '../../../components/core/date-field/date-field';
import { ReasonOption, ReasonPicker } from '../../../components/core/reason-picker/reason-picker';
import { ApiErrorService } from '../../../services/api-error.service';
import {
  AdminActionReason,
  AdminChargeActionResult,
  AdminChargeListItem,
  AsaasComparison,
  AsaasComparisonField,
  AsaasCustomerSyncResult,
  DriverNameCorrectionResult,
} from '../../../types/admin-charges.types';
import { AdminChargesService } from './admin-charges.service';

/** Tipos que o admin pode registrar como recebidos por fora. */
const RECEIVABLE_KINDS = ['CAUCAO', 'RENTAL_PERIOD', 'RENTAL_TOTAL'];

export type ChargeActionMode = 'menu' | 'compare' | 'received' | 'retry' | 'name' | 'sync';

export const ADMIN_ACTION_REASONS: ReasonOption<AdminActionReason>[] = [
  { value: 'PAID_OUTSIDE_GATEWAY', label: 'Pago fora do Asaas', hint: 'Dinheiro ou PIX direto ao dono' },
  { value: 'CUSTOMER_REQUEST', label: 'Pedido do cliente' },
  { value: 'DATA_CORRECTION', label: 'Correção de dado' },
  { value: 'GATEWAY_FAILURE', label: 'Falha de emissão' },
  { value: 'OTHER', label: 'Outro' },
];

const FIELD_LABELS: Record<string, string> = {
  value: 'Valor',
  originalValue: 'Valor original',
  discount: 'Desconto',
  dueDate: 'Vencimento',
  originalDueDate: 'Vencimento original',
  status: 'Situação',
};

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Pendente',
  PAST_DUE: 'Atrasada',
  FAILED: 'Falhou',
  PAID: 'Paga',
  CANCELED: 'Cancelada',
  REFUNDED: 'Estornada',
  OVERDUE: 'Vencida',
  RECEIVED: 'Recebida',
  CONFIRMED: 'Confirmada',
  RECEIVED_IN_CASH: 'Recebida em dinheiro',
  AWAITING_RISK_ANALYSIS: 'Em análise',
  REFUND_REQUESTED: 'Estorno pedido',
  REFUND_IN_PROGRESS: 'Estornando',
  DELETED: 'Removida',
};

const TITLES: Record<ChargeActionMode, string> = {
  menu: 'Ações da cobrança',
  compare: 'Comparar com o Asaas',
  received: 'Recebida por fora',
  retry: 'Tentar de novo',
  name: 'Corrigir nome do motorista',
  sync: 'Atualizar cliente no Asaas',
};

/**
 * Ações de admin sobre UMA cobrança, sem impersonar (admin v2 P1). Composta só
 * de peças compartilhadas: {@link BottomSheet}, {@link CompareRows},
 * {@link ReasonPicker}. Nenhuma notificação ao cliente (D2).
 *
 * Regras que a tela espelha (o backend é quem garante):
 * - "Tentar de novo" só aparece para FAILED com hoje ≤ vencimento; atrasada
 *   nunca é reemitida nem re-datada (o backend devolve 409 se tentarem).
 * - "Recebida por fora" só para caução (o núcleo do dono só cancela caução).
 * - Corrigir nome → oferece "Atualizar no Asaas" em seguida.
 */
@Component({
  selector: 'app-charge-actions-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, CompareRows, ReasonPicker, DateField, AlertBanner],
  templateUrl: './charge-actions-sheet.html',
})
export class ChargeActionsSheet implements OnInit {
  private readonly service = inject(AdminChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly item = input.required<AdminChargeListItem>();
  readonly initialMode = input<ChargeActionMode>('menu');
  readonly closed = output<void>();
  /** Algo mudou do lado do dinheiro/cadastro: a lista deve recarregar. */
  readonly changed = output<void>();
  /** "Ver aluguel" (sessão somente leitura) — quem abre é a página. */
  readonly openRental = output<void>();

  private readonly sheet = viewChild(BottomSheet);

  protected readonly reasons = ADMIN_ACTION_REASONS;
  protected readonly formId = 'charge-action-form';
  protected readonly mode = signal<ChargeActionMode>('menu');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reason = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly newName = signal('');
  /** "Recebida por fora": dia do recebimento (yyyy-MM-dd), nunca futuro (fuso de São Paulo). */
  protected readonly receivedOn = signal('');
  protected readonly today = signal(todayInSaoPaulo());
  private readonly dateField = viewChild(DateField);

  protected readonly comparison = signal<AsaasComparison | null>(null);
  protected readonly actionResult = signal<AdminChargeActionResult | null>(null);
  protected readonly nameResult = signal<DriverNameCorrectionResult | null>(null);
  protected readonly syncResult = signal<AsaasCustomerSyncResult | null>(null);

  protected readonly title = computed(() => TITLES[this.mode()]);
  protected readonly subtitle = computed(() => {
    const i = this.item();
    return `${i.companyName} · ${i.driverName ?? 'motorista não identificado'}`;
  });

  /** "Tentar de novo": FAILED e hoje ≤ vencimento (daysOverdue ≤ 0). */
  protected readonly canRetry = computed(
    () => this.item().status === 'FAILED' && this.item().dueDate !== null && this.item().daysOverdue <= 0,
  );
  /**
   * "Recebida por fora" (só admin, dono 29/10/2026): caução ou parcela do aluguel, PENDENTE ou
   * ATRASADA. Multa e cobrança com falha não. O backend confere tudo de novo.
   */
  protected readonly canReceive = computed(() => {
    const i = this.item();
    return RECEIVABLE_KINDS.includes(i.kind) && (i.status === 'PENDING' || i.status === 'PAST_DUE');
  });
  protected readonly isCaucao = computed(() => this.item().kind === 'CAUCAO');
  protected readonly hasDriver = computed(() => this.item().driverId !== null);
  protected readonly isOverdue = computed(() => this.item().daysOverdue > 0);

  protected readonly compareRows = computed<CompareRow[]>(() =>
    (this.comparison()?.fields ?? []).map((f) => ({
      key: f.key,
      label: FIELD_LABELS[f.key] ?? f.key,
      left: this.format(f, f.local),
      right: this.format(f, f.asaas),
      divergent: f.divergent,
    })),
  );

  protected readonly canSubmit = computed(() => {
    if (this.busy() || !this.reason()) return false;
    if (this.mode() === 'received') {
      const v = this.receivedOn();
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= this.today() && (this.dateField()?.valid() ?? true);
    }
    if (this.mode() === 'name') {
      const n = this.newName().trim();
      return n.length > 0 && n.length <= 180 && n !== (this.item().driverName ?? '').trim();
    }
    return true;
  });

  protected readonly showsForm = computed(() => {
    const m = this.mode();
    if (m === 'received' || m === 'retry') return this.actionResult() === null;
    if (m === 'name') return this.nameResult() === null;
    if (m === 'sync') return this.syncResult() === null;
    return false;
  });

  ngOnInit(): void {
    this.go(this.initialMode());
  }

  protected go(mode: ChargeActionMode): void {
    this.error.set(null);
    this.actionResult.set(null);
    this.syncResult.set(null);
    if (mode !== 'sync') this.nameResult.set(null);
    if (mode === 'name') this.newName.set(this.item().driverName ?? '');
    if (mode === 'received') {
      this.today.set(todayInSaoPaulo());
      this.receivedOn.set(this.today());
    }
    if (mode === 'received') this.reason.set('PAID_OUTSIDE_GATEWAY');
    else if (mode === 'name' || mode === 'sync') this.reason.set('DATA_CORRECTION');
    else this.reason.set(null);
    this.note.set('');
    this.mode.set(mode);
    if (mode === 'compare') this.compare();
  }

  protected close(): void {
    this.sheet()?.requestClose();
  }

  protected compare(): void {
    this.comparison.set(null);
    this.run(this.service.compareWithAsaas(this.item().chargeId), (res) => this.comparison.set(res), false);
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const body = { reason: this.reason() as AdminActionReason, note: this.note().trim() || null };
    const item = this.item();
    switch (this.mode()) {
      case 'received':
        this.run(
          this.service.markReceivedOutside(item.chargeId, { ...body, receivedOn: this.receivedOn() }),
          (r) => this.actionResult.set(r),
          true,
        );
        break;
      case 'retry':
        this.run(this.service.retry(item.chargeId, body), (r) => this.actionResult.set(r), true);
        break;
      case 'name':
        this.run(
          this.service.correctDriverName(item.driverId!, { ...body, name: this.newName().trim() }),
          (r) => this.nameResult.set(r),
          true,
        );
        break;
      case 'sync':
        this.run(this.service.syncDriverAsaasCustomer(item.driverId!, body), (r) => this.syncResult.set(r), false);
        break;
    }
  }

  /** Depois de corrigir o nome: segue direto para o PUT no Asaas, mantendo o motivo. */
  protected continueToSync(): void {
    const keep = this.reason();
    this.syncResult.set(null);
    this.error.set(null);
    this.mode.set('sync');
    this.reason.set(keep ?? 'DATA_CORRECTION');
    this.note.set('');
  }

  /** Enter confirma de qualquer controle (inclusive rádio), menos da observação, onde quebra linha. */
  protected onEnter(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    this.submit();
  }

  protected setName(event: Event): void {
    this.newName.set((event.target as HTMLInputElement).value);
  }

  protected outcomeText(r: AdminChargeActionResult): string {
    if (r.action === 'RETRY') {
      return r.done
        ? 'Cobrança gerada de novo no Asaas, com o mesmo vencimento.'
        : r.outcome === 'ALREADY_PAID'
          ? 'O Asaas já tinha o pagamento: a cobrança foi baixada, nada foi emitido.'
          : 'Nada foi emitido (' + r.outcome + ').';
    }
    if (r.done) {
      return (
        'Cobrança cancelada no Asaas e registrada como recebida por fora em ' +
        this.br(this.receivedOn()) +
        '. O vencimento não mudou.'
      );
    }
    return r.hint ?? 'Nada foi registrado (' + r.outcome + ').';
  }

  private run<T>(call: Observable<T>, onOk: (res: T) => void, changesData: boolean): void {
    this.busy.set(true);
    this.error.set(null);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.busy.set(false);
        onOk(res);
        if (changesData) this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível concluir. Nada foi alterado.'));
        // O erro mora no topo da folha; traz ele à vista se a pessoa rolou até o fim.
        setTimeout(() =>
          this.host.nativeElement
            .querySelector('[data-testid="action-error"]')
            ?.scrollIntoView?.({ block: 'nearest' }),
        );
      },
    });
  }

  protected br(iso: string): string {
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  /** "Ver aluguel" no menu: fecha a folha e deixa a página abrir a sessão somente leitura. */
  protected viewRental(): void {
    this.openRental.emit();
  }

  private format(f: AsaasComparisonField, raw: string | null): string | null {
    if (raw === null) return null;
    if (f.kind === 'CENTS') {
      const n = Number(raw);
      return Number.isFinite(n)
        ? (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : raw;
    }
    if (f.kind === 'DATE') {
      const [y, m, d] = raw.split('-');
      return d && m && y ? `${d}/${m}/${y}` : raw;
    }
    if (f.key === 'status') return STATUS_TEXT[raw] ?? raw;
    return raw;
  }
}

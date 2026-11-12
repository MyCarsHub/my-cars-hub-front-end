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
import { parseApiError } from '../../../services/api-error';
import { NotificationService } from '../../../services/notification.service';
import {
  AdminActionReason,
  AdminCancelChargeResult,
  AdminChargeActionResult,
  AdminChargeListItem,
  AsaasComparison,
  AsaasComparisonField,
  AsaasCustomerSyncResult,
  DriverNameCorrectionResult,
} from '../../../types/admin-charges.types';
import { AdminChargesService } from './admin-charges.service';
import {
  cancelConfirmationCode,
  cancelConfirmationMatches,
  canCancelCharge,
  canReceiveCharge,
  canRetryCharge,
  isOverdueCharge,
} from './charge-action-rules';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';


export type ChargeActionMode = 'menu' | 'compare' | 'received' | 'retry' | 'name' | 'sync' | 'cancel';

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
  RENEGOTIATED: 'Renegociada',
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
  cancel: 'Cancelar cobrança',
};

/** Recusas estáveis do cancelamento (FEAT-0552) em português claro; o resto cai na mensagem do servidor. */
const CANCEL_ERROR_BY_CODE: Record<string, string> = {
  CANCEL_CHARGE_PAID: 'Esta cobrança já foi paga e não pode ser cancelada. Nada foi alterado.',
  CANCEL_CHARGE_DISPUTED: 'Esta cobrança está em disputa e não pode ser cancelada. Nada foi alterado.',
  CANCEL_CHARGE_NOT_OPEN:
    'Só cobrança em aberto (pendente, atrasada ou com falha) pode ser cancelada. Nada foi alterado.',
  CANCEL_REASON_REQUIRED: 'Cobrança vencida: escolha o motivo do cancelamento.',
  CANCEL_CONFIRMATION_REQUIRED: 'Cobrança vencida: digite o código da cobrança para confirmar.',
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
  private readonly notify = inject(NotificationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly item = input.required<AdminChargeListItem>();
  readonly initialMode = input<ChargeActionMode>('menu');
  /** Lote 2A: o menu da folha segue o papel (o servidor confere de novo). */
  protected readonly caps = inject(AdminCapabilitiesService);
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
  /** "Cancelar cobrança": código digitado (cobrança vencida). */
  protected readonly confirmation = signal('');
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
  protected readonly canRetry = computed(() => canRetryCharge(this.item()));
  /**
   * "Recebida por fora" (só admin, dono 29/10/2026): caução ou parcela do aluguel, PENDENTE ou
   * ATRASADA. Multa e cobrança com falha não. O backend confere tudo de novo.
   */
  protected readonly canReceive = computed(() => canReceiveCharge(this.item()));
  protected readonly isCaucao = computed(() => this.item().kind === 'CAUCAO');
  protected readonly hasDriver = computed(() => this.item().driverId !== null);
  protected readonly isOverdue = computed(() => this.item().daysOverdue > 0);
  /** Só o Dono (cobranca.cancelar) e cobrança em aberto; o servidor confere de novo. */
  protected readonly canCancel = computed(
    () => canCancelCharge(this.item()) && this.caps.can('cobranca.cancelar'),
  );
  /** Vencida: motivo e código digitado são obrigatórios. */
  protected readonly cancelNeedsProof = computed(() => isOverdueCharge(this.item()));
  protected readonly confirmationCode = computed(() => cancelConfirmationCode(this.item().chargeId));

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
    if (this.busy()) return false;
    if (this.mode() === 'cancel') {
      if (!this.canCancel()) return false;
      if (!this.cancelNeedsProof()) return true;
      return !!this.reason() && cancelConfirmationMatches(this.item().chargeId, this.confirmation());
    }
    if (!this.reason()) return false;
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
    if (m === 'cancel') return true;
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
    this.confirmation.set('');
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
    if (this.mode() === 'cancel') {
      this.cancelCharge();
      return;
    }
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

  /**
   * FEAT-0553: cancela/exclui a cobrança. Decisão do dono (06/11/2026): ação deliberada e auditada,
   * a única que alcança uma cobrança vencida. Sem atualização otimista: a lista só muda depois da resposta.
   */
  private cancelCharge(): void {
    if (this.busy()) return;
    const item = this.item();
    const proof = this.cancelNeedsProof();
    const note = this.note().trim();
    this.busy.set(true);
    this.error.set(null);
    this.service
      .cancelCharge(item.chargeId, {
        companyId: item.companyId,
        reason: proof ? (this.reason() as AdminActionReason) : null,
        note: proof && note ? note : null,
        confirmation: proof ? this.confirmation().trim() : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.announceCancel(res);
          this.changed.emit();
          this.close();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.error.set(this.cancelErrorText(err));
          setTimeout(() =>
            this.host.nativeElement
              .querySelector('[data-testid="action-error"]')
              ?.scrollIntoView?.({ block: 'nearest' }),
          );
        },
      });
  }

  /** Um aviso em português simples por desfecho; o que não mudou diz que não mudou. */
  protected announceCancel(res: AdminCancelChargeResult): void {
    switch (res.outcome) {
      case 'CANCELED_AT_GATEWAY':
        this.notify.success('Cobrança cancelada no Asaas.');
        break;
      case 'CANCELED_ALREADY_GONE':
        this.notify.success('Já estava removida no Asaas; a cobrança foi cancelada aqui.');
        break;
      case 'CANCELED_NO_GATEWAY_LINK':
        this.notify.success('Cobrança cancelada (sem vínculo no Asaas).');
        break;
      case 'ALREADY_PAID_AT_GATEWAY':
        this.notify.info('O Asaas mostra esta cobrança como paga; nada foi alterado.');
        break;
      case 'GATEWAY_FAILED':
        this.notify.warning(
          'Não foi possível remover no Asaas agora; a cobrança continua aberta e a remoção foi reagendada.',
        );
        break;
      default:
        this.notify.info(res.hint ?? 'Cobrança atualizada.');
    }
  }

  protected cancelErrorText(err: HttpErrorResponse): string {
    const parsed = parseApiError(err);
    const byCode = parsed.code ? CANCEL_ERROR_BY_CODE[parsed.code] : undefined;
    if (byCode) {
      this.apiErrors.claim(err);
      return byCode;
    }
    if (parsed.status === 404) {
      this.apiErrors.claim(err);
      return 'Cobrança não encontrada nesta empresa. Nada foi alterado.';
    }
    if (parsed.status === 403) {
      this.apiErrors.claim(err);
      return 'Só o Dono da plataforma pode cancelar cobranças. Nada foi alterado.';
    }
    return this.apiErrors.messageFor(err, 'Não foi possível cancelar a cobrança. Nada foi alterado.');
  }

  protected setConfirmation(event: Event): void {
    this.confirmation.set((event.target as HTMLInputElement).value);
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

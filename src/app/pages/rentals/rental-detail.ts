import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { MarkPaidDialog } from '../../components/core/mark-paid-dialog/mark-paid-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { RentalProgressChecklist } from './documents/rental-progress-checklist';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import {
  CancelRentalPayload,
  CompleteRentalPayload,
  RentalChargeDto,
  RentalResponseDto,
  RentalStatus,
  RentalStatusHistoryDto,
  billingFrequencyLabel,
  caucaoRefundMethodLabel,
  chargeKindLabel,
  chargeStatusInfo,
  rentalRateLabel,
  rentalStatusInfo,
} from '../../types/rental.types';
import { EndRentalDialog, EndRentalDialogPayload } from './components/end-rental-dialog/end-rental-dialog';
import { RENTAL_STATUS_META } from '../../utils/status-maps';

@Component({
  selector: 'app-rental-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    MarkPaidDialog,
    DetailActions,
    RentalProgressChecklist,
    EndRentalDialog,
    AlertBanner,
  ],
  templateUrl: './rental-detail.html',
})
export class RentalDetail implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  private readonly externalNav = inject(ExternalNavigationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly rental = signal<RentalResponseDto | null>(null);
  protected readonly loading = signal(false);
  /** Falha ao CARREGAR o aluguel — banner com CTA de volta pra lista. */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha de uma OPERACAO da tela (cancelar, concluir, ativar, excluir, caucao,
   * cobrancas, retry). Banner inline, nunca toast: o interceptor nao toasta 4xx e
   * `messageFor()` reivindica o erro, desarmando o safety net.
   */
  protected readonly actionError = signal<string | null>(null);

  protected readonly vehiclePlate = signal<string>('—');
  protected readonly vehicleLabel = signal<string>('');
  protected readonly driverNameSig = signal<string>('—');

  protected readonly history = signal<RentalStatusHistoryDto[]>([]);
  protected readonly historyLoading = signal(false);

  protected readonly cancelOpen = signal(false);
  protected readonly cancelBusy = signal(false);

  protected readonly completeOpen = signal(false);
  protected readonly completeBusy = signal(false);

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  /** Opt-in do dialog de exclusão. Reaberto sempre desmarcado em `askDelete()`. */
  protected readonly deleteRemoveOverdue = signal(false);

  protected readonly statusInfo = computed(() => {
    const r = this.rental();
    return r ? rentalStatusInfo(r.status) : null;
  });

  protected readonly totalDays = computed(() => {
    const r = this.rental();
    if (!r) return 0;
    const s = new Date(r.startDate + 'T00:00:00').getTime();
    const e = new Date(r.endDate + 'T00:00:00').getTime();
    const diff = Math.round((e - s) / 86_400_000);
    return diff > 0 ? diff : 1;
  });

  protected readonly canCancel = computed(() => this.rental()?.status === 'RESERVED');
  protected readonly canComplete = computed(() => this.rental()?.status === 'ACTIVE');
  /**
   * Activation is offered for every RESERVED rental — inclusive de cobrança
   * automática. Quem decide se pode ativar é o backend (`RentalService.activate`):
   * quando o direito de uso ainda não está quitado ele devolve 409 com a mensagem
   * explicando que falta a confirmação do pagamento, e essa mensagem é exibida
   * no banner via `apiErrors.messageFor`. Escondendo o botão o dono ficava sem
   * saída quando o webhook do Asaas falhava depois do pagamento entrar.
   */
  protected readonly canActivate = computed(() => this.rental()?.status === 'RESERVED');
  /**
   * RESERVED + cobrança automática: a ativação normal chega pelo webhook.
   * Aqui o botão vira uma saída de emergência — estilo secundário, não primário.
   */
  protected readonly activateIsOverride = computed(() => {
    const r = this.rental();
    return r?.status === 'RESERVED' && r?.automaticCharge === true;
  });
  protected readonly activateBusy = signal(false);
  /**
   * Variante visual do botão de ativar. String pronta (em vez de várias bindings
   * `[class.x]`) porque utilitários Tailwind com `:` — `hover:bg-*` — não são
   * nomes válidos numa binding `[class.nome]`.
   */
  protected readonly activateButtonClass = computed(() =>
    this.activateIsOverride()
      ? 'border border-blue-200 text-blue-700 hover:bg-blue-50'
      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
  );
  /** Rótulo do botão de ativar — override tem copy própria pra não parecer o fluxo normal. */
  protected readonly activateLabel = computed(() => {
    if (this.activateBusy()) return 'Ativando…';
    return this.activateIsOverride() ? 'Ativar mesmo assim' : 'Marcar como ativo';
  });

  // ------------------------------------------------------------------
  // Cronograma de cobrança (RENTAL_PERIOD + RENTAL_TOTAL, apenas).
  // CAUCAO fica em card dedicado ACIMA — não conta nos KPIs do cronograma.
  // ------------------------------------------------------------------

  /**
   * Cobranças ordenadas por `periodIndex` ascendente. Sem index cai por
   * dueDate quando disponível. CAUCAO é excluída — vive no card próprio.
   */
  protected readonly scheduleCharges = computed<RentalChargeDto[]>(() => {
    const r = this.rental();
    if (!r) return [];
    return r.charges
      .filter((c) => c.kind !== 'CAUCAO')
      .slice()
      .sort((a, b) => {
        const ai = a.periodIndex ?? Number.MAX_SAFE_INTEGER;
        const bi = b.periodIndex ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return 0;
      });
  });

  /**
   * Charge da caução exibida no card dedicado.
   *
   * Regra:
   *  1. Se existir alguma CAUCAO em status "vivo" (PENDING/PAID/PAST_DUE/FAILED),
   *     retorna a mais recente delas — é o ciclo em andamento e deve dominar
   *     a UI (mostra status + ações).
   *  2. Senão, se existir alguma CAUCAO terminal (CANCELED/REFUNDED/RELEASED),
   *     retorna a mais recente para preservar histórico visível.
   *  3. Senão, `null` — o template mostra CTA ou empty state.
   *
   * Backend ordena `charges` por `createdAt asc`, então "mais recente" = último
   * elemento da lista filtrada.
   */
  protected readonly caucaoCharge = computed<RentalChargeDto | null>(() => {
    const r = this.rental();
    if (!r) return null;
    const all = r.charges.filter((c) => c.kind === 'CAUCAO');
    if (all.length === 0) return null;
    const open = all.filter((c) => this.OPEN_CAUCAO_STATUSES.includes(c.status));
    if (open.length > 0) return open[open.length - 1];
    return all[all.length - 1];
  });

  /** True quando já existe uma linha CAUCAO (usado no card de caução). */
  protected readonly hasCaucaoRow = computed<boolean>(() => this.caucaoCharge() !== null);

  /** SUM(amount) — status='PAID' em RENTAL_PERIOD + RENTAL_TOTAL (sem CAUCAO). */
  protected readonly paidCents = computed<number>(() =>
    this.scheduleCharges()
      .filter((c) => c.status === 'PAID')
      .reduce((acc, c) => acc + c.amount, 0),
  );

  /** SUM(amount) — status PENDING/PAST_DUE/FAILED em RENTAL_PERIOD + RENTAL_TOTAL. */
  protected readonly remainingCents = computed<number>(() =>
    this.scheduleCharges()
      .filter((c) => c.status === 'PENDING' || c.status === 'PAST_DUE' || c.status === 'FAILED')
      .reduce((acc, c) => acc + c.amount, 0),
  );

  protected readonly paidCount = computed<number>(
    () => this.scheduleCharges().filter((c) => c.status === 'PAID').length,
  );

  protected readonly totalCount = computed<number>(() => this.scheduleCharges().length);

  protected readonly overdueCount = computed<number>(
    () => this.scheduleCharges().filter((c) => c.status === 'PAST_DUE').length,
  );

  /**
   * Progresso baseado em contagem de períodos pagos vs. total — mesmo
   * modelo do financing-detail.
   */
  protected readonly progressPct = computed<number>(() => {
    const total = this.totalCount();
    if (total <= 0) return 0;
    return Math.min(100, Math.round((this.paidCount() / total) * 100));
  });

  /**
   * Próxima cobrança em aberto (PENDING/PAST_DUE), pela menor `dueDate`.
   * Fallback: primeira cobrança não paga em ordem de período.
   */
  protected readonly nextCharge = computed<RentalChargeDto | null>(() => {
    const open = this.scheduleCharges().filter(
      (c) => c.status === 'PENDING' || c.status === 'PAST_DUE',
    );
    if (open.length === 0) return null;
    const withDate = open.filter((c) => !!c.dueDate);
    if (withDate.length > 0) {
      return withDate.slice().sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0];
    }
    return open[0];
  });

  protected readonly hasSchedule = computed<boolean>(() => this.totalCount() > 0);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.rentalService.getById(id).subscribe({
      next: (r) => {
        this.rental.set(r);
        this.loading.set(false);
        this.loadVehicle(r.vehicleId);
        this.loadDriver(r.driverId);
        this.loadHistory(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Aluguel não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  private loadVehicle(id: string): void {
    this.vehiclesService.getOne(id).subscribe({
      next: (v) => {
        this.vehiclePlate.set(this.formatPlate(v.plate));
        this.vehicleLabel.set(`${v.brand} ${v.model}`);
      },
      error: () => {
        this.vehiclePlate.set('—');
        this.vehicleLabel.set('');
      },
    });
  }

  private loadDriver(id: string): void {
    this.driverService.getOne(id).subscribe({
      next: (d) => this.driverNameSig.set(d.name),
      error: () => this.driverNameSig.set('—'),
    });
  }

  protected askCancel(): void {
    this.cancelOpen.set(true);
  }
  protected cancelCancel(): void {
    if (this.cancelBusy()) return;
    this.cancelOpen.set(false);
  }
  protected confirmCancel(event: EndRentalDialogPayload): void {
    const r = this.rental();
    if (!r) return;
    const payload: CancelRentalPayload = {
      canceledAt: event.date,
      removeOverdueCharges: event.removeOverdueCharges,
    };
    if (event.endReason) payload.endReason = event.endReason;
    if (event.caucaoRefund) payload.caucaoRefund = event.caucaoRefund;
    this.actionError.set(null);
    this.cancelBusy.set(true);
    this.rentalService.cancel(r.id, payload).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.cancelBusy.set(false);
        this.cancelOpen.set(false);
        this.notifications.push('success', 'Aluguel cancelado.');
        this.refreshHistoryAfterTransition();
      },
      error: (err: HttpErrorResponse) => {
        this.cancelBusy.set(false);
        this.cancelOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível cancelar o aluguel.'));
      },
    });
  }

  protected askComplete(): void {
    this.completeOpen.set(true);
  }
  protected cancelComplete(): void {
    if (this.completeBusy()) return;
    this.completeOpen.set(false);
  }
  protected confirmComplete(event: EndRentalDialogPayload): void {
    const r = this.rental();
    if (!r) return;
    const payload: CompleteRentalPayload = {
      completedAt: event.date,
      removeOverdueCharges: event.removeOverdueCharges,
    };
    if (event.endReason) payload.endReason = event.endReason;
    if (event.caucaoRefund) payload.caucaoRefund = event.caucaoRefund;
    this.actionError.set(null);
    this.completeBusy.set(true);
    this.rentalService.complete(r.id, payload).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.completeBusy.set(false);
        this.completeOpen.set(false);
        this.notifications.push('success', 'Aluguel concluído.');
        this.refreshHistoryAfterTransition();
      },
      error: (err: HttpErrorResponse) => {
        this.completeBusy.set(false);
        this.completeOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível concluir o aluguel.'));
      },
    });
  }

  protected activate(): void {
    const r = this.rental();
    if (!r || this.activateBusy()) return;
    this.actionError.set(null);
    this.activateBusy.set(true);
    this.rentalService.activate(r.id).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.activateBusy.set(false);
        this.notifications.push('success', 'Aluguel marcado como ativo.');
        this.refreshHistoryAfterTransition();
      },
      error: (err: HttpErrorResponse) => {
        this.activateBusy.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível ativar o aluguel.'));
      },
    });
  }

  protected askDelete(): void {
    this.deleteRemoveOverdue.set(false);
    this.deleteOpen.set(true);
  }
  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }
  protected onDeleteRemoveOverdueChange(checked: boolean): void {
    this.deleteRemoveOverdue.set(checked);
  }
  protected confirmDelete(): void {
    const r = this.rental();
    if (!r) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.rentalService.remove(r.id, this.deleteRemoveOverdue()).subscribe({
      next: () => {
        this.notifications.push('success', 'Aluguel excluído.');
        this.router.navigate(['/alugueis']);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível excluir o aluguel.'),
        );
      },
    });
  }

  protected payCharge(charge: RentalChargeDto): void {
    if (!charge.checkoutUrl) return;
    this.externalNav.openExternal(charge.checkoutUrl);
  }

  protected chargeKindLabel(kind: RentalChargeDto['kind']): string {
    return chargeKindLabel(kind);
  }

  /**
   * Número exibido no badge da linha do cronograma. Prefere `periodIndex`
   * quando presente (backend seta pra RENTAL_PERIOD); senão usa a posição
   * na lista ordenada +1.
   */
  protected periodNumber(charge: RentalChargeDto, indexInList: number): number {
    return charge.periodIndex != null ? charge.periodIndex + 1 : indexInList + 1;
  }

  /**
   * Badge label da linha do cronograma. CAUCAO tem badge fixo "C" (visualmente
   * marca como cobrança extra, one-off); demais linhas usam `periodNumber`.
   */
  protected rowBadge(charge: RentalChargeDto, indexInList: number): string {
    if (charge.kind === 'CAUCAO') return 'C';
    return String(this.periodNumber(charge, indexInList));
  }

  protected trackCharge(_: number, c: RentalChargeDto): string {
    return c.id;
  }

  protected billingFrequencyLabel(f: RentalResponseDto['billingFrequency']): string {
    return billingFrequencyLabel(f);
  }

  /** Dynamic label for the `periodRate` field based on billing frequency. */
  protected rateLabel(f: RentalResponseDto['billingFrequency']): string {
    return rentalRateLabel(f);
  }

  protected chargeStatusInfo(status: RentalChargeDto['status']): { label: string; chip: string } {
    return chargeStatusInfo(status);
  }

  protected canPayCharge(charge: RentalChargeDto): boolean {
    return charge.status === 'PENDING' && !!charge.checkoutUrl;
  }

  protected canRetryCharge(charge: RentalChargeDto): boolean {
    return charge.status === 'FAILED';
  }

  protected readonly retrying = signal<string | null>(null);

  // ------- Caução: marcar/desmarcar como paga (placeholder, sem charge) -------
  //
  // Quando o rental é manual (`automaticCharge=false`), tem `caucaoAmount>0`
  // e ainda NÃO existe charge CAUCAO, o operador pode marcar a caução como
  // paga direto — o backend cria a charge inline com status PAID e flipa
  // `rental.caucaoPaid=true`. Se já existe uma CAUCAO charge, o fluxo padrão
  // (`canMarkAsPaid` / `askMarkPaid`) é usado.
  protected readonly markCaucaoOpen = signal(false);
  protected readonly unmarkCaucaoOpen = signal(false);
  protected readonly caucaoBusy = signal(false);

  /**
   * Guard do botão "Marcar como paga" no branch placeholder (rental manual
   * com caução configurada e ainda sem charge CAUCAO). O backend cria a
   * charge inline com status PAID e flipa `rental.caucaoPaid=true`.
   */
  protected readonly canMarkCaucaoAsPaidPlaceholder = computed<boolean>(() => {
    const r = this.rental();
    if (!r) return false;
    if (r.automaticCharge !== false) return false;
    if (r.caucaoAmount <= 0) return false;
    if (this.caucaoCharge()) return false;
    return !r.caucaoPaid;
  });

  /**
   * Guard do botão "Desmarcar" no branch placeholder. Só quando o rental
   * tá com `caucaoPaid=true` mas sem charge CAUCAO ativa.
   */
  protected readonly canUnmarkCaucaoPlaceholder = computed<boolean>(() => {
    const r = this.rental();
    if (!r) return false;
    if (r.automaticCharge !== false) return false;
    if (r.caucaoAmount <= 0) return false;
    if (this.caucaoCharge()) return false;
    return r.caucaoPaid;
  });

  /** Valor da caução para o dialog (em centavos). */
  protected readonly caucaoAmountCents = computed<number>(() => this.rental()?.caucaoAmount ?? 0);

  protected askMarkCaucaoAsPaid(): void {
    const r = this.rental();
    if (!r || r.automaticCharge !== false || r.caucaoAmount <= 0 || this.caucaoCharge()) return;
    this.markCaucaoOpen.set(true);
  }

  protected cancelMarkCaucaoAsPaid(): void {
    if (this.caucaoBusy()) return;
    this.markCaucaoOpen.set(false);
  }

  protected confirmMarkCaucaoAsPaid(paidAt: string): void {
    const r = this.rental();
    if (!r || this.caucaoBusy()) return;
    this.actionError.set(null);
    this.caucaoBusy.set(true);
    this.rentalService.markCaucaoAsPaid(r.id, paidAt).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.caucaoBusy.set(false);
        this.markCaucaoOpen.set(false);
        this.notifications.push('success', 'Caução marcada como paga.');
      },
      error: (err: HttpErrorResponse) => {
        this.caucaoBusy.set(false);
        this.markCaucaoOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível marcar a caução como paga.'));
      },
    });
  }

  protected askUnmarkCaucaoAsPaid(): void {
    const r = this.rental();
    if (!r || r.automaticCharge !== false || !r.caucaoPaid || this.caucaoCharge()) return;
    this.unmarkCaucaoOpen.set(true);
  }

  protected cancelUnmarkCaucaoAsPaid(): void {
    if (this.caucaoBusy()) return;
    this.unmarkCaucaoOpen.set(false);
  }

  protected confirmUnmarkCaucaoAsPaid(): void {
    const r = this.rental();
    if (!r || this.caucaoBusy()) return;
    this.actionError.set(null);
    this.caucaoBusy.set(true);
    this.rentalService.unmarkCaucaoAsPaid(r.id).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.caucaoBusy.set(false);
        this.unmarkCaucaoOpen.set(false);
        this.notifications.push('success', 'Pagamento da caução desmarcado.');
      },
      error: (err: HttpErrorResponse) => {
        this.caucaoBusy.set(false);
        this.unmarkCaucaoOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível desmarcar o pagamento da caução.'));
      },
    });
  }

  // ------- Marcar como paga (manual, apenas quando automaticCharge=false) -------
  protected readonly markPaidTarget = signal<RentalChargeDto | null>(null);
  protected readonly markPaidBusy = signal(false);

  private readonly MARK_PAID_STATUSES: ReadonlyArray<RentalChargeDto['status']> = [
    'PENDING',
    'PAST_DUE',
    'FAILED',
  ];

  /** Show "Marcar como paga" only for manual rentals + eligible charge status/kind. */
  protected canMarkAsPaid(charge: RentalChargeDto): boolean {
    const r = this.rental();
    if (!r) return false;
    if (r.automaticCharge !== false) return false;
    if (!this.MARK_PAID_STATUSES.includes(charge.status)) return false;
    return charge.kind === 'RENTAL_TOTAL' || charge.kind === 'RENTAL_PERIOD' || charge.kind === 'CAUCAO';
  }

  /** Show "Desmarcar" only for manual rentals + PAID charges. */
  protected canUnmarkAsPaid(charge: RentalChargeDto): boolean {
    const r = this.rental();
    if (!r) return false;
    if (r.automaticCharge !== false) return false;
    return charge.status === 'PAID';
  }

  protected askMarkPaid(charge: RentalChargeDto): void {
    this.markPaidTarget.set(charge);
  }

  protected cancelMarkPaid(): void {
    if (this.markPaidBusy()) return;
    this.markPaidTarget.set(null);
  }

  protected readonly markPaidEntityLabel = computed<string>(() => {
    const c = this.markPaidTarget();
    if (!c) return '';
    if (c.kind === 'CAUCAO') return 'Caução';
    if (c.periodIndex != null) return `Período ${c.periodIndex + 1}`;
    return chargeKindLabel(c.kind);
  });

  protected readonly markPaidMinDate = computed<string | undefined>(
    () => this.rental()?.startDate,
  );

  private todayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  protected readonly markPaidMaxDate = computed<string>(() => this.todayIso());
  protected readonly markPaidDefaultDate = computed<string>(() => this.todayIso());

  protected confirmMarkPaid(paidAt: string): void {
    const r = this.rental();
    const target = this.markPaidTarget();
    if (!r || !target || this.markPaidBusy()) return;
    this.actionError.set(null);
    this.markPaidBusy.set(true);
    this.rentalService.markChargeAsPaid(r.id, target.id, paidAt).subscribe({
      next: (updated) => {
        this.markPaidBusy.set(false);
        this.markPaidTarget.set(null);
        // Replace by id in-place to keep the timeline order stable.
        const current = this.rental();
        if (current) {
          this.rental.set({
            ...current,
            charges: current.charges.map((c) => (c.id === updated.id ? updated : c)),
          });
        }
        this.notifications.push('success', 'Cobrança marcada como paga.');
      },
      error: (err: HttpErrorResponse) => {
        this.markPaidBusy.set(false);
        this.markPaidTarget.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível marcar a cobrança como paga.'));
      },
    });
  }

  // ------- Desmarcar pagamento (manual, apenas quando automaticCharge=false) -------
  protected readonly unmarkPaidTarget = signal<RentalChargeDto | null>(null);
  protected readonly unmarkPaidBusy = signal(false);

  protected askUnmarkPaid(charge: RentalChargeDto): void {
    this.unmarkPaidTarget.set(charge);
  }

  protected cancelUnmarkPaid(): void {
    if (this.unmarkPaidBusy()) return;
    this.unmarkPaidTarget.set(null);
  }

  protected readonly unmarkPaidMessage = computed<string>(() => {
    const c = this.unmarkPaidTarget();
    if (!c) return '';
    const period =
      c.kind === 'CAUCAO'
        ? 'a cobrança da caução'
        : c.periodIndex != null
          ? `a cobrança do período ${c.periodIndex + 1}`
          : `a cobrança ${chargeKindLabel(c.kind)}`;
    return `Desmarcar ${period} como paga? O status voltará para pendente e a data de pagamento será limpa.`;
  });

  protected confirmUnmarkPaid(): void {
    const r = this.rental();
    const target = this.unmarkPaidTarget();
    if (!r || !target || this.unmarkPaidBusy()) return;
    this.actionError.set(null);
    this.unmarkPaidBusy.set(true);
    this.rentalService.unmarkChargeAsPaid(r.id, target.id).subscribe({
      next: (updated) => {
        this.unmarkPaidBusy.set(false);
        this.unmarkPaidTarget.set(null);
        const current = this.rental();
        if (current) {
          this.rental.set({
            ...current,
            charges: current.charges.map((c) => (c.id === updated.id ? updated : c)),
          });
        }
        this.notifications.push('success', 'Pagamento desmarcado.');
      },
      error: (err: HttpErrorResponse) => {
        this.unmarkPaidBusy.set(false);
        this.unmarkPaidTarget.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível desmarcar o pagamento.'));
      },
    });
  }

  /**
   * "Aberta" = qualquer status que ainda represente um ciclo de cobrança vivo.
   * CANCELED/REFUNDED/RELEASED (todos terminais no backend) NÃO bloqueiam nova geração.
   */
  private readonly OPEN_CAUCAO_STATUSES: ReadonlyArray<RentalChargeDto['status']> = [
    'PENDING',
    'PAID',
    'PAST_DUE',
    'FAILED',
  ];

  protected retryCharge(charge: RentalChargeDto): void {
    const r = this.rental();
    if (!r || this.retrying()) return;
    this.actionError.set(null);
    this.retrying.set(charge.id);
    this.rentalService.retryCharge(r.id, charge.id).subscribe({
      next: (res) => {
        this.retrying.set(null);
        const msg =
          res.outcome === 'RETRIED'
            ? 'Nova cobrança gerada com sucesso.'
            : res.outcome === 'ALREADY_PAID'
            ? 'Cobrança já estava paga no provedor — status sincronizado.'
            : 'Cobrança já estava reembolsada no provedor — status sincronizado.';
        this.notifications.push('success', msg);
        this.rentalService.getById(r.id).subscribe({
          next: (fresh: RentalResponseDto) => this.rental.set(fresh),
        });
      },
      error: (err: HttpErrorResponse) => {
        this.retrying.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível regerar a cobrança. Tente novamente.'));
      },
    });
  }

  private loadHistory(id: string): void {
    this.historyLoading.set(true);
    this.rentalService.history(id).subscribe({
      next: (list) => {
        this.history.set(list);
        this.historyLoading.set(false);
      },
      error: () => {
        this.history.set([]);
        this.historyLoading.set(false);
      },
    });
  }

  /**
   * Refresh history após qualquer transição de status. Chamado depois de
   * activate/cancel/complete pra manter a timeline sincronizada com o rental.
   */
  private refreshHistoryAfterTransition(): void {
    const r = this.rental();
    if (r) this.loadHistory(r.id);
  }

  protected historyStatusMeta(status: RentalStatus | null | undefined): {
    label: string;
    chip: string;
    color: string;
  } {
    if (!status) {
      return { label: 'Criado', chip: 'bg-neutral-100 text-neutral-700', color: '#6b7280' };
    }
    return RENTAL_STATUS_META[status];
  }

  // ------- Metadados de encerramento (COMPLETED / CANCELED) -------

  protected readonly isTerminal = computed<boolean>(() => {
    const s = this.rental()?.status;
    return s === 'COMPLETED' || s === 'CANCELED';
  });

  protected readonly endDateLabel = computed<string>(() => {
    const r = this.rental();
    if (!r) return '—';
    if (r.status === 'COMPLETED') return this.formatDate(r.completedAt ?? null);
    if (r.status === 'CANCELED') return this.formatDate(r.canceledAt ?? null);
    return '—';
  });

  protected readonly refundMethodLabel = computed<string>(() => {
    const r = this.rental();
    if (!r || !r.caucaoRefundMethod) return '—';
    return caucaoRefundMethodLabel(r.caucaoRefundMethod);
  });

  protected backToList(): void {
    this.router.navigate(['/alugueis']);
  }

  protected formatPlate(plate: string): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-BR');
  }

  protected formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }
}

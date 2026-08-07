import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Subject, catchError, debounceTime, switchMap } from 'rxjs';
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
  OverdueFeeSummary,
  formatLocalDateTime,
  graceHoursLabel,
  overdueFeeFormula,
  overdueRuleLabel,
} from '../../types/overdue.types';
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

  private readonly actionErrorBanner = viewChild<ElementRef<HTMLElement>>('actionErrorBanner');
  private readonly document = inject(DOCUMENT);

  /**
   * Armado SOMENTE por `activate()` antes de publicar o erro no banner.
   *
   * `actionError` é compartilhado por 9 operações da tela (cancelar, concluir,
   * excluir, caução marcar/desmarcar, cobrança marcar/desmarcar, regerar,
   * ativar). Reagir a qualquer uma delas sequestrava o usuário: um 409 ao
   * marcar uma cobrança como paga no fim da timeline rolava a página pro topo e
   * tirava o foco da lista. Só a ativação tem o problema que justificou o
   * scroll (ver `revealActivationError`), então só ela arma a flag.
   */
  private activationErrorPendingReveal = false;

  constructor() {
    /**
     * Traz o banner de erro pro campo de visão — apenas no fluxo de ativação.
     *
     * O banner mora no TOPO da página; "Marcar como ativo" (barra de ações) fica
     * depois de identificação, período, valores, KPIs, caução, cronograma e
     * histórico — várias telas de scroll abaixo no mobile. Como `messageFor()`
     * reivindica o erro e desarma o toast do safety net (`ApiErrorService`), uma
     * recusa do backend (400 status inválido, 402 assinatura, 403 papel, 404)
     * não produzia NENHUMA mudança visível perto do botão: o usuário lia isso
     * como "o botão está morto". Rolar + focar resolve pro vidente e pro
     * teclado; o `role="alert"` do próprio banner já cobria o leitor de tela.
     *
     * O efeito depende de `actionError()` (signal) e da flag (campo simples, de
     * propósito NÃO rastreado — quem manda é a origem da ação, não a mudança do
     * banner).
     */
    effect(() => {
      const message = this.actionError();
      if (!message) {
        // Toda operação limpa o banner antes de disparar; desarma junto pra
        // nunca revelar um erro de outro fluxo com uma flag velha.
        this.activationErrorPendingReveal = false;
        return;
      }
      if (!this.activationErrorPendingReveal) return;
      const el = this.actionErrorBanner()?.nativeElement;
      if (!el) return;
      this.activationErrorPendingReveal = false;
      this.revealActivationError(el);
    });

    // Pipeline da prévia da multa. `debounceTime` porque o `<input type="time">`
    // emite a cada dígito; `switchMap` porque a última escolha é a única que
    // vale. Erro NÃO derruba o stream — o operador continua podendo ajustar a
    // hora depois de uma falha de rede.
    //
    // SEM `distinctUntilChanged`, de propósito. Quem liga `overduePreviewLoading`
    // é `onOverdueReturnAtChanged`, e quem desliga é a resposta; um valor
    // repetido engolido pelo operador deixava o loading ligado para sempre e o
    // botão de concluir travado — o que acontecia ao reabrir o popup no mesmo
    // minuto e ao apertar "Tentar de novo". O `debounceTime` já colapsa a
    // rajada de digitação, e o GET é idempotente: repetir custa uma consulta.
    this.overdueReturnAt
      .pipe(
        debounceTime(250),
        switchMap((returnedAt) => {
          const id = this.rental()?.id;
          if (!id) return EMPTY;
          return this.rentalService.overduePreview(id, returnedAt).pipe(
            catchError((err: HttpErrorResponse) => {
              this.overduePreviewLoading.set(false);
              this.overduePreview.set(null);
              this.overduePreviewError.set(
                this.apiErrors.messageFor(err, 'Não foi possível calcular a multa por atraso.'),
              );
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((summary) => {
        this.overduePreviewLoading.set(false);
        this.overduePreviewError.set(null);
        this.overduePreview.set(summary);
      });
  }

  /**
   * Rola + foca o banner, mas SÓ quando ele está fora do viewport.
   *
   * O botão de ativar do checklist fica a menos de uma tela do banner: com os
   * dois visíveis o scroll mexia a página à toa e roubava o foco do botão que
   * o usuário quer clicar de novo. `scrollIntoView` sem `behavior` explícito
   * herda o `scroll-behavior` do CSS — que `styles.css` reseta para `auto`
   * sob `prefers-reduced-motion: reduce`.
   */
  private revealActivationError(el: HTMLElement): void {
    if (this.isInViewport(el)) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }

  /** Interseção vertical do elemento com o viewport (uma borda dentro já conta). */
  private isInViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    const viewportHeight = this.document.documentElement.clientHeight;
    return rect.bottom > 0 && rect.top < viewportHeight;
  }

  protected readonly vehiclePlate = signal<string>('—');
  protected readonly vehicleLabel = signal<string>('');
  protected readonly driverNameSig = signal<string>('—');

  protected readonly history = signal<RentalStatusHistoryDto[]>([]);
  protected readonly historyLoading = signal(false);

  protected readonly cancelOpen = signal(false);
  protected readonly cancelBusy = signal(false);

  protected readonly completeOpen = signal(false);
  protected readonly completeBusy = signal(false);

  // ------------------------------------------------------------------
  // Prévia da multa por atraso (V53).
  //
  // O dialog é burro: ele emite a data-e-hora escolhida e esta tela busca a
  // conta. `switchMap` porque cada mudança invalida a resposta anterior —
  // sem ele, uma resposta lenta de um horário antigo poderia sobrescrever a
  // do horário atual e o usuário confirmaria um valor que não é o dele.
  // ------------------------------------------------------------------
  protected readonly overduePreview = signal<OverdueFeeSummary | null>(null);
  protected readonly overduePreviewLoading = signal(false);
  protected readonly overduePreviewError = signal<string | null>(null);
  private readonly overdueReturnAt = new Subject<string>();

  /**
   * A multa efetivamente lançada neste aluguel. Filtra o caso "sem atraso": o
   * backend nunca lança multa de zero centavo, e mostrar um zero aqui só
   * ensinaria a ignorar o bloco quando ele importa.
   */
  protected readonly overdueFee = computed<OverdueFeeSummary | null>(() => {
    const fee = this.rental()?.overdueFee ?? null;
    return fee && fee.overdue && fee.amount > 0 ? fee : null;
  });

  /** A conta por extenso — é o que o motorista confere ao contestar. */
  protected readonly overdueFeeFormula = computed<string>(() => {
    const fee = this.overdueFee();
    return fee ? overdueFeeFormula(fee) : '';
  });

  protected readonly overdueFeeDueAtLabel = computed<string>(() =>
    formatLocalDateTime(this.overdueFee()?.dueAt),
  );

  protected readonly overdueFeeReturnedAtLabel = computed<string>(() =>
    formatLocalDateTime(this.overdueFee()?.returnedAt),
  );

  protected readonly overdueFeeGraceLabel = computed<string>(() =>
    graceHoursLabel(this.overdueFee()?.graceHours ?? 0),
  );

  protected readonly overdueFeeRuleLabel = computed<string>(() => {
    const fee = this.overdueFee();
    return fee ? overdueRuleLabel(fee.multiplierBps, fee.graceHours) : '';
  });

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
   * Ativação é oferecida para TODO aluguel RESERVED — cobrança automática
   * inclusive. Com automática a ativação normalmente chega sozinha pelo webhook
   * do Asaas; o botão continua disponível porque marcar como ativo à mão é uma
   * ação legítima do dono, não um contorno. O backend não impõe mais nenhuma
   * pré-condição de pagamento (recusa só por status, papel, tenant ou
   * assinatura), e essa recusa aparece no banner via `apiErrors.messageFor`.
   */
  protected readonly canActivate = computed(() => this.rental()?.status === 'RESERVED');
  protected readonly activateBusy = signal(false);
  protected readonly activateLabel = computed(() =>
    this.activateBusy() ? 'Ativando…' : 'Marcar como ativo',
  );

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
    // Estado limpo: nunca reabrir mostrando a conta de outra devolução.
    this.overduePreview.set(null);
    this.overduePreviewError.set(null);
    this.overduePreviewLoading.set(false);
    this.completeOpen.set(true);
  }
  protected cancelComplete(): void {
    if (this.completeBusy()) return;
    this.completeOpen.set(false);
  }

  /** Data-e-hora escolhida no dialog mudou — recalcula a prévia. */
  protected onOverdueReturnAtChanged(returnedAt: string): void {
    const r = this.rental();
    if (!r) return;
    this.overduePreviewLoading.set(true);
    this.overduePreviewError.set(null);
    this.overdueReturnAt.next(returnedAt);
  }

  protected confirmComplete(event: EndRentalDialogPayload): void {
    const r = this.rental();
    if (!r) return;
    const payload: CompleteRentalPayload = {
      completedAt: event.date,
      removeOverdueCharges: event.removeOverdueCharges,
    };
    if (event.actualReturnAt) payload.actualReturnAt = event.actualReturnAt;
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
        // Único ponto que arma o scroll+foco — ver `activationErrorPendingReveal`.
        this.activationErrorPendingReveal = true;
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
    // "M" de multa: a cobrança de atraso é one-off, não um período do
    // cronograma — numerá-la faria parecer que existe um período extra.
    if (charge.kind === 'OVERDUE_FEE') return 'M';
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

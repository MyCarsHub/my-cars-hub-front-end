import {
  DRIVER_REGISTRATION_INCOMPLETE_COPY,
  isDriverRegistrationIncomplete,
} from '../../services/driver-invite-outcome';
import { NgTemplateOutlet } from '@angular/common';
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
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Subject, catchError, debounceTime, switchMap } from 'rxjs';
import {
  isOpenChargeStatus,
  overdueUnpaidGatewayCharges,
  shouldWarnAboutGatewayCharges,
} from '../../utils/rental-charges';
import { ChargeRemovalList } from './components/charge-removal-list/charge-removal-list';
import { SupportRentalActions } from './components/support-rental-actions/support-rental-actions';
import { ImpersonationService } from '../../services/impersonation.service';
import { isToastedBySupportEditInterceptor } from '../../services/support-edit-errors';
import { BackLink } from '../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
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
import { SessionService } from '../../services/session.service';
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
  RENTAL_CHARGE_SYNC_STATE_KEY,
  ChargeCancelOutcome,
  ChargeCancelResponse,
  RentalChargeDto,
  RentalChargeRemovalDto,
  RentalSupportCancelResponse,
  RentalSupportDeleteResponse,
  RentalChargeReconcileDto,
  RentalChargeRetryDto,
  RentalChargeSyncDto,
  RentalResponseDto,
  RentalStatus,
  RentalStatusHistoryDto,
  billingFrequencyLabel,
  caucaoRefundMethodLabel,
  chargeKindLabel,
  chargeStatusInfo,
  effectiveChargeStatus,
  rentalRateLabel,
  rentalStatusInfo,
} from '../../types/rental.types';
import { EndRentalDialog, EndRentalDialogPayload } from './components/end-rental-dialog/end-rental-dialog';
import { RENTAL_STATUS_META } from '../../utils/status-maps';
import { todayInBusinessTz } from '../../utils/business-clock';

@Component({
  selector: 'app-rental-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    MarkPaidDialog,
    DetailActions,
    RentalProgressChecklist,
    EndRentalDialog,
    SupportRentalActions,
    ChargeRemovalList,
    AlertBanner,
    NgTemplateOutlet,
    ActionsMenu,
  ],
  templateUrl: './rental-detail.html',
})
export class RentalDetail implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly session = inject(SessionService);
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
    // Logo após criar o aluguel, o formulário entrega o resultado da emissão no
    // `state` da navegação. Só vale na entrada: lido aqui, enquanto a navegação
    // ainda está em curso, e nunca de `history.state` — numa recarga o aviso
    // seria repetido sobre cobranças que talvez já tenham sido regeradas.
    const syncState: unknown = this.router.currentNavigation()?.extras.state?.[
      RENTAL_CHARGE_SYNC_STATE_KEY
    ];
    if (isChargeSync(syncState) && syncState.failed > 0) this.chargeSyncNotice.set(syncState);

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

  /**
   * Resultado da emissão no gateway logo depois de criar, quando parte das
   * cobranças NÃO foi criada no Asaas (`failed > 0`). Sem isto o dono veria um
   * aluguel "criado" com menos cobranças do que pediu, sem nada que explicasse.
   */
  protected readonly chargeSyncNotice = signal<RentalChargeSyncDto | null>(null);

  /**
   * FIX-0755 — motivos DISTINTOS das cobranças FAILED, na ordem em que aparecem. É o
   * `failureReason` que o backend gravou (FIX-0753), não um texto inventado aqui: sem
   * ele o banner dizia "N cobranças falharam" e o dono não sabia o que corrigir.
   */
  private readonly failedReasons = computed<string[]>(() => {
    const reasons = (this.rental()?.charges ?? [])
      .filter((c) => c.status === 'FAILED')
      .map((c) => c.failureReason?.trim() ?? '')
      .filter((reason) => reason.length > 0);
    return [...new Set(reasons)];
  });

  protected readonly chargeSyncMessage = computed<string>(() => {
    const failed = this.chargeSyncNotice()?.failed ?? 0;
    const subject =
      failed === 1
        ? '1 cobrança não pôde ser criada no Asaas.'
        : `${failed} cobranças não puderam ser criadas no Asaas.`;
    const reasons = this.failedReasons();
    const why =
      reasons.length === 0
        ? ''
        : reasons.length === 1
          ? ` Motivo: ${reasons[0]}`
          : ` Motivos: ${reasons.join(' | ')}`;
    return (
      `${subject}${why} O aluguel foi criado e o sistema tenta criá-las de novo automaticamente. ` +
      'Para tentar agora, toque em Gerar de novo na linha de cada cobrança que falhou.'
    );
  });

  protected dismissChargeSyncNotice(): void {
    this.chargeSyncNotice.set(null);
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
  /**
   * MESMOS criterios do dialogo de encerrar (`utils/rental-charges.ts`). O aviso
   * indevido do Asaas foi relatado nos DOIS caminhos; ter um criterio so e o que
   * impede alguem consertar um e o defeito continuar vivo no outro.
   */
  protected readonly hasOverdueUnpaidCharges = computed<boolean>(() => {
    const r = this.rental();
    return !!r && overdueUnpaidGatewayCharges(r.charges, this.todayIso()).length > 0;
  });

  /**
   * A mensagem so fala do Asaas quando ha cobranca NO GATEWAY que a exclusao vai
   * tocar. Aluguel quitado, ou criado sem cobranca automatica, le so a frase que
   * importa: a acao nao pode ser desfeita.
   */
  protected readonly deleteMessage = computed<string>(() => {
    const r = this.rental();
    const base = 'Tem certeza que deseja excluir este aluguel?';
    const fim = 'Esta ação não pode ser desfeita.';
    if (!r || !shouldWarnAboutGatewayCharges(r.charges, this.todayIso())) {
      return `${base} ${fim}`;
    }
    const vencidas = this.hasOverdueUnpaidCharges()
      ? ' As vencidas e não pagas permanecem cobráveis, salvo se você marcar a opção abaixo.'
      : '';
    return `${base} As cobranças em aberto que ainda não venceram serão apagadas no Asaas; as já pagas permanecem e não são estornadas.${vencidas} ${fim}`;
  });

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

  /**
   * FEAT-0347 — sessão de EDIÇÃO do admin. Nela cancelar/excluir passam pelo
   * `app-support-rental-actions` (desfecho por cobrança, aviso de histórico pago); o botão
   * do dono não aparece em dobro. `?.` porque dublês de spec antigos não conhecem `editMode`.
   */
  private readonly impersonation = inject(ImpersonationService);
  protected readonly editSession = computed(() => this.impersonation.editMode?.() === true);
  protected readonly supportDeleteRemovals = signal<readonly RentalChargeRemovalDto[] | null>(null);
  /**
   * Cancelar, concluir e ativar são do operador: para o motorista o backend responde 403,
   * então o botão nem existe. `isDriver` vem do token e não muda durante a tela.
   */
  protected readonly canCancel = computed(
    () => this.rental()?.status === 'RESERVED' && !this.editSession() && !this.isDriver,
  );
  protected readonly canComplete = computed(
    () => this.rental()?.status === 'ACTIVE' && !this.isDriver,
  );
  /**
   * Ativação é oferecida para TODO aluguel RESERVED — cobrança automática
   * inclusive. Com automática a ativação normalmente chega sozinha pelo webhook
   * do Asaas; o botão continua disponível porque marcar como ativo à mão é uma
   * ação legítima do dono, não um contorno. O backend não impõe mais nenhuma
   * pré-condição de pagamento (recusa só por status, papel, tenant ou
   * assinatura), e essa recusa aparece no banner via `apiErrors.messageFor`.
   */
  protected readonly canActivate = computed(
    () => this.rental()?.status === 'RESERVED' && !this.isDriver,
  );
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

  /** SUM(amount) das cobrancas EM ABERTO em RENTAL_PERIOD + RENTAL_TOTAL. */
  protected readonly remainingCents = computed<number>(() =>
    this.scheduleCharges()
      .filter((c) => isOpenChargeStatus(c.status))
      .reduce((acc, c) => acc + c.amount, 0),
  );

  protected readonly paidCount = computed<number>(
    () => this.scheduleCharges().filter((c) => c.status === 'PAID').length,
  );

  protected readonly totalCount = computed<number>(() => this.scheduleCharges().length);

  /**
   * Data de referência do atraso, congelada na montagem da tela.
   *
   * Um sinal (e não `todayInBusinessTz()` solto dentro do `computed`) pra que
   * o chip e o contador leiam exatamente o MESMO "hoje": se cada leitura
   * chamasse o relógio por conta própria, uma virada de meia-noite entre duas
   * delas deixaria o badge "N atrasada(s)" discordando dos chips renderizados.
   */
  private readonly today = signal<string>(todayInBusinessTz());

  /**
   * Conta exatamente as cobranças que renderizam o chip "Atrasada" — inclui as
   * derivadas por `dueDate`, não só as que o webhook do Asaas marcou.
   */
  protected readonly overdueCount = computed<number>(
    () =>
      this.scheduleCharges().filter(
        (c) => effectiveChargeStatus(c, this.today()) === 'PAST_DUE',
      ).length,
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
   * Próxima cobrança EM ABERTO, pela menor `dueDate`. Fallback: primeira não
   * paga em ordem de período.
   *
   * Lê o mesmo `isOpenChargeStatus` do resto: antes esta lista ignorava FAILED
   * enquanto `remainingCents`, dez linhas acima, já o somava. O mesmo arquivo
   * discordava de si — e o efeito era apontar como "próxima" uma cobrança mais
   * nova, escondendo uma vencida e ainda cobrável.
   */
  protected readonly nextCharge = computed<RentalChargeDto | null>(() => {
    const open = this.scheduleCharges().filter((c) => isOpenChargeStatus(c.status));
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
        if (this.isDriver) {
          // `/v1/vehicles/{id}` e `/v1/drivers/{id}` sao 403 para o motorista: chamar
          // so produzia dois erros e "—" nos campos. Placa, modelo e nome vem da linha
          // da lista (que agora os carrega), quando ele chegou por ela.
          this.applyIdentityFromList(r.id);
        } else {
          this.loadVehicle(r.vehicleId);
          this.loadDriver(r.driverId);
        }
        this.loadHistory(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Aluguel não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  /**
   * O MOTORISTA, lido do TOKEN — a mesma fonte do `roleGuard`. Decide quais chamadas de
   * cadastro a tela NAO faz.
   */
  protected readonly isDriver = this.session.getCompanyRoleFromToken() === 'DRIVER';

  /** Sem nome de provedor para o motorista: ele só vê o que é dele. */
  protected readonly pageDescription = this.isDriver
    ? 'Contrato, pagamentos e histórico do seu aluguel.'
    : 'Contrato, cobranças Asaas e ações do ciclo de vida.';

  /**
   * Placa, modelo e motorista a partir da linha da LISTA, que o servico ainda guarda.
   * Aberto por link direto ou recarga a lista nao esta carregada e os campos ficam em "—":
   * o detalhe do aluguel nao os carrega, e inventar uma chamada ao cadastro que o
   * servidor nega seria trocar um "—" por um erro.
   */
  private applyIdentityFromList(rentalId: string): void {
    const row = this.rentalService.items().find((item) => item.id === rentalId);
    if (!row) return;
    if (row.vehiclePlate) this.vehiclePlate.set(this.formatPlate(row.vehiclePlate));
    const car = [row.vehicleBrand, row.vehicleModel].filter(Boolean).join(' ');
    if (car) this.vehicleLabel.set(car);
    if (row.driverName) this.driverNameSig.set(row.driverName);
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
        // messageFor also claims the error (no safety-net toast), so it runs in both cases.
        const message = this.apiErrors.messageFor(err, 'Não foi possível ativar o aluguel.');
        this.actionError.set(
          isDriverRegistrationIncomplete(err) ? DRIVER_REGISTRATION_INCOMPLETE_COPY : message,
        );
      },
    });
  }

  protected onSupportCanceled(res: RentalSupportCancelResponse): void {
    // O aluguel vem com os campos no topo; `chargeRemovals` extra é inócuo aqui.
    this.rental.set(res);
    // Os status das cobranças mudaram no servidor (removidas/recusadas): recarrega.
    this.reloadRental(res.id);
    this.refreshHistoryAfterTransition();
  }

  protected onSupportDeleted(res: RentalSupportDeleteResponse): void {
    this.supportDeleteRemovals.set(res.chargeRemovals);
    this.rental.set(null);
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

  /**
   * "Conferir no Asaas" e "Pagar (abrir cobrança)" abrem o MESMO `checkoutUrl`
   * (o DTO só expõe um link por cobrança); o dono pediu as duas entradas, então
   * ficam as duas, com rótulos que dizem a intenção. Link só em cobrança ABERTA
   * (PENDING/PAST_DUE) ou PAID (comprovante): FAILED/CANCELED/REFUNDED/etc.
   * podem apontar para fatura morta.
   */
  protected canViewChargeAtGateway(charge: RentalChargeDto): boolean {
    return (
      !this.isDriver &&
      !!charge.checkoutUrl &&
      (this.PAYABLE_STATUSES.includes(charge.status) || charge.status === 'PAID')
    );
  }

  protected viewChargeAtGateway(charge: RentalChargeDto): void {
    if (!charge.checkoutUrl) return;
    this.externalNav.openExternal(charge.checkoutUrl);
  }

  /** Copiar o link só faz sentido enquanto a cobrança ainda pode ser paga por ele. */
  protected canShareCharge(charge: RentalChargeDto): boolean {
    return !!charge.checkoutUrl && this.PAYABLE_STATUSES.includes(charge.status);
  }

  protected async shareCharge(charge: RentalChargeDto): Promise<void> {
    const url = charge.checkoutUrl;
    if (!url) return;
    const nav = this.document.defaultView?.navigator;
    try {
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(url);
      } else {
        this.copyWithTextarea(url);
      }
      this.notifications.success('Link da cobrança copiado.');
    } catch {
      try {
        this.copyWithTextarea(url);
        this.notifications.success('Link da cobrança copiado.');
      } catch {
        this.notifications.push('error', 'Não foi possível copiar o link. Tente novamente.');
      }
    }
  }

  private copyWithTextarea(text: string): void {
    const doc = this.document;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    doc.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
  }

  /** "Marcar como paga" no menu: a caução recebida por fora não oferece baixa. */
  protected canMarkPaidFromMenu(charge: RentalChargeDto): boolean {
    if (charge.kind === 'CAUCAO' && this.caucaoReceivedOutside()) return false;
    return this.canMarkAsPaid(charge);
  }

  /** Há ao menos um item? Sem item, o menu nem aparece (PAID/CANCELED do gateway). */
  protected hasChargeActions(charge: RentalChargeDto): boolean {
    return (
      this.canPayCharge(charge) ||
      this.canViewChargeAtGateway(charge) ||
      this.canShareCharge(charge) ||
      this.canReconcileCharge(charge) ||
      this.canRetryCharge(charge) ||
      this.canMarkPaidFromMenu(charge) ||
      this.canUnmarkAsPaid(charge) ||
      this.canCancelCaucaoCharge(charge)
    );
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

  /**
   * Ponte do template. Recebe a cobrança INTEIRA (e não só o status) porque o
   * atraso é derivado de `dueDate` na leitura — ver `isChargeOverdue`.
   */
  protected chargeStatusInfo(charge: RentalChargeDto): { label: string; chip: string } {
    return chargeStatusInfo(charge, this.today());
  }

  /**
   * Caução recebida por fora (`rental.caucaoPaid`) sem cobrança PAGA no Asaas:
   * a verdade é "recebida", mesmo que reste uma cobrança aberta/cancelada criada
   * antes da correção no backend. Uma cobrança PAID continua sendo exibida como
   * sempre.
   */
  protected readonly caucaoReceivedOutside = computed<boolean>(() => {
    const r = this.rental();
    if (!r?.caucaoPaid) return false;
    const cc = this.caucaoCharge();
    return cc === null || cc.status === 'CANCELED' || this.MARK_PAID_STATUSES.includes(cc.status);
  });

  /** Cobrança de caução ainda aberta no Asaas apesar de `caucaoPaid` — o dono precisa salvar o aluguel para reconciliar. */
  protected readonly caucaoStaleOpenCharge = computed<boolean>(() => {
    const cc = this.caucaoCharge();
    return this.caucaoReceivedOutside() && cc !== null && this.MARK_PAID_STATUSES.includes(cc.status);
  });

  /** Chip da linha de caução: "Recebida por fora" quando aplicável, senão o status da cobrança. */
  protected caucaoChipInfo(charge: RentalChargeDto): { label: string; chip: string } {
    if (this.caucaoReceivedOutside()) {
      return { label: 'Recebida por fora', chip: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200' };
    }
    return this.chargeStatusInfo(charge);
  }

  /**
   * Status que ainda podem ser pagos pelo link do provedor.
   *
   * `PAST_DUE` NÃO é terminal — o `checkoutUrl` do Asaas segue válido depois do
   * vencimento, e é justamente a cobrança atrasada que mais precisa do botão.
   * Gatear só em `PENDING` fazia "Pagar" sumir no instante em que vencia.
   *
   * QUEM ISTO RESGATA, concretamente: cobrança EMITIDA NO GATEWAY — ou seja, que
   * TEM `checkoutUrl` — e que o backend passou a expor como `PAST_DUE`, seja
   * porque o webhook `PAYMENT_OVERDUE` gravou, seja porque a derivação de
   * leitura (`RentalService.toChargeDto`) carimba na resposta. Inclui a parcela
   * de aluguel MANUAL (`automaticCharge=false`) que chegou ao gateway: sem
   * webhook, ela ficava `PENDING` para sempre por mais vencida que estivesse.
   *
   * QUEM ISTO NÃO RESGATA, e nunca resgatou: a linha `provider='INTERNAL'` (a
   * multa por atraso) nasce com `checkoutUrl` nulo e não tem link para abrir —
   * o conjunto `!!charge.checkoutUrl` a exclui antes e depois desta mudança.
   * Essa se acerta por "Marcar como paga". Não procure por ela aqui.
   *
   * Os DOIS `PAST_DUE` são indistinguíveis daqui, de propósito, e por isso o
   * teste é no status CRU e não no efetivo: `effectiveChargeStatus` só mapeia
   * `PENDING → PAST_DUE` e é identidade no resto, então com as DUAS pontas
   * dentro do conjunto o predicado é invariante sob a derivação — sem precisar
   * abrir um segundo relógio aqui dentro.
   */
  private readonly PAYABLE_STATUSES: ReadonlyArray<RentalChargeDto['status']> = [
    'PENDING',
    'PAST_DUE',
  ];

  protected canPayCharge(charge: RentalChargeDto): boolean {
    return this.PAYABLE_STATUSES.includes(charge.status) && !!charge.checkoutUrl;
  }

  protected canRetryCharge(charge: RentalChargeDto): boolean {
    // O motorista só consulta: quem gera de novo é a locadora (o backend recusa também).
    return charge.status === 'FAILED' && !this.isDriver;
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

  /**
   * A baixa manual é recusada pelo backend só para cobrança QUE O GATEWAY GERENCIA
   * (tem `externalId`) num aluguel de cobrança automática — essa quem quita é o
   * webhook. Cobrança sem `externalId` nunca foi ao gateway e nunca terá webhook:
   * a multa por atraso (dívida local) e as parcelas já vencidas que o aluguel
   * registra só aqui. Para elas a baixa manual é o ÚNICO caminho, também em
   * aluguel automático. `automaticCharge` ausente é tratado como automático.
   */
  private isManuallySettleable(charge: RentalChargeDto): boolean {
    const r = this.rental();
    if (!r) return false;
    // FIX-0727: cobrança com `externalId` ou link vivo é do gateway, em qualquer modo.
    return !charge.externalId && !charge.checkoutUrl;
  }

  /** Show "Marcar como paga" unless the gateway owns the charge's payment (see above). */
  protected canMarkAsPaid(charge: RentalChargeDto): boolean {
    if (!this.isManuallySettleable(charge)) return false;
    if (!this.MARK_PAID_STATUSES.includes(charge.status)) return false;
    return (
      charge.kind === 'RENTAL_TOTAL' ||
      charge.kind === 'RENTAL_PERIOD' ||
      charge.kind === 'CAUCAO' ||
      charge.kind === 'OVERDUE_FEE'
    );
  }

  /** Show "Desmarcar" for PAID charges the gateway does not own (see above). */
  protected canUnmarkAsPaid(charge: RentalChargeDto): boolean {
    if (!this.isManuallySettleable(charge)) return false;
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
    // "em aberto" e não "pendente": a cobrança volta pro estado não-pago, mas se
    // já passou do vencimento ela re-renderiza como "Atrasada", não "Pendente".
    return `Desmarcar ${period} como paga? O status voltará para em aberto e a data de pagamento será limpa.`;
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

  // ------- Conferir no Asaas (reconciliação de UMA cobrança) -------
  //
  // O webhook é o único escritor de PAID para cobrança do gateway; webhook perdido
  // = dinheiro recebido que o sistema não registra. Este botão pergunta ao Asaas e
  // COPIA o veredito — não é baixa manual.

  /** Cobrança em consulta; só uma por vez, o backend ainda segura 30 s por cobrança. */
  protected readonly reconciling = signal<string | null>(null);

  /**
   * Resultado da última consulta, mostrado NA LINHA da cobrança: a tela é longa e
   * o banner de erro mora no topo, então uma recusa ("aguarde alguns segundos")
   * ficaria fora de vista justamente onde o usuário clicou.
   */
  protected readonly reconcileNote = signal<{
    chargeId: string;
    tone: 'error' | 'info' | 'success';
    message: string;
  } | null>(null);

  /**
   * Só OWNER/MANAGER consultam (o backend responde 403 ao resto) e só faz sentido
   * para cobrança que EXISTE no gateway e ainda está em aberto. Negativo ("não é
   * motorista") de propósito: o token de "Ver como empresa" não carrega papel.
   */
  protected canReconcileCharge(charge: RentalChargeDto): boolean {
    return !this.isDriver && !!charge.externalId && isOpenChargeStatus(charge.status);
  }

  protected reconcileCharge(charge: RentalChargeDto): void {
    const r = this.rental();
    if (!r || this.reconciling()) return;
    this.actionError.set(null);
    this.reconcileNote.set(null);
    this.reconciling.set(charge.id);
    this.rentalService.reconcileCharge(r.id, charge.id).subscribe({
      next: (res) => {
        this.reconciling.set(null);
        this.reconcileNote.set({
          chargeId: charge.id,
          tone: res.outcome === 'SYNCED' ? 'success' : 'info',
          message: this.reconcileMessage(res),
        });
        this.reloadRental(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.reconciling.set(null);
        // O servidor manda a mensagem pronta (janela entre consultas, cobrança
        // sem gateway, papel); só se ela não vier cai no texto local.
        const waitFallback =
          err.status === 409 || err.status === 429
            ? 'Esta cobrança acabou de ser conferida. Aguarde alguns segundos e tente de novo.'
            : 'Não foi possível conferir a cobrança no Asaas. Tente novamente.';
        this.reconcileNote.set({
          chargeId: charge.id,
          tone: 'error',
          message: this.apiErrors.messageFor(err, waitFallback),
        });
      },
    });
  }

  private reconcileMessage(res: RentalChargeReconcileDto): string {
    if (res.outcome === 'SYNCED') {
      const label = chargeStatusInfo({ status: res.status, dueDate: null }, this.today()).label;
      return `Atualizada a partir do Asaas: a cobrança agora consta como ${label.toLowerCase()}.`;
    }
    if (res.remoteStatus === 'UNKNOWN') {
      return 'O Asaas não deu uma resposta conclusiva. Nada foi alterado.';
    }
    if (res.remoteStatus === 'PENDING') {
      return 'Conferido: o Asaas ainda mostra esta cobrança como pendente. Nada mudou.';
    }
    return 'Conferido no Asaas. Nada mudou.';
  }

  // ------- Cancelar cobrança de caução (UMA cobrança, com confirmação) -------
  //
  // Elegibilidade espelha o backend: só a CAUÇÃO, só em aberto (PENDING /
  // PAST_DUE / FAILED — `isOpenChargeStatus`, a fonte única) e não contestada
  // (DISPUTED não é "aberta"). O DTO não traz `disputedAt`: uma cobrança
  // contestada que ainda conste como PENDING é recusada pelo servidor (409).
  // Negativo ("não é motorista") de propósito: o token de "Ver como empresa"
  // não carrega papel.

  /** Sessão "Ver como empresa" (leitura): cancelar/gerar ficam fora, com explicação. */
  protected readonly readOnlySession = this.impersonation.readOnly;
  protected readonly cancelChargeTarget = signal<RentalChargeDto | null>(null);
  protected readonly cancelChargeNote = signal('');
  protected readonly cancelChargeBusy = signal(false);
  protected readonly cancelChargeResult = signal<{
    tone: 'success' | 'warning' | 'info';
    message: string;
    hint: string | null;
  } | null>(null);
  protected readonly generatingCaucao = signal(false);

  // FIX-0736: o backend só cancela CAUÇÃO. Para liberar parcelas, quando ele
  // suportar, basta trocar a condição `charge.kind === 'CAUCAO'` abaixo.
  protected canCancelCaucaoCharge(charge: RentalChargeDto): boolean {
    return (
      !this.isDriver &&
      !this.readOnlySession() &&
      charge.kind === 'CAUCAO' &&
      isOpenChargeStatus(charge.status)
    );
  }

  /**
   * Depois de cancelar, o card oferece gerar outra: caução configurada, não
   * recebida, linha da caução terminal-cancelada, aluguel ainda em curso.
   */
  protected readonly canGenerateCaucaoCharge = computed<boolean>(() => {
    const r = this.rental();
    const cc = this.caucaoCharge();
    if (!r || !cc || this.isDriver || this.readOnlySession()) return false;
    if (cc.status !== 'CANCELED') return false;
    if (r.caucaoAmount <= 0 || r.caucaoPaid) return false;
    return r.status === 'RESERVED' || r.status === 'ACTIVE';
  });

  protected askCancelCharge(charge: RentalChargeDto): void {
    if (!this.canCancelCaucaoCharge(charge) || this.cancelChargeBusy()) return;
    this.cancelChargeNote.set('');
    this.cancelChargeTarget.set(charge);
  }

  protected closeCancelCharge(): void {
    if (this.cancelChargeBusy()) return;
    this.cancelChargeTarget.set(null);
  }

  protected onCancelChargeNote(event: Event): void {
    this.cancelChargeNote.set((event.target as HTMLTextAreaElement).value);
  }

  protected confirmCancelCharge(): void {
    const r = this.rental();
    const charge = this.cancelChargeTarget();
    if (!r || !charge || this.cancelChargeBusy()) return;
    this.actionError.set(null);
    this.cancelChargeResult.set(null);
    this.cancelChargeBusy.set(true);
    this.rentalService.cancelCharge(r.id, charge.id, this.cancelChargeNote()).subscribe({
      next: (res) => {
        this.cancelChargeBusy.set(false);
        this.cancelChargeTarget.set(null);
        this.cancelChargeResult.set(this.cancelChargeOutcome(res));
        this.reloadRental(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.cancelChargeBusy.set(false);
        this.cancelChargeTarget.set(null);
        if (isToastedBySupportEditInterceptor(err)) return;
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível cancelar a cobrança. Tente novamente.'),
        );
      },
    });
  }

  /** Uma frase por desfecho + o `hint` do servidor, quando houver. */
  private cancelChargeOutcome(res: ChargeCancelResponse): {
    tone: 'success' | 'warning' | 'info';
    message: string;
    hint: string | null;
  } {
    const messages: Record<
      ChargeCancelOutcome,
      { tone: 'success' | 'warning' | 'info'; text: string }
    > = {
      REMOVED_AT_GATEWAY: {
        tone: 'success',
        text: 'Cobrança da caução cancelada e removida do Asaas.',
      },
      NO_GATEWAY_LINK: {
        tone: 'success',
        text: 'Cobrança da caução cancelada. Ela não tinha vínculo com o Asaas, então nada foi removido lá.',
      },
      REMOVAL_PENDING_SWEEP: {
        tone: 'warning',
        text: 'Cobrança da caução cancelada aqui, mas a remoção no Asaas ainda está pendente. O sistema tenta de novo sozinho.',
      },
      ALREADY_CLOSED: {
        tone: 'info',
        text: 'Esta cobrança já estava encerrada. Nada foi alterado.',
      },
      ALREADY_PAID: {
        tone: 'info',
        text: 'O motorista já pagou esta cobrança, então nada foi cancelado.',
      },
    };
    const entry = messages[res.outcome] ?? {
      tone: 'info' as const,
      text: 'Pedido de cancelamento processado. Confira a situação da cobrança.',
    };
    return { tone: entry.tone, message: entry.text, hint: res.hint?.trim() || null };
  }

  protected generateCaucaoCharge(): void {
    const r = this.rental();
    if (!r || this.generatingCaucao() || !this.canGenerateCaucaoCharge()) return;
    this.actionError.set(null);
    this.cancelChargeResult.set(null);
    this.generatingCaucao.set(true);
    this.rentalService.createCaucaoCharge(r.id).subscribe({
      next: () => {
        this.generatingCaucao.set(false);
        this.notifications.push('success', 'Nova cobrança da caução gerada.');
        this.reloadRental(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.generatingCaucao.set(false);
        if (isToastedBySupportEditInterceptor(err)) return;
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível gerar a cobrança da caução.'),
        );
      },
    });
  }

  /** Recarrega o aluguel (cobranças inclusive) sem mexer no resto da tela. */
  private reloadRental(id: string): void {
    this.rentalService.getById(id).subscribe({
      next: (fresh: RentalResponseDto) => {
        this.rental.set(fresh);
        // Aviso de "não foi criada" só enquanto restar linha pra regerar.
        if (!fresh.charges.some((c) => c.status === 'FAILED')) this.chargeSyncNotice.set(null);
      },
    });
  }

  protected retryCharge(charge: RentalChargeDto): void {
    const r = this.rental();
    if (!r || this.retrying()) return;
    this.actionError.set(null);
    this.retrying.set(charge.id);
    this.rentalService.retryCharge(r.id, charge.id).subscribe({
      next: (res) => {
        this.retrying.set(null);
        this.notifications.push('success', this.retryMessage(res.outcome));
        this.reloadRental(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.retrying.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível gerar a cobrança de novo. Tente novamente.'));
      },
    });
  }

  /** Uma frase por desfecho: cada um diz algo diferente sobre o que mudou. */
  private retryMessage(outcome: RentalChargeRetryDto['outcome']): string {
    switch (outcome) {
      case 'RETRIED':
        return 'Cobrança gerada de novo. A anterior foi cancelada no Asaas e o motorista recebe o link novo.';
      case 'ALREADY_PAID':
        return 'Cobrança já estava paga no provedor — status sincronizado.';
      case 'ALREADY_REFUNDED':
        return 'Cobrança já estava reembolsada no provedor — status sincronizado.';
      case 'CANCELED':
        return 'Nada foi gerado: o aluguel não está mais em andamento ou a caução já foi recebida por fora. A cobrança foi cancelada.';
      case 'SKIPPED':
        return 'A cobrança mudou de situação enquanto era regerada, então nada foi alterado. Confira o status.';
    }
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
      return { label: 'Criado', chip: 'bg-surface-sunken text-fg-soft', color: '#6b7280' };
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

/** O que veio no `state` da navegação é `unknown` — só entra se tiver a forma certa. */
function isChargeSync(value: unknown): value is RentalChargeSyncDto {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['failed'] === 'number' && Number.isFinite(v['failed']);
}

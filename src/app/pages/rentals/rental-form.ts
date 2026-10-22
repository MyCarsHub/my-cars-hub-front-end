import {
  DRIVER_REGISTRATION_INCOMPLETE_COPY,
  isDriverRegistrationIncomplete,
} from '../../services/driver-invite-outcome';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  of,
  startWith,
  switchMap,
  type Observable,
} from 'rxjs';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { applyPtBrMoneyMaskToControl } from '../../utils/ptbr-money-mask';
import { formatPtBrMoney } from '../../utils/ptbr-number';
import { applyFeeBelowChargeServerError } from './rental-fee-below-charge';
import {
  ChargeScheduleRow,
  PreflightSummaryItem,
  actionableIssues,
  buildChargeSchedule,
  fineHelp,
  interestHelp,
  messagesByControl,
  readPreflightError,
  summaryItems,
  summarizeChargeSchedule,
  syncServerMarks,
} from './rental-preflight';
import { ChargePreviewSummary, summarizeChargePreview } from '../../utils/rental-charge-preview';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../utils/validators/ptbr-money.validator';
import { RentalService } from './rental.service';
import { SessionService } from '../../services/session.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';
import { RentalDraftService } from './rental-draft.service';
import {
  BILLING_FREQUENCY_OPTIONS,
  CreateRentalRequest,
  RENTAL_CHARGE_SYNC_STATE_KEY,
  RentalBillingFrequency,
  RentalLateFineType,
  RentalPreflightItem,
  RentalPreflightLimits,
  RentalPreflightRequest,
  RentalPreflightResponse,
  RentalUpdateRequest,
} from '../../types/rental.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { DriverListItem } from '../../types/driver.types';

@Component({
  selector: 'app-rental-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './rental-form.html',
})
export class RentalForm implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly asaasService = inject(AsaasIntegrationService);
  private readonly contractTemplateService = inject(ContractTemplateService);
  private readonly draftService = inject(RentalDraftService);
  private readonly sessionService = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** V29: true se a company tem template de contrato — controla default do toggle. */
  protected readonly hasContractTemplate = signal(false);

  /**
   * FEAT-0147 — do TOKEN, a mesma fonte do `roleGuard`.
   *
   * Aqui `isOwner` NÃO trava campo nenhum do formulário: trava OFERTAS DE
   * NAVEGAÇÃO para `/configuracoes/contratos` e `/configuracoes/integracoes/asaas`,
   * as duas `roleGuard(['OWNER'])`. FIX-0409 — enquanto isto era lido do espelho
   * `selectedRole` — velho por uma troca de empresa, editável por DevTools — um
   * MANAGER recebia o link e o botão "Configurar …", tocava, e o guard o devolvia
   * ao `/dashboard` sem dizer nada (o “sem dizer nada” caiu no FIX-0387; a oferta
   * indevida caiu aqui). Mesma família de #330 e #331, não um campo indevido.
   *
   * Lido uma vez na construção: a troca de empresa destrói este componente
   * (`layout.store.ts`, `commitTenant`), então não há papel "quente".
   */
  protected readonly isOwner = this.sessionService.getCompanyRoleFromToken() === 'OWNER';


  protected readonly editingId = signal<string | null>(null);
  protected readonly editingStatus = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  /** Criação/atualização em voo. Também é o `busy` do diálogo de confirmação. */
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * Alvo de foco programático do banner de erro. Uma falha DEPOIS do diálogo de
   * confirmação acontece com o usuário no fim da página e o banner mora no topo:
   * sem rolar até ele, "nada acontece" — ver `revealError`.
   */
  private readonly formErrorBanner = viewChild<ElementRef<HTMLElement>>('formErrorBanner');

  // Copy por validador. Chave = validator key; o `serverError` do backend sempre
  // vence estes textos (ver MESSAGE_ORDER em services/validation-messages.ts).
  protected readonly vehicleMessages: Readonly<Record<string, string>> = {
    required: 'Selecione um veículo.',
  };
  protected readonly driverMessages: Readonly<Record<string, string>> = {
    required: 'Selecione um motorista.',
  };
  protected readonly startDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data de início.',
  };
  protected readonly endDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data final.',
  };
  protected readonly billingFrequencyMessages: Readonly<Record<string, string>> = {
    required: 'Selecione a frequência.',
  };
  protected readonly rateMessages: Readonly<Record<string, string>> = {
    required: 'Informe um valor maior que zero.',
    min: 'Informe um valor maior que zero.',
    moneyFormat: 'Informe um valor válido (ex.: 1.500,00).',
  };
  protected readonly initialKmMessages: Readonly<Record<string, string>> = {
    required: 'Informe a quilometragem inicial.',
    min: 'A quilometragem não pode ser negativa.',
  };
  protected readonly firstPaymentMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data da 1ª cobrança.',
    firstPaymentAfterEnd: 'A 1ª cobrança não pode vencer depois da data final do aluguel.',
  };
  protected readonly lateInterestMessages: Readonly<Record<string, string>> = {
    min: 'Os juros ao mês não podem ser negativos.',
    moneyFormat: 'Informe um percentual válido (ex.: 1,50).',
  };
  protected readonly caucaoMessages: Readonly<Record<string, string>> = {
    moneyFormat: 'Informe um valor válido (ex.: 2.000,00).',
  };
  protected readonly lateFineValueMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor da multa (0 se não cobrar).',
    min: 'O valor da multa não pode ser negativo.',
    moneyFormat: 'Informe um valor válido (ex.: 150,00).',
  };
  protected readonly franchiseKmMessages: Readonly<Record<string, string>> = {
    min: 'A franquia não pode ser negativa.',
  };
  protected readonly extraKmPriceMessages: Readonly<Record<string, string>> = {
    moneyFormat: 'Informe um valor válido (ex.: 0,50).',
  };

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly drivers = signal<DriverListItem[]>([]);

  /**
   * Ligados quando o refresh do picker derruba a escolha que já estava feita
   * (ver `applyVehicles` / `applyDrivers`). Sempre refletem o ÚLTIMO refresh.
   */
  private readonly vehicleClearedByPeriod = signal(false);
  private readonly driverClearedByPeriod = signal(false);

  /**
   * Sequência das buscas de picker: o período pode mudar com uma requisição em
   * voo e a resposta velha chegar por último. Sem isso, a lista antiga venceria
   * a nova — e ainda limparia uma seleção que era válida.
   */
  private pickerRequestId = 0;

  /** Última chave de período efetivamente buscada — evita refetch redundante. */
  private loadedPeriodKey = '';

  protected readonly billingFrequencyOptions = BILLING_FREQUENCY_OPTIONS;

  // Asaas integration status; loaded on init so we can warn the user if they
  // enable automaticCharge without a connected Asaas account.
  protected readonly asaasStatus = this.asaasService.status;
  protected readonly asaasConnected = computed(
    () => this.asaasStatus()?.connected === true,
  );

  protected readonly form = this.fb.nonNullable.group(
    {
      vehicleId: ['', [Validators.required]],
      driverId: ['', [Validators.required]],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      // Order in the UI: frequency comes BEFORE the rate so the rate label can
      // reflect the chosen period ("Valor da diária" / "semanal" / "mensal").
      billingFrequency: ['DAILY' as RentalBillingFrequency, [Validators.required]],
      // TEXTO pt-BR no form (máscara de milhar ao digitar), centavos no payload.
      periodRateReais: ['', [ptBrMoneyValidator({ minCents: 1 })]],
      caucaoReais: ['', [ptBrMoneyValidator({ optional: true })]],
      caucaoPaid: [false],
      automaticCharge: [false],
      notes: [''],

      // V29: Condições de pagamento — todos obrigatórios.
      initialKm: [null as number | null, [Validators.required, Validators.min(0)]],
      pickupDate: ['', [Validators.required]], // datetime-local yyyy-MM-ddTHH:mm
      // O vencimento LITERAL da 1ª cobrança (as seguintes vencem a cada período a
      // partir dela). Nunca depois do fim do aluguel — ver o validador.
      firstPaymentDate: ['', [Validators.required, firstPaymentNotAfterEndValidator]], // yyyy-MM-dd
      // FIX-0754: juros de mora em % AO MES, texto pt-BR com 2 casas ("1,50"). Mesma
      // gramatica do campo de dinheiro, lida em centésimos de ponto percentual. Vazio =
      // sem juros (aluguel novo) ou "ainda nao definido" (aluguel legado em R$/dia).
      // A faixa aceita e do backend (limits do preflight); aqui so o formato.
      lateInterestPercent: ['', [ptBrMoneyValidator({ optional: true })]],
      lateFineType: ['PERCENT' as RentalLateFineType, [Validators.required]],
      // PERCENT: percentagem (2 = 2%). FIXED: reais.
      // Nasce em PERCENT, entao os validadores iniciais sao os do percentual.
      // `onLateFineTypeChange` troca os dois quando o modo muda.
      lateFineValueInput: [
        0 as number | string,
        [Validators.required, Validators.min(0)],
      ],

      // V32: franquia e política de combustível — opcionais.
      franchiseKm: [null as number | null, [Validators.min(0)]],
      // V113: preço do km além da franquia. TEXTO pt-BR no form (o validador lê número
      // como vazio), centavos no payload. Só vale com franquia (`hasKmLimit`).
      extraKmPriceReais: ['', [ptBrMoneyValidator({ optional: true })]],
      returnFuelPolicy: [''],

      // V29: gerar contrato do template (só ativa se hasContractTemplate).
      useContractTemplate: [false],
    },
    { validators: [endAfterStartValidator, pickupWithinPeriodValidator] },
  );

  /**
   * Reactive derived state fed by form.valueChanges.
   * `toSignal` gives us OnPush-friendly re-renders whenever inputs change,
   * without the manual `subscribe` + `set` boilerplate.
   */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /**
   * O validador da 1ª cobrança lê a data final, mas o Angular só reavalia um
   * controle quando ELE muda. Sem isto, encurtar o aluguel deixaria uma 1ª
   * cobrança fora do período aprovada até o submit.
   *
   * Marca como tocado quando passa a violar a regra, para a mensagem aparecer na
   * hora em vez de esperar o usuário tentar enviar.
   */
  private readonly endDateRevalidatesFirstPayment = this.form.controls.endDate.valueChanges
    .pipe(takeUntilDestroyed())
    .subscribe(() => {
      const control = this.form.controls.firstPaymentDate;
      control.updateValueAndValidity();
      if (control.errors?.['firstPaymentAfterEnd']) control.markAsTouched();
    });

  // ------------------------------------------------------------------
  // FIX-0754 — preflight. O backend (`POST /rentals/preflight`) diz o que recusaria no
  // create/edit; a tela só ESPELHA a lista: cada problema no campo certo, o resto no
  // resumo do topo, e o botão impedido enquanto houver um bloqueante.
  // ------------------------------------------------------------------

  /** Problemas BLOQUEANTES da última conferência (ou do último 400). */
  protected readonly preflightIssues = signal<RentalPreflightItem[]>([]);
  /** Avisos: aparecem, mas nunca impedem salvar. */
  protected readonly preflightWarnings = signal<RentalPreflightItem[]>([]);
  protected readonly preflightLimits = signal<RentalPreflightLimits | null>(null);
  protected readonly chargeSchedule = signal<ChargeScheduleRow[]>([]);
  protected readonly scheduleExpanded = signal(false);
  /** Controles marcados pela conferência anterior — para limpar os que sararam. */
  private preflightMarked: ReadonlySet<string> = new Set();
  /** Depois de um 400 do create/edit, "obrigatório" vazio também é mostrado. */
  private readonly requiredVisible = signal(false);
  /** A conferência falhou (rede, 404, 5xx): status neutro, nada bloqueado. */
  protected readonly preflightUnavailable = signal(false);
  /** Juros em R$/dia do aluguel LEGADO carregado (sem %), em centavos. */
  private readonly legacyDailyInterestCents = signal(0);
  /** O aluguel carregado já tinha o % ao mês definido (esvaziar o campo = zerar). */
  private readonly interestPercentLoaded = signal(false);

  protected readonly preflightBlockingCount = computed(
    () => actionableIssues(this.preflightIssues(), this.requiredVisible()).length,
  );
  protected readonly preflightBlocked = computed(() => this.preflightBlockingCount() > 0);

  /** O que não tem campo na tela, com o atalho (cadastro do motorista / Integrações). */
  protected readonly preflightSummary = computed<PreflightSummaryItem[]>(() =>
    summaryItems(this.preflightIssues(), this.formValue()?.driverId || null, this.requiredVisible()),
  );

  /** A retirada não usa `app-form-field`; sua mensagem do servidor vem por aqui. */
  protected readonly pickupPreflightMessage = computed(
    () =>
      messagesByControl(actionableIssues(this.preflightIssues(), this.requiredVisible()))[
        'pickupDate'
      ] ?? null,
  );

  protected readonly lateInterestHint = computed(() => {
    const v = this.formValue();
    return interestHelp(
      this.preflightLimits(),
      ptBrMoneyCents(v?.periodRateReais),
      ptBrMoneyCents(v?.lateInterestPercent),
    );
  });

  protected readonly lateFineHint = computed(() =>
    fineHelp(this.formValue()?.lateFineType === 'FIXED' ? 'FIXED' : 'PERCENT', this.preflightLimits()),
  );

  /** Aluguel legado (só R$/dia): o aviso e o campo % para definir. */
  protected readonly legacyInterestNotice = computed(() => {
    const cents = this.legacyDailyInterestCents();
    if (!this.isEdit() || cents <= 0) return null;
    if (ptBrMoneyCents(this.formValue()?.lateInterestPercent) !== null) return null;
    return `Este aluguel foi criado com juros de ${formatBrl(cents)} por dia de atraso, um formato que não é mais aceito. Defina o juros ao mês (%) para substituí-lo.`;
  });

  protected readonly scheduleSummary = computed(() => summarizeChargeSchedule(this.chargeSchedule()));

  /**
   * Chave estável do corpo a conferir; `''` = nada a conferir (edição ainda carregando
   * ou formulário somente leitura). Texto de propósito: o `computed` só propaga quando a
   * chave muda de verdade, então mexer em campo irrelevante (observações) não chama nada.
   */
  private readonly preflightRequestKey = computed(() => {
    this.formValue();
    if (this.editingId() !== null && this.editingStatus() === null) return '';
    if (this.form.disabled) return '';
    return JSON.stringify({ ...this.buildPreflightPayload(), notes: undefined });
  });

  private readonly preflightRun = toObservable(this.preflightRequestKey)
    .pipe(
      filter((key) => key !== ''),
      distinctUntilChanged(),
      debounceTime(PREFLIGHT_DEBOUNCE_MS),
      // switchMap cancela a requisição anterior: só a conferência mais nova vale.
      switchMap(() => this.runPreflight()),
      takeUntilDestroyed(),
    )
    .subscribe((result) => {
      if (result === null) return;
      if (result === 'failed') {
        // Sem conferência não há como saber o que está errado: solta o botão e as marcas
        // (o create/edit ainda recusa com a mesma lista) e avisa, sem culpar o usuário.
        this.preflightUnavailable.set(true);
        this.preflightWarnings.set([]);
        this.chargeSchedule.set([]);
        this.requiredVisible.set(false);
        this.showIssues([]);
        return;
      }
      this.preflightUnavailable.set(false);
      this.requiredVisible.set(false);
      this.preflightWarnings.set(result.response.warnings ?? []);
      if (result.response.limits) this.preflightLimits.set(result.response.limits);
      this.showIssues(result.response.issues ?? []);
      if (result.schedule) this.chargeSchedule.set(result.schedule);
    });

  private runPreflight(): Observable<PreflightRun | 'failed' | null> {
    if (this.preflightRequestKey() === '') return of(null);
    return this.rentalService.preflight(this.buildPreflightPayload()).pipe(
      switchMap((response): Observable<PreflightRun> => {
        // A prévia por cobrança só faz sentido na criação, com o formulário limpo dos
        // dois lados: o backend aceitou e os validadores locais também.
        if (this.isEdit() || (response.issues ?? []).length > 0 || this.form.invalid) {
          return of({ response, schedule: [] });
        }
        const payload = this.buildCreatePayload();
        return this.rentalService.chargePreview(payload).pipe(
          map((preview) => ({
            response,
            schedule: preview.blocker ? [] : buildChargeSchedule(preview, payload),
          })),
          catchError((err: unknown) => {
            this.apiErrors.claim(err);
            return of({ response, schedule: [] });
          }),
          // Os problemas e avisos chegam já; a lista de cobranças vem depois (e a antiga
          // fica na tela até lá, em vez de piscar a cada tecla).
          startWith({ response, schedule: null }),
        );
      }),
      // Conferência é segundo plano: se falhar, o create/edit ainda recusa com a mesma
      // lista. Reclama o erro para não virar toast a cada tecla.
      catchError((err: unknown) => {
        this.apiErrors.claim(err);
        return of('failed' as const);
      }),
    );
  }

  /** Aplica a lista (do preflight ou do 400): campo certo inline, resto no resumo. */
  private showIssues(items: readonly RentalPreflightItem[]): void {
    const blocking = items.filter((i) => i.severity !== 'WARNING');
    this.preflightIssues.set(blocking);
    this.preflightMarked = syncServerMarks(
      this.form,
      messagesByControl(actionableIssues(blocking, this.requiredVisible())),
      this.preflightMarked,
    );
  }

  /**
   * 400 de create/edit com a lista do preflight. `false` quando o corpo não é essa lista,
   * ou quando nela não há nada que o usuário possa corrigir (só "obrigatório" vazio, que
   * o caminho comum já mostra) — assim a tela nunca fica muda.
   */
  private claimPreflightError(err: HttpErrorResponse): boolean {
    const parsed = readPreflightError(err);
    if (!parsed || actionableIssues(parsed.issues, true).length === 0) return false;
    this.apiErrors.claim(err);
    if (parsed.limits) this.preflightLimits.set(parsed.limits);
    this.requiredVisible.set(true);
    this.showIssues(parsed.issues);
    this.error.set(null);
    this.revealFirstProblem();
    return true;
  }

  /** Leva o resumo (ou o 1º campo com erro) ao campo de visão. */
  private revealFirstProblem(): void {
    afterNextRender(
      () => {
        const el = this.host.nativeElement.querySelector<HTMLElement>(
          '[data-preflight-summary], [aria-invalid="true"]',
        );
        if (!el) return;
        el.scrollIntoView?.({ block: 'center' });
        el.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  protected toggleSchedule(): void {
    this.scheduleExpanded.update((open) => !open);
  }

  /** Último início visto — separa "a 1ª cobrança acompanha o início" de "o usuário escolheu". */
  private lastStartDay = '';

  /**
   * A 1ª cobrança nasce igual ao início do aluguel e ACOMPANHA o início enquanto
   * estiver vazia ou ainda igual ao início anterior. Uma data que o usuário
   * escolheu (diferente do início) nunca é sobrescrita.
   *
   * Só na criação: na edição a data vem gravada do servidor e mexer no início
   * não pode reescrever silenciosamente quando a 1ª cobrança vence.
   */
  private readonly startDatePrefillsFirstPayment = this.form.controls.startDate.valueChanges
    .pipe(takeUntilDestroyed())
    .subscribe((start) => {
      const previous = this.lastStartDay;
      this.lastStartDay = start ?? '';
      if (this.isEdit()) return;
      const day = asDay(start);
      if (!day || !isRealDay(day)) return;
      const control = this.form.controls.firstPaymentDate;
      if (control.disabled) return;
      if (!control.value || control.value === previous) control.setValue(day);
    });

  /**
   * Período pretendido, reduzido a uma CHAVE estável `start|end` — ou `''`
   * enquanto ele não estiver completo e coerente.
   *
   * A chave é string de propósito: `computed` só propaga quando o valor muda de
   * verdade (`Object.is`), então mexer em qualquer outro campo do formulário não
   * refaz busca nenhuma, e um objeto novo a cada emissão faria justamente isso.
   *
   * `''` cobre os três casos em que o backend responderia 400 ou pior:
   * vazio, pela metade (só uma das pontas) e fim antes do início. É esse `''`
   * que garante que NENHUM dos dois parâmetros sai do navegador enquanto o
   * usuário ainda está digitando.
   */
  private readonly periodKey = computed(() => {
    const v = this.formValue();
    const start = asDay(v?.startDate);
    const end = asDay(v?.endDate);
    if (!start || !end || end < start) return '';
    // `asDay` só valida o FORMATO — "2026-13-45" passaria e viraria 400 no
    // parse do backend. Aqui exigimos uma data que existe no calendário.
    if (!isRealDay(start) || !isRealDay(end)) return '';
    return `${start}|${end}`;
  });

  /**
   * Recarrega os dois pickers quando o período muda.
   *
   * `debounceTime` porque `<input type="date">` emite por SEGMENTO digitado:
   * trocar o ano de 2026 pra 2027 passa por 0002/0020/0202 — três datas válidas
   * e três buscas inúteis. 300 ms é o mesmo intervalo já usado na busca da
   * `rentals-list`.
   *
   * O guard contra `loadedPeriodKey` existe porque a primeira emissão repete o
   * que o `ngOnInit` já buscou (e, na edição, o `getById` pode ter preenchido as
   * datas antes disso). Comparar com o que foi buscado — em vez de contar
   * emissões — cobre as duas ordens sem depender de timing.
   */
  private readonly periodReload = toObservable(this.periodKey)
    .pipe(debounceTime(PICKER_RELOAD_DEBOUNCE_MS), takeUntilDestroyed())
    .subscribe((key) => {
      if (key === this.loadedPeriodKey) return;
      this.loadPickers();
    });

  /**
   * Avisos de "sua escolha saiu da lista". Somem sozinhos assim que o usuário
   * escolhe outro item — a mensagem não sobrevive ao problema que ela descreve.
   */
  protected readonly vehicleUnavailableNotice = computed(
    () => this.vehicleClearedByPeriod() && !this.formValue()?.vehicleId,
  );
  protected readonly driverUnavailableNotice = computed(
    () => this.driverClearedByPeriod() && !this.formValue()?.driverId,
  );

  /**
   * Copy do estado vazio. Com período escolhido, "todos estão em aluguel ativo"
   * seria mentira — o que falta é alguém livre NAQUELE intervalo.
   */
  protected readonly emptyVehiclesMessage = computed(() =>
    this.periodKey()
      ? 'Nenhum veículo livre no período informado — tente outras datas.'
      : 'Nenhum veículo disponível — todos estão em aluguel ativo.',
  );
  protected readonly emptyDriversMessage = computed(() =>
    this.periodKey()
      ? 'Nenhum motorista livre no período informado — tente outras datas.'
      : 'Nenhum motorista disponível — todos estão em aluguel ativo.',
  );

  protected readonly totalDays = computed(() => {
    const v = this.formValue();
    if (!v?.startDate || !v?.endDate) return 0;
    const s = new Date(v.startDate + 'T00:00:00').getTime();
    const e = new Date(v.endDate + 'T00:00:00').getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
    // Fim EXCLUSIVO: o dia da devolução não é cobrado, então 05/08 → 12/08 são
    // 7 diárias (05 a 11). Decisão do dono do produto de 2026-08-04 registrada em
    // `documentation/FIXES.md`, que elege esta prévia como referência do cálculo.
    // O piso de 1 cobre `start == end`: com fim exclusivo a diferença é zero, e um
    // aluguel de um dia não pode custar R$ 0 — mesma regra do backend em
    // `RentalPeriodPlanner.billableDays()` (`Math.max(1, end - start)`).
    const diff = Math.round((e - s) / 86_400_000);
    return diff > 0 ? diff : 1;
  });

  protected readonly billingFrequency = computed<RentalBillingFrequency>(
    () => (this.formValue()?.billingFrequency ?? 'DAILY') as RentalBillingFrequency,
  );

  /**
   * Ajuda do campo da 1ª cobrança, no idioma do período escolhido. Diz as duas
   * coisas que o campo faz: é o vencimento da PRIMEIRA e as outras andam a partir
   * dela — foi a falta disso que fazia a data digitada não parecer a cobrada.
   */
  protected readonly firstPaymentHint = computed(() => {
    const unit = FIRST_PAYMENT_PERIOD_UNIT[this.billingFrequency()];
    return `É o vencimento da primeira cobrança. As próximas vencem a cada ${unit} a partir dela.`;
  });

  /**
   * Dynamic label for the rate input — switches based on the chosen frequency.
   * The form control name is `periodRateReais` (posted as `periodRate` in cents)
   * so the backend contract stays consistent with the periodRate rename.
   */
  protected readonly rateLabel = computed(() => {
    switch (this.billingFrequency()) {
      case 'WEEKLY':
        return 'Valor semanal (R$)';
      case 'MONTHLY':
        return 'Valor mensal (R$)';
      default:
        return 'Valor da diária (R$)';
    }
  });

  protected readonly billingUnits = computed(() => {
    const days = this.totalDays();
    if (!days) return 0;
    switch (this.billingFrequency()) {
      case 'WEEKLY':
        return Math.ceil(days / 7);
      case 'MONTHLY':
        return Math.ceil(days / 30);
      default:
        return days;
    }
  });

  protected readonly totalAmountCents = computed(() => {
    const v = this.formValue();
    const days = this.totalDays();
    if (!days) return null;
    const cents = ptBrMoneyCents(v?.periodRateReais);
    if (cents == null) return null;
    switch (this.billingFrequency()) {
      case 'WEEKLY':
        return cents * Math.ceil(days / 7);
      case 'MONTHLY':
        return cents * Math.ceil(days / 30);
      default:
        return cents * days;
    }
  });

  protected readonly totalAmountLabel = computed(() => {
    const t = this.totalAmountCents();
    if (t == null) return '--';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(t / 100);
  });

  protected readonly totalPreviewCaption = computed(() => {
    const units = this.billingUnits();
    const freq = this.billingFrequency();
    const unitLabel =
      BILLING_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.perUnitLabel ?? 'diária';
    return `${units} × ${unitLabel}`;
  });

  protected readonly automaticChargeOn = computed(
    () => this.formValue()?.automaticCharge === true,
  );

  /**
   * Contract-template toggle state — mirrors `automaticChargeOn` so the
   * template can render an inline warning + config CTA when the tenant
   * doesn't have a contract template configured yet.
   */
  protected readonly useContractTemplateOn = computed(
    () => this.formValue()?.useContractTemplate === true,
  );

  /**
   * Confirm-dialog visibility for the "integration not configured" guard.
   * `missingIntegrationTarget` records which card triggered the warning so
   * the CTA can navigate to the right settings route.
   */
  protected readonly missingIntegrationTarget = signal<'asaas' | 'contract' | null>(null);

  protected readonly missingIntegrationTitle = computed(() =>
    this.missingIntegrationTarget() === null ? '' : 'Integração não configurada',
  );

  protected readonly missingIntegrationMessage = computed(() => {
    switch (this.missingIntegrationTarget()) {
      case 'asaas':
        return this.isOwner
          ? 'Configure a integração Asaas antes de habilitar cobrança automática neste aluguel.'
          : 'A integração Asaas ainda não foi configurada. Peça ao proprietário da conta para configurar, ou desative a cobrança automática neste aluguel.';
      case 'contract':
        return this.isOwner
          ? 'Configure o template de contrato antes de habilitar a geração automática neste aluguel.'
          : 'O template de contrato ainda não foi configurado. Peça ao proprietário da conta para configurar, ou desative a geração automática neste aluguel.';
      default:
        return '';
    }
  });

  protected readonly missingIntegrationConfirmLabel = computed(() => {
    if (!this.isOwner) return 'Entendi';
    return this.missingIntegrationTarget() === 'asaas' ? 'Configurar Asaas' : 'Configurar contrato';
  });

  /**
   * Só o OWNER tem duas saídas de verdade: "Configurar …" navega pra
   * `/configuracoes/*` e "Voltar ao aluguel" fica no formulário.
   *
   * Fora do OWNER o confirmar não navega (a rota é OWNER-only), então os dois
   * botões fariam exatamente a mesma coisa — fechar o dialog — com rótulos
   * diferentes e o confirmar ainda pintado como ação de peso pelo
   * `variant="warning"`. Label vazia = `ConfirmDialog` não renderiza o cancelar,
   * sobrando só o "Entendi". O backdrop continua fechando.
   */
  protected readonly missingIntegrationCancelLabel = computed(() =>
    this.isOwner ? 'Voltar ao aluguel' : '',
  );

  /** Só mostra o toggle "caução recebida por fora" quando há caução. */
  protected readonly caucaoAmountPositive = computed(
    () => (ptBrMoneyCents(this.formValue()?.caucaoReais) ?? 0) > 0,
  );

  /** Há limite de km (franquia > 0)? Só então o preço do km excedente aparece e vale. */
  protected readonly hasKmLimit = computed(() => (Number(this.formValue()?.franchiseKm) || 0) > 0);

  /** Estado ligado do toggle, para o cartão (ícone e confirmação) refletirem o controle. */
  protected readonly caucaoPaidOn = computed(() => this.formValue()?.caucaoPaid === true);

  /**
   * Retirada dentro do período (regra espelhada do backend).
   *
   * O backend rejeita `pickupDate` fora de `[startDate 00:00, endDate 23:59]`,
   * inclusivo nas duas pontas e comparado por DIA — a hora é livre. Aqui isso
   * vira duas camadas: `min`/`max` no `datetime-local` (impede a seleção) e o
   * validador de grupo `pickupWithinPeriodValidator` (barra o submit, porque
   * `min`/`max` nativo não segura digitação/colagem).
   *
   * Os limites saem de `formValue()`, então mexer em início/fim recalcula os
   * bounds e reavalia a retirada no mesmo ciclo. Sem período preenchido não há
   * limite — cada ponta é independente da outra.
   */
  protected readonly pickupMin = computed(() => {
    const start = asDay(this.formValue()?.startDate);
    return start ? `${start}T00:00` : null;
  });

  protected readonly pickupMax = computed(() => {
    const end = asDay(this.formValue()?.endDate);
    return end ? `${end}T23:59` : null;
  });

  protected readonly pickupOutsidePeriod = computed(() => {
    const v = this.formValue();
    return isPickupOutsidePeriod(v?.startDate, v?.endDate, v?.pickupDate);
  });

  /** Texto auxiliar sob o campo; `null` quando não há período pra anunciar. */
  protected readonly pickupPeriodHint = computed(() => {
    const start = toBrDate(this.formValue()?.startDate);
    const end = toBrDate(this.formValue()?.endDate);
    if (start && end) return `Deve estar entre ${start} e ${end}.`;
    if (start) return `Deve ser em ${start} ou depois.`;
    if (end) return `Deve ser até ${end}.`;
    return null;
  });

  protected readonly pickupPeriodError = computed(() => {
    const start = toBrDate(this.formValue()?.startDate);
    const end = toBrDate(this.formValue()?.endDate);
    if (start && end) return `A retirada deve estar entre ${start} e ${end}.`;
    if (start) return `A retirada não pode ser antes de ${start}.`;
    if (end) return `A retirada não pode ser depois de ${end}.`;
    return 'A retirada deve estar dentro do período do aluguel.';
  });

  /** Aponta o leitor de tela pra mensagem que estiver visível no momento. */
  protected readonly pickupDescribedBy = computed(() => {
    if (this.pickupOutsidePeriod()) return 'rental-pickup-date-error';
    return this.pickupPeriodHint() ? 'rental-pickup-date-hint' : null;
  });

  /**
   * Rascunho (create-only).
   *
   * Os cards de Contrato/Cobrança levam o usuário pra `/configuracoes/...` via
   * router — o componente é destruído e o preenchimento se perdia. Gravamos o
   * valor bruto do form em sessionStorage a cada mudança e restauramos ao voltar.
   *
   * `draftRestored` alimenta o aviso na UI e impede que o default de
   * `useContractTemplate` sobrescreva a escolha do usuário quando o GET do
   * template responde depois da restauração.
   * `draftSuspended` desliga o autosave depois de um clear intencional
   * (submit bem-sucedido / cancelamento), evitando regravar o que acabou de sair.
   */
  protected readonly draftRestored = signal(false);
  private readonly draftSuspended = signal(false);

  private readonly draftAutosave = effect(() => {
    // `formValue()` é só o gatilho; gravamos o raw value porque `value` omite
    // controles desabilitados e o rascunho voltaria incompleto.
    this.formValue();
    if (this.editingId() !== null || this.draftSuspended()) return;
    this.draftService.save(this.form.getRawValue());
  });

  ngOnInit(): void {
    // Determine mode up-front so the picker filters know whether to include
    // the current rental's vehicle/driver (edit escape hatch).
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.editingId.set(id);

    // Create-only: recupera o que o usuário já tinha digitado antes de sair pra
    // configurar uma integração. Em edição o backend é a fonte da verdade.
    // ANTES da primeira busca de propósito: o rascunho pode trazer o período
    // junto, e assim ele já entra na primeira chamada em vez de custar um
    // segundo round-trip.
    if (!id) this.restoreDraft();

    this.loadPickers();

    // Load Asaas integration status so we can show a warning when the user
    // toggles automatic charge without a connected — or with a broken —
    // integration. O erro é RECLAMADO, nunca engolido: uma falha não lida deixa
    // asaasStatus() null, o que o template não distingue de "não configurada" e
    // que produzia o diálogo bloqueante sobre uma integração saudável para todo
    // usuário abaixo de MANAGER.
    this.asaasService.load().subscribe({
      error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
    });

    // V29: descobre se a company tem template de contrato — habilita o toggle
    // "Gerar contrato do template" e o pré-marca por default. 404 = sem template.
    this.contractTemplateService.get().subscribe({
      next: () => {
        this.hasContractTemplate.set(true);
        // Só liga o default em criação; edição preserva o valor gravado e um
        // rascunho restaurado preserva a escolha explícita do usuário.
        if (!this.editingId() && !this.draftRestored()) {
          this.form.controls.useContractTemplate.setValue(true);
        }
      },
      error: () => this.hasContractTemplate.set(false),
    });

    // Edit mode: pre-fill from backend rental.
    if (id) {
      this.rentalService.getById(id).subscribe({
        next: (r) => {
          const lateFineType: RentalLateFineType = r.lateFineType ?? 'PERCENT';
          const lateFineValueInput =
            lateFineType === 'FIXED'
              ? formatPtBrMoney(r.lateFineValue ?? 0)
              : basisPointsToPercent(r.lateFineValue);
          this.form.patchValue({
            vehicleId: r.vehicleId,
            driverId: r.driverId,
            startDate: r.startDate,
            endDate: r.endDate,
            periodRateReais: formatPtBrMoney(r.periodRate),
            billingFrequency: r.billingFrequency ?? 'DAILY',
            caucaoReais: formatPtBrMoney(r.caucaoAmount),
            caucaoPaid: r.caucaoPaid ?? false,
            automaticCharge: r.automaticCharge ?? false,
            notes: r.notes ?? '',
            initialKm: r.initialKm ?? null,
            pickupDate: toDateTimeLocalInput(r.pickupDate),
            firstPaymentDate: r.firstPaymentDate ?? '',
            lateInterestPercent:
              r.lateInterestPercentPerMonth == null
                ? ''
                : formatPtBrMoney(Math.round(r.lateInterestPercentPerMonth * 100)),
            lateFineType,
            lateFineValueInput,
            franchiseKm: r.franchiseKm ?? null,
            extraKmPriceReais: r.extraKmPrice ? formatPtBrMoney(r.extraKmPrice) : '',
            returnFuelPolicy: r.returnFuelPolicy ?? '',
            useContractTemplate: r.contractSource === 'AUTO',
          });
          // Aluguel legado: só R$/dia, sem %. A tela avisa e pede o % (ver `legacyInterestNotice`).
          const hasPercent = r.lateInterestPercentPerMonth != null;
          this.interestPercentLoaded.set(hasPercent);
          this.legacyDailyInterestCents.set(hasPercent ? 0 : (r.dailyInterestAmount ?? 0));
          // O modo da multa veio do servidor, então os validadores do valor
          // precisam seguir o modo CARREGADO e não o padrão PERCENT do form novo.
          const lateFineValue = this.form.controls.lateFineValueInput;
          lateFineValue.setValidators(this.lateFineValueValidators());
          lateFineValue.updateValueAndValidity({ emitEvent: false });
          // contractSource é imutável após create — não permite alternar em edit.
          this.form.controls.useContractTemplate.disable();
          // Post-load: rentals in COMPLETED/CANCELED are immutable server-side;
          // ACTIVE forbids swapping vehicle/driver. We restrict UI accordingly
          // instead of disabling the whole form (which used to make PUT unusable).
          this.editingStatus.set(r.status);
          if (r.status === 'COMPLETED' || r.status === 'CANCELED') {
            this.form.disable();
          } else if (r.status === 'ACTIVE') {
            this.form.controls.vehicleId.disable();
            this.form.controls.driverId.disable();
            this.form.controls.automaticCharge.disable();
          } else {
            // RESERVED — automaticCharge is not editable (it drives Asaas side-effects)
            this.form.controls.automaticCharge.disable();
          }
        },
        error: (err: HttpErrorResponse) =>
          this.error.set(this.apiErrors.messageFor(err, 'Aluguel não encontrado.')),
      });
    }
  }

  /**
   * Picker fetching for vehicle/driver dropdowns.
   *
   * Sempre passa `availableForRental=true` para o backend excluir veículos e
   * motoristas já em rentals RESERVED/ACTIVE do tenant. Em modo edição, também
   * enviamos `includeCurrentRentalId` — assim o veículo/motorista atualmente
   * vinculado ao rental sendo editado permanece visível na lista.
   *
   * Com período completo, `periodStart`/`periodEnd` entram nas DUAS chamadas e
   * o corte passa a ser por colisão real de intervalo: um carro alugado hoje
   * volta a aparecer para uma reserva futura. Sem período, o backend mantém o
   * comportamento antigo (qualquer aluguel aberto esconde o registro).
   */
  private loadPickers(): void {
    const currentRentalId = this.editingId();
    const requestId = ++this.pickerRequestId;
    this.loadedPeriodKey = this.periodKey();
    const availability = {
      availableForRental: true,
      ...(currentRentalId ? { includeCurrentRentalId: currentRentalId } : {}),
      ...this.periodParams(),
    };
    this.vehiclesService
      .list({ size: 500, sort: 'plate_asc', ...availability })
      .subscribe({
        next: (res) => {
          if (requestId !== this.pickerRequestId) return;
          this.applyVehicles(res.content ?? []);
        },
        // Falha de rede não é "frota vazia": zerar a lista aqui apagaria as
        // opções (e a escolha renderizável) por causa de um blip.
        error: () => {},
      });
    this.driverService
      .list({ size: 500, sort: 'name_asc', ...availability })
      .subscribe({
        next: (res) => {
          if (requestId !== this.pickerRequestId) return;
          this.applyDrivers((res.content ?? []).filter((d) => d.status !== 'SUSPENDED'));
        },
        error: () => {},
      });
  }

  /**
   * `periodStart`/`periodEnd` prontos pro filtro, ou `{}`.
   *
   * Tudo ou nada: o backend responde 400 quando recebe só uma das pontas, e
   * `periodKey()` já devolve `''` em todo estado incompleto ou incoerente.
   */
  private periodParams(): { periodStart: string; periodEnd: string } | Record<string, never> {
    const key = this.periodKey();
    if (!key) return {};
    const [periodStart, periodEnd] = key.split('|');
    return { periodStart, periodEnd };
  }

  /**
   * Reconciliação da seleção depois de um refresh da lista.
   *
   * DECISÃO: quando o veículo/motorista escolhido sai da lista nova, a seleção é
   * LIMPA (e o aviso explica o porquê) em vez de mantida.
   *
   * Manter não era opção: um `<select>` não consegue exibir um valor sem
   * `<option>` correspondente. O campo ficaria em branco segurando o id por
   * baixo — visualmente "não escolhido", mas aprovado pelo `required` — e o
   * usuário só descobriria no 409 do submit. Limpando, o `required` volta a
   * acusar, o campo fica honestamente vazio e o aviso diz o que aconteceu.
   *
   * Controle DESABILITADO nunca é limpo: em rental ACTIVE o veículo/motorista
   * não é reescolhível, então apagá-lo só destruiria o payload do PUT. Na
   * prática o caso não chega aqui — `includeCurrentRentalId` garante que o par
   * do próprio aluguel continua na lista, mesmo com período.
   */
  private applyVehicles(list: VehicleListItem[]): void {
    this.vehicles.set(list);
    const control = this.form.controls.vehicleId;
    const selected = control.value;
    const lost = !!selected && control.enabled && !list.some((v) => v.id === selected);
    if (lost) control.setValue('');
    this.vehicleClearedByPeriod.set(lost);
  }

  private applyDrivers(list: DriverListItem[]): void {
    this.drivers.set(list);
    const control = this.form.controls.driverId;
    const selected = control.value;
    const lost = !!selected && control.enabled && !list.some((d) => d.id === selected);
    if (lost) control.setValue('');
    this.driverClearedByPeriod.set(lost);
  }

  /**
   * Aplica o rascunho controle a controle: chaves desconhecidas (rascunho de uma
   * versão antiga do form) são ignoradas em vez de estourar no `patchValue`.
   * Emitimos eventos de propósito — os totais derivados vêm de `form.valueChanges`.
   */
  private restoreDraft(): void {
    const draft = this.draftService.load();
    if (!draft) return;
    let applied = false;
    for (const [key, value] of Object.entries(draft)) {
      const control = this.form.get(key);
      if (!control) continue;
      control.setValue(value);
      applied = true;
    }
    if (applied) this.draftRestored.set(true);
  }

  /** Descarta o rascunho e volta ao formulário em branco. */
  protected discardDraft(): void {
    this.draftService.clear();
    this.draftRestored.set(false);
    this.form.reset();
    if (this.hasContractTemplate()) {
      this.form.controls.useContractTemplate.setValue(true);
    }
  }

  /** Saída intencional do fluxo — o rascunho não deve sobreviver. */
  private dropDraft(): void {
    this.draftSuspended.set(true);
    this.draftService.clear();
    this.draftRestored.set(false);
  }

  /**
   * Máscara de milhar DURANTE a digitação (FIX-0261), no mesmo padrão do
   * diálogo de venda. O controle guarda TEXTO pt-BR; o total ao vivo e o
   * submit convertem com `ptBrMoneyCents`, então os CENTAVOS enviados à API
   * são os mesmos de antes.
   */
  /** Em FIXED o campo de multa e dinheiro; em PERCENT, percentagem pura. */
  protected readonly lateFineIsFixed = computed(
    () => this.formValue()?.lateFineType === 'FIXED',
  );

  /**
   * Troca do modo da multa de atraso — o valor e LIMPO de proposito.
   *
   * 2 (por cento) e 2,00 (reais) NAO sao o mesmo numero. Preservar o valor na
   * troca manteria o digito na tela enquanto o SIGNIFICADO mudava embaixo dele,
   * que e exatamente o tipo de mudanca silenciosa que ninguem revisa. Zerar e o
   * comportamento previsivel, e o passo a mais para quem trocou de modo sem
   * querer foi o preco aceito por isso.
   *
   * Se voce veio aqui achando que o campo limpar e um bug: nao e. E a decisao.
   */
  protected onLateFineTypeChange(): void {
    const control = this.form.controls.lateFineValueInput;
    control.setValue('');
    control.setValidators(this.lateFineValueValidators());
    control.updateValueAndValidity();
    control.markAsUntouched();
  }

  /** Mascara de milhar so no modo FIXED — PERCENT nao ganhou virgula decimal. */
  protected onLateFineValueInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.form.controls.lateFineValueInput);
  }

  private lateFineValueValidators(): ValidatorFn[] {
    return this.form.controls.lateFineType.value === 'FIXED'
      ? [ptBrMoneyValidator()]
      : [Validators.required, Validators.min(0)];
  }

  protected onMoneyInput(
    event: Event,
    name: 'periodRateReais' | 'caucaoReais' | 'lateInterestPercent' | 'extraKmPriceReais',
  ): void {
    applyPtBrMoneyMaskToControl(event, this.form.controls[name]);
  }

  protected submit(): void {
    // `previewing` entra aqui junto de `saving`: o botão já fica desabilitado, mas
    // Enter dentro de um campo submete o <form> sem passar por ele.
    if (
      this.saving() ||
      this.previewing() ||
      this.preflightBlocked()
    ) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados.');
      return;
    }
    // Integration guards — mirror Asaas/Cobrança guard for the Contrato card.
    // Only relevant on create; edit locks these controls (contractSource
    // and automaticCharge are immutable post-create).
    if (!this.isEdit()) {
      const raw = this.form.getRawValue();
      if (raw.automaticCharge === true && !this.asaasConnected()) {
        this.missingIntegrationTarget.set('asaas');
        return;
      }
      if (raw.useContractTemplate === true && !this.hasContractTemplate()) {
        this.missingIntegrationTarget.set('contract');
        return;
      }
    }
    this.error.set(null);
    clearServerErrors(this.form);

    const editingId = this.editingId();
    if (editingId) {
      this.updateRental(editingId);
      return;
    }

    const payload = this.buildCreatePayload();
    if (payload.automaticCharge === true) {
      // Cobrança automática: criar o aluguel JÁ dispara as cobranças no Asaas, e
      // isso não se desfaz com um "voltar". Primeiro a prévia, depois o diálogo.
      this.requestChargePreview(payload);
      return;
    }
    // Manual: nada vai ao gateway, então não há o que confirmar. Criar direto é o
    // caminho mais leve — um diálogo aqui só repetiria o botão que acabou de ser
    // clicado, sem dizer nada que a tela já não diga.
    this.createRental(payload);
  }

  private updateRental(editingId: string): void {
    this.saving.set(true);
    const updatePayload = this.buildUpdatePayload();
    this.rentalService.update(editingId, updatePayload).subscribe({
      next: (r) => {
        this.notifications.success('Alterações salvas.');
        this.router.navigate(['/alugueis', r.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (this.claimPreflightError(err)) return;
        if (this.claimFeeBelowChargeError(err)) return;
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível salvar as alterações.',
        );
        this.error.set(formMessage);
      },
    });
  }

  /** Corpo do PUT a partir do formulário. */
  private buildUpdatePayload(): RentalUpdateRequest {
    const raw = this.form.getRawValue();
    const caucao = ptBrMoneyCents(raw.caucaoReais) ?? 0;
    return {
      vehicleId: raw.vehicleId,
      driverId: raw.driverId,
      startDate: raw.startDate,
      endDate: raw.endDate,
      periodRate: ptBrMoneyCents(raw.periodRateReais) ?? 0,
      billingFrequency: raw.billingFrequency,
      caucaoAmount: caucao,
      caucaoPaid: caucao > 0 ? raw.caucaoPaid === true : false,
      notes: raw.notes?.trim() || undefined,
      initialKm: raw.initialKm ?? null,
      pickupDate: fromDateTimeLocalInput(raw.pickupDate),
      firstPaymentDate: raw.firstPaymentDate?.trim() || null,
      ...this.interestFields(true),
      ...this.lateFineFields(),
      franchiseKm: raw.franchiseKm ?? null,
      returnFuelPolicy: raw.returnFuelPolicy?.trim() || null,
      // PUT parcial: o form sempre sabe o valor, então manda explícito — vazio ou sem
      // franquia vira 0 (limpa); nunca `null`, que manteria um preço que a tela não mostra.
      extraKmPrice: this.extraKmPriceCents() ?? 0,
    };
  }

  /** Centavos do km excedente, ou `null` sem franquia/sem valor (o campo nem aparece). */
  private extraKmPriceCents(): number | null {
    if (!this.hasKmLimit()) return null;
    const cents = ptBrMoneyCents(this.form.getRawValue().extraKmPriceReais);
    return cents && cents > 0 ? cents : null;
  }

  /** Corpo do preflight: o do create, ou o da edição acrescido do `rentalId`. */
  private buildPreflightPayload(): RentalPreflightRequest {
    const editingId = this.editingId();
    if (!editingId) return this.buildCreatePayload();
    const raw = this.form.getRawValue();
    return {
      ...this.buildUpdatePayload(),
      rentalId: editingId,
      automaticCharge: raw.automaticCharge === true,
      contractSource: raw.useContractTemplate ? 'AUTO' : 'MANUAL',
    };
  }

  /**
   * Juros no corpo. Aluguel novo nunca manda R$/dia (o backend recusa > 0). Na edição:
   * com % digitado, manda o % e zera o R$/dia (os dois juntos seriam conflito); campo
   * vazio num aluguel que JÁ tinha % zera o %; num legado, omite o % e devolve o R$/dia
   * como veio — o PUT omitir o % mantém o que o aluguel tem.
   */
  private interestFields(
    editing: boolean,
  ): { dailyInterestAmount?: number; lateInterestPercentPerMonth?: number } {
    const hundredths = ptBrMoneyCents(this.form.getRawValue().lateInterestPercent);
    if (hundredths !== null) {
      return editing
        ? { dailyInterestAmount: 0, lateInterestPercentPerMonth: hundredths / 100 }
        : { lateInterestPercentPerMonth: hundredths / 100 };
    }
    if (!editing) return {};
    return this.interestPercentLoaded()
      ? { dailyInterestAmount: 0, lateInterestPercentPerMonth: 0 }
      : { dailyInterestAmount: this.legacyDailyInterestCents() };
  }

  /** Corpo do create a partir do formulário — o MESMO que a prévia recebe. */
  private buildCreatePayload(): CreateRentalRequest {
    const raw = this.form.getRawValue();
    const caucao = ptBrMoneyCents(raw.caucaoReais) ?? 0;
    return {
      vehicleId: raw.vehicleId,
      driverId: raw.driverId,
      startDate: raw.startDate,
      endDate: raw.endDate,
      periodRate: ptBrMoneyCents(raw.periodRateReais) ?? 0,
      billingFrequency: raw.billingFrequency,
      caucaoAmount: caucao,
      caucaoPaid: caucao > 0 ? raw.caucaoPaid === true : false,
      automaticCharge: raw.automaticCharge === true,
      notes: raw.notes?.trim() || undefined,
      initialKm: raw.initialKm ?? null,
      pickupDate: fromDateTimeLocalInput(raw.pickupDate),
      firstPaymentDate: raw.firstPaymentDate?.trim() || null,
      ...this.interestFields(false),
      ...this.lateFineFields(),
      franchiseKm: raw.franchiseKm ?? null,
      returnFuelPolicy: raw.returnFuelPolicy?.trim() || null,
      extraKmPrice: this.extraKmPriceCents(),
      contractSource: raw.useContractTemplate ? 'AUTO' : 'MANUAL',
    };
  }

  private lateFineFields(): { lateFineType: RentalLateFineType; lateFineValue: number } {
    const raw = this.form.getRawValue();
    const lateFineType: RentalLateFineType = raw.lateFineType;
    const lateFineRaw = raw.lateFineValueInput;
    const lateFineValue =
      lateFineType === 'FIXED'
        ? (ptBrMoneyCents(typeof lateFineRaw === 'string' ? lateFineRaw : '') ?? 0)
        : percentToBasisPoints(Number(lateFineRaw ?? 0));
    return { lateFineType, lateFineValue };
  }

  // ------------------------------------------------------------------
  // Confirmação da cobrança automática.
  //
  // Fluxo: "Criar aluguel" → prévia (`POST /rentals/charge-preview`, nada é
  // gravado) → diálogo com o resumo → "Criar aluguel e cobranças" cria de fato.
  // "Voltar e editar" fecha sem chamar nada e devolve o formulário intacto.
  // ------------------------------------------------------------------

  /** Consultando a prévia. Mesmo padrão de botão do `saving`: rótulo + disabled. */
  protected readonly previewing = signal(false);
  protected readonly chargeConfirmOpen = signal(false);
  protected readonly chargePreview = signal<ChargePreviewSummary | null>(null);

  /**
   * O corpo congelado quando a prévia foi pedida. O resumo mostra ESTE corpo, então
   * é ele que o confirmar envia — e não uma releitura do formulário.
   */
  private pendingCreate: CreateRentalRequest | null = null;

  protected readonly chargeConfirmMessage = computed(() => {
    const summary = this.chargePreview();
    if (!summary) return '';
    if (summary.blocker) {
      return 'Nada foi criado. Volte e edite o aluguel para continuar.';
    }
    if (!summary.willCreateInGateway) {
      return (
        'Ao confirmar, o aluguel é criado. Nenhuma cobrança vai ao Asaas agora: ' +
        'elas ficam só registradas aqui. Para mudar algo, volte e edite.'
      );
    }
    return (
      'Ao confirmar, o aluguel é criado e as cobranças são geradas no Asaas agora. ' +
      'Para mudar algo, volte e edite.'
    );
  });

  /** Vazio some com o botão: com impeditivo só resta o "Voltar e editar". */
  protected readonly chargeConfirmLabel = computed(() => {
    if (this.chargePreview()?.blocker) return '';
    return this.saving() ? 'Criando…' : 'Criar aluguel e cobranças';
  });

  protected readonly chargeSummaryRows = computed<Array<{ label: string; value: string }>>(() => {
    const summary = this.chargePreview();
    if (!summary || summary.blocker) return [];
    const rows: Array<{ label: string; value: string }> = [];
    if (summary.willCreateInGateway) {
      rows.push({ label: 'Cobranças no Asaas', value: String(summary.gatewayCount) });
    }
    rows.push({ label: '1º vencimento', value: toBrDate(summary.firstDueDate) ?? '—' });
    if (summary.periodCount > 0) {
      rows.push({
        label: 'Valor por cobrança',
        value:
          summary.uniformPeriodCents === null
            ? 'Valores variam'
            : formatBrl(summary.uniformPeriodCents),
      });
    }
    if (summary.caucao) {
      const due = toBrDate(summary.caucao.dueDate) ?? '—';
      rows.push({
        label: 'Caução',
        value: `${formatBrl(summary.caucao.amountCents)} · vence em ${due}`,
      });
    }
    rows.push({ label: 'Total', value: formatBrl(summary.totalCents) });
    return rows;
  });

  /** Aviso das cobranças que NÃO vão ao Asaas por já estarem vencidas. */
  protected readonly localChargesNote = computed<string | null>(() => {
    const summary = this.chargePreview();
    if (!summary || summary.blocker || summary.localCount <= 0) return null;
    return summary.localCount === 1
      ? '1 cobrança com vencimento anterior a hoje fica só registrada aqui, sem ir ao Asaas.'
      : `${summary.localCount} cobranças com vencimento anterior a hoje ficam só registradas aqui, sem ir ao Asaas.`;
  });

  private requestChargePreview(payload: CreateRentalRequest): void {
    this.previewing.set(true);
    this.rentalService.chargePreview(payload).subscribe({
      next: (preview) => {
        this.previewing.set(false);
        this.pendingCreate = payload;
        this.chargePreview.set(summarizeChargePreview(preview));
        this.chargeConfirmOpen.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.previewing.set(false);
        this.failCreate(err, 'Não foi possível conferir as cobranças. Tente novamente.');
      },
    });
  }

  protected confirmCharges(): void {
    const payload = this.pendingCreate;
    // `saving` é a trava do duplo clique: o botão desabilita, mas o handler também
    // recusa — um segundo evento antes do próximo ciclo de detecção não pode criar
    // dois aluguéis.
    if (!payload || this.saving() || this.chargePreview()?.blocker) return;
    this.createRental(payload);
  }

  /** "Voltar e editar": nada é chamado e o formulário segue como o usuário deixou. */
  protected cancelCharges(): void {
    if (this.saving()) return;
    this.chargeConfirmOpen.set(false);
    this.pendingCreate = null;
  }

  private createRental(payload: CreateRentalRequest): void {
    this.saving.set(true);
    this.error.set(null);
    this.rentalService.create(payload).subscribe({
      next: (r) => {
        // Aluguel criado: o rascunho cumpriu sua função e some.
        this.dropDraft();
        this.chargeConfirmOpen.set(false);
        this.notifications.success('Aluguel criado.');
        // Parte das cobranças pode não ter sido criada no Asaas: o aluguel existe,
        // então o usuário vai ao detalhe e o aviso viaja junto. Sem falha, a
        // navegação é a de sempre.
        const sync = r.chargeSync;
        if (sync && sync.failed > 0) {
          this.router.navigate(['/alugueis', r.id], {
            state: { [RENTAL_CHARGE_SYNC_STATE_KEY]: sync },
          });
        } else {
          this.router.navigate(['/alugueis', r.id]);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.failCreate(err, 'Não foi possível criar o aluguel.');
      },
    });
  }

  /**
   * Falha da prévia ou do create: o diálogo fecha, o formulário fica como está e o
   * erro vai pro banner do topo (campo a campo quando o backend aponta o campo).
   */
  private failCreate(err: HttpErrorResponse, fallback: string): void {
    this.chargeConfirmOpen.set(false);
    this.pendingCreate = null;
    if (this.claimPreflightError(err)) return;
    if (this.claimFeeBelowChargeError(err)) return;
    const { formMessage } = this.apiErrors.handleForm(err, this.form, fallback);
    // The driver was registered without CNH/address and has not completed it yet.
    this.error.set(
      isDriverRegistrationIncomplete(err) ? DRIVER_REGISTRATION_INCOMPLETE_COPY : formMessage,
    );
    this.revealError();
  }

  /** 400 de FIX-0749: a mensagem vai ao MESMO campo, sem banner duplicado. */
  private claimFeeBelowChargeError(err: HttpErrorResponse): boolean {
    if (!applyFeeBelowChargeServerError(err, this.form)) return false;
    this.apiErrors.claim(err);
    this.error.set(null);
    return true;
  }

  /** Leva o banner ao campo de visão — só se ele estiver fora da tela. */
  private revealError(): void {
    afterNextRender(
      () => {
        const el = this.formErrorBanner()?.nativeElement;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const viewport = el.ownerDocument.documentElement.clientHeight;
        if (rect.bottom > 0 && rect.top < viewport) return;
        el.scrollIntoView?.({ block: 'center' });
        el.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /**
   * User confirmed the "not configured" dialog — navigate to the appropriate
   * settings page so they can fix it before returning. Mirrors the inline
   * "Configure agora" link on both cards.
   *
   * Só o OWNER navega: `/configuracoes/*` é OWNER-only e um MANAGER seria
   * redirecionado em silêncio pro `/dashboard`, perdendo o formulário. Pra ele o
   * botão é apenas um "Entendi" — fecha o dialog e devolve o form intacto, com o
   * aviso do card ainda visível.
   */
  protected confirmMissingIntegration(): void {
    const target = this.missingIntegrationTarget();
    this.missingIntegrationTarget.set(null);
    if (!this.isOwner) return;
    if (target === 'asaas') {
      this.router.navigate(['/configuracoes/integracoes/asaas']);
    } else if (target === 'contract') {
      this.router.navigate(['/configuracoes/contratos']);
    }
  }

  protected cancelMissingIntegration(): void {
    this.missingIntegrationTarget.set(null);
  }

  protected cancel(): void {
    this.dropDraft();
    if (this.isEdit()) {
      this.router.navigate(['/alugueis', this.editingId()]);
    } else {
      this.router.navigate(['/alugueis']);
    }
  }

  /**
   * "Retirada obrigatória e ainda vazia". Substitui o antigo `fieldInvalid()`
   * genérico APENAS para a retirada — o único campo que não foi migrado pra
   * `<app-form-field>`, porque a mensagem dele depende do validador de grupo.
   */
  protected pickupRequiredMissing(): boolean {
    const ctrl = this.form.controls.pickupDate;
    return ctrl.invalid && ctrl.touched;
  }

  protected formHasEndBeforeStart(): boolean {
    return !!this.form.errors?.['endBeforeStart'] && this.form.touched;
  }

  protected formatPlate(plate: string): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }
}

/** Unidade do período na ajuda da 1ª cobrança ("a cada dia / semana / mês"). */
const FIRST_PAYMENT_PERIOD_UNIT: Record<RentalBillingFrequency, string> = {
  DAILY: 'dia',
  WEEKLY: 'semana',
  MONTHLY: 'mês',
};

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/**
 * A 1ª cobrança não pode vencer depois do fim do aluguel — nenhum período chegaria
 * a ser cobrado. Compara DIA com DIA (strings `yyyy-MM-dd`, sem fuso). Sem uma das
 * duas datas não há o que comparar: quem acusa o vazio é o `required`.
 */
function firstPaymentNotAfterEndValidator(control: AbstractControl): ValidationErrors | null {
  const first = asDay(control.value);
  const end = asDay(control.parent?.get('endDate')?.value);
  if (!first || !end) return null;
  return first > end ? { firstPaymentAfterEnd: true } : null;
}

function endAfterStartValidator(group: AbstractControl): ValidationErrors | null {
  const start = group.get('startDate')?.value as string;
  const end = group.get('endDate')?.value as string;
  if (!start || !end) return null;
  if (end < start) return { endBeforeStart: true };
  return null;
}

/**
 * Espelha a regra do backend: `pickupDate` tem que cair dentro do período do
 * aluguel. Fica no grupo (e não no controle) porque depende de três controles;
 * qualquer `setValue`/`patchValue` em um deles reexecuta o grupo, então a
 * restauração do rascunho — que aplica controle a controle — também é coberta.
 */
function pickupWithinPeriodValidator(group: AbstractControl): ValidationErrors | null {
  const start = group.get('startDate')?.value as unknown;
  const end = group.get('endDate')?.value as unknown;
  const pickup = group.get('pickupDate')?.value as unknown;
  return isPickupOutsidePeriod(start, end, pickup) ? { pickupOutsidePeriod: true } : null;
}

/**
 * Janela pra colapsar a rajada de emissões do `<input type="date">` antes de
 * refazer as buscas dos pickers. Mesmo valor da busca da `rentals-list`.
 */
const PICKER_RELOAD_DEBOUNCE_MS = 300;

/** Pausa antes de conferir no backend: um campo de texto emite a cada tecla. */
const PREFLIGHT_DEBOUNCE_MS = 400;

interface PreflightRun {
  response: RentalPreflightResponse;
  /** `null` = a prévia ainda vem aí: mantém a lista que já estava na tela. */
  schedule: ChargeScheduleRow[] | null;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `yyyy-MM-dd` normalizado, ou `null` se o valor não for uma data utilizável. */
function asDay(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const day = value.slice(0, 10);
  return DAY_PATTERN.test(day) ? day : null;
}

/**
 * Data que existe no calendário, e não só no formato: `DAY_PATTERN` aprova
 * `2026-13-45`, que o backend rejeitaria com 400 no parse. Comparação em UTC
 * pra não deixar o fuso deslocar o dia no round-trip.
 */
function isRealDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** `dd/MM/yyyy` a partir de `yyyy-MM-dd` — sem `Date`, sem surpresa de fuso. */
function toBrDate(value: unknown): string | null {
  const day = asDay(value);
  if (!day) return null;
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/**
 * Comparação por DIA (a hora da retirada é livre) e INCLUSIVA nas duas pontas:
 * retirada no primeiro e no último dia do período é válida. Cada ponta só
 * restringe se estiver preenchida — período em branco não inventa limite.
 */
function isPickupOutsidePeriod(start: unknown, end: unknown, pickup: unknown): boolean {
  const pickupDay = asDay(pickup);
  if (!pickupDay) return false;
  const startDay = asDay(start);
  if (startDay && pickupDay < startDay) return true;
  const endDay = asDay(end);
  return !!endDay && pickupDay > endDay;
}

/**
 * V29 helpers para multa de atraso, agora SÓ do modo percentual.
 * PERCENT no BD é basis-points (200 = 2%); no form pede-se percentagem (2 = 2%).
 * O modo FIXED deixou de passar por aqui: ele é dinheiro mascarado e converte
 * pelo mesmo caminho dos outros campos de valor (`ptBrMoneyCents` /
 * `formatPtBrMoney`), sem multiplicação própria.
 */
function percentToBasisPoints(input: number): number {
  if (!Number.isFinite(input) || input <= 0) return 0;
  return Math.round(input * 100); // 2 → 200
}

function basisPointsToPercent(stored: number | null): number {
  if (stored == null || stored === 0) return 0;
  return stored / 100; // 200 → 2
}

/**
 * Converte ISO 8601 do backend (UTC ou local naive) para o formato
 * `yyyy-MM-ddTHH:mm` esperado por `<input type="datetime-local">`.
 * Trata null → '' pra não sujar o form.
 */
function toDateTimeLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Volta pra ISO 8601 mantendo o horário local (sem TZ shift). */
function fromDateTimeLocalInput(v: string | null | undefined): string | null {
  if (!v) return null;
  // `<input type="datetime-local">` devolve algo como "2026-07-16T14:30" —
  // backend recebe LocalDateTime sem TZ, então enviamos como está.
  return v;
}

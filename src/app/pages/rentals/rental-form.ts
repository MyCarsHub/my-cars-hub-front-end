import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { debounceTime } from 'rxjs';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
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
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
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
  RentalBillingFrequency,
  RentalLateFineType,
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

  /** V29: true se a company tem template de contrato — controla default do toggle. */
  protected readonly hasContractTemplate = signal(false);

  /**
   * `/configuracoes/*` é OWNER-only (`roleGuard(['OWNER'])` em `app.routes.ts`).
   * `/alugueis` continua OWNER+MANAGER, então um MANAGER chega até aqui e via
   * link/navegação programática caía num redirect silencioso pro `/dashboard`.
   *
   * A derivação é a MESMA de `pages/company-settings/company-settings.ts` e do
   * `roleGuard`: `selectedRole` no sessionStorage. Lido uma vez na construção —
   * trocar de empresa grava o `selectedRole` novo e navega pro `/dashboard`
   * (`layout.store.ts`, `commitTenant`), o que destrói este componente antes de
   * qualquer releitura. Não há papel "quente".
   *
   * O aviso de "não configurado" continua visível pros dois papéis; o que muda
   * é só a chamada pra ação (link/navegação vs. "peça ao proprietário").
   */
  protected readonly isOwner = this.sessionService.getItem('selectedRole') === 'OWNER';


  protected readonly editingId = signal<string | null>(null);
  protected readonly editingStatus = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

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
  };
  protected readonly initialKmMessages: Readonly<Record<string, string>> = {
    required: 'Informe a quilometragem inicial.',
    min: 'A quilometragem não pode ser negativa.',
  };
  protected readonly firstPaymentMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data da 1ª parcela.',
  };
  protected readonly dailyInterestMessages: Readonly<Record<string, string>> = {
    required: 'Informe o juros diário (0 se não cobrar).',
    min: 'O juros não pode ser negativo.',
  };
  protected readonly lateFineValueMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor da multa (0 se não cobrar).',
    min: 'O valor da multa não pode ser negativo.',
  };
  protected readonly franchiseKmMessages: Readonly<Record<string, string>> = {
    min: 'A franquia não pode ser negativa.',
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
      periodRateReais: [0, [Validators.required, Validators.min(0.01)]],
      caucaoReais: [0, [Validators.min(0)]],
      caucaoPaid: [false],
      automaticCharge: [false],
      notes: [''],

      // V29: Condições de pagamento — todos obrigatórios.
      initialKm: [null as number | null, [Validators.required, Validators.min(0)]],
      pickupDate: ['', [Validators.required]], // datetime-local yyyy-MM-ddTHH:mm
      firstPaymentDate: ['', [Validators.required]], // yyyy-MM-dd
      dailyInterestReais: [0, [Validators.required, Validators.min(0)]],
      lateFineType: ['PERCENT' as RentalLateFineType, [Validators.required]],
      // PERCENT: percentagem (2 = 2%). FIXED: reais.
      lateFineValueInput: [0, [Validators.required, Validators.min(0)]],

      // V32: franquia e política de combustível — opcionais.
      franchiseKm: [null as number | null, [Validators.min(0)]],
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
    const cents = toCents(Number(v?.periodRateReais ?? 0));
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
    () => Number(this.formValue()?.caucaoReais ?? 0) > 0,
  );

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
    // toggles automatic charge without a connected integration.
    this.asaasService.load().subscribe({ error: () => {} });

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
          const lateFineValueInput = fromLateFineStored(lateFineType, r.lateFineValue);
          this.form.patchValue({
            vehicleId: r.vehicleId,
            driverId: r.driverId,
            startDate: r.startDate,
            endDate: r.endDate,
            periodRateReais: r.periodRate / 100,
            billingFrequency: r.billingFrequency ?? 'DAILY',
            caucaoReais: r.caucaoAmount / 100,
            caucaoPaid: r.caucaoPaid ?? false,
            automaticCharge: r.automaticCharge ?? false,
            notes: r.notes ?? '',
            initialKm: r.initialKm ?? null,
            pickupDate: toDateTimeLocalInput(r.pickupDate),
            firstPaymentDate: r.firstPaymentDate ?? '',
            dailyInterestReais: (r.dailyInterestAmount ?? 0) / 100,
            lateFineType,
            lateFineValueInput,
            franchiseKm: r.franchiseKm ?? null,
            returnFuelPolicy: r.returnFuelPolicy ?? '',
            useContractTemplate: r.contractSource === 'AUTO',
          });
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

  protected submit(): void {
    if (this.saving()) return;
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
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);
    const raw = this.form.getRawValue();
    const periodRate = toCents(Number(raw.periodRateReais)) ?? 0;
    const caucao = toCents(Number(raw.caucaoReais ?? 0)) ?? 0;

    // V29: campos financeiros
    const dailyInterestAmount = toCents(Number(raw.dailyInterestReais ?? 0)) ?? 0;
    const lateFineType: RentalLateFineType = raw.lateFineType;
    const lateFineValue = toLateFineStored(lateFineType, Number(raw.lateFineValueInput ?? 0));
    const pickupDateIso = fromDateTimeLocalInput(raw.pickupDate);
    const firstPaymentDate = raw.firstPaymentDate?.trim() || null;
    const initialKm = raw.initialKm ?? null;
    // V32
    const franchiseKm = raw.franchiseKm ?? null;
    const returnFuelPolicy = raw.returnFuelPolicy?.trim() || null;

    const editingId = this.editingId();
    if (editingId) {
      const updatePayload: RentalUpdateRequest = {
        vehicleId: raw.vehicleId,
        driverId: raw.driverId,
        startDate: raw.startDate,
        endDate: raw.endDate,
        periodRate,
        billingFrequency: raw.billingFrequency,
        caucaoAmount: caucao,
        caucaoPaid: caucao > 0 ? raw.caucaoPaid === true : false,
        notes: raw.notes?.trim() || undefined,
        initialKm,
        pickupDate: pickupDateIso,
        firstPaymentDate,
        dailyInterestAmount,
        lateFineType,
        lateFineValue,
        franchiseKm,
        returnFuelPolicy,
      };
      this.rentalService.update(editingId, updatePayload).subscribe({
        next: (r) => {
          this.notifications.success('Alterações salvas.');
          this.router.navigate(['/alugueis', r.id]);
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          const { formMessage } = this.apiErrors.handleForm(
            err,
            this.form,
            'Não foi possível salvar as alterações.',
          );
          this.error.set(formMessage);
        },
      });
      return;
    }

    const payload: CreateRentalRequest = {
      vehicleId: raw.vehicleId,
      driverId: raw.driverId,
      startDate: raw.startDate,
      endDate: raw.endDate,
      periodRate,
      billingFrequency: raw.billingFrequency,
      caucaoAmount: caucao,
      caucaoPaid: caucao > 0 ? raw.caucaoPaid === true : false,
      automaticCharge: raw.automaticCharge === true,
      notes: raw.notes?.trim() || undefined,
      initialKm,
      pickupDate: pickupDateIso,
      firstPaymentDate,
      dailyInterestAmount,
      lateFineType,
      lateFineValue,
      franchiseKm,
      returnFuelPolicy,
      contractSource: raw.useContractTemplate ? 'AUTO' : 'MANUAL',
    };

    this.rentalService.create(payload).subscribe({
      next: (r) => {
        // Aluguel criado: o rascunho cumpriu sua função e some.
        this.dropDraft();
        this.notifications.success('Aluguel criado.');
        this.router.navigate(['/alugueis', r.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível criar o aluguel.',
        );
        this.error.set(formMessage);
      },
    });
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
 * V29 helpers para multa de atraso.
 * PERCENT no BD é basis-points (200 = 2%); no form pede-se percentagem (2 = 2%).
 * FIXED no BD é centavos; no form pede-se reais.
 */
function toLateFineStored(type: RentalLateFineType, input: number): number {
  if (!Number.isFinite(input) || input <= 0) return 0;
  return type === 'PERCENT'
    ? Math.round(input * 100) // 2 → 200
    : Math.round(input * 100); // 1.5 → 150
}

function fromLateFineStored(type: RentalLateFineType, stored: number | null): number {
  if (stored == null || stored === 0) return 0;
  return type === 'PERCENT' ? stored / 100 : stored / 100;
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

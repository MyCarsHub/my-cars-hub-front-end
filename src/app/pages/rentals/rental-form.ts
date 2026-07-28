import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
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
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { BillingAccessService } from '../../services/billing-access.service';
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
  private readonly billingAccess = inject(BillingAccessService);
  private readonly asaasService = inject(AsaasIntegrationService);
  private readonly contractTemplateService = inject(ContractTemplateService);
  private readonly draftService = inject(RentalDraftService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** V29: true se a company tem template de contrato — controla default do toggle. */
  protected readonly hasContractTemplate = signal(false);


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

  protected readonly billingFrequencyOptions = BILLING_FREQUENCY_OPTIONS;

  // TRIAL gate — read from cached BillingAccessService; the app-shell already
  // primed the cache after login, so this is synchronous in practice.
  protected readonly isTrial = computed(
    () => this.billingAccess.status()?.plan?.code === 'TRIAL',
  );

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

  protected readonly totalDays = computed(() => {
    const v = this.formValue();
    if (!v?.startDate || !v?.endDate) return 0;
    const s = new Date(v.startDate + 'T00:00:00').getTime();
    const e = new Date(v.endDate + 'T00:00:00').getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
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
        return 'Configure a integração Asaas antes de habilitar cobrança automática neste aluguel.';
      case 'contract':
        return 'Configure o template de contrato antes de habilitar a geração automática neste aluguel.';
      default:
        return '';
    }
  });

  protected readonly missingIntegrationConfirmLabel = computed(() =>
    this.missingIntegrationTarget() === 'asaas' ? 'Configurar Asaas' : 'Configurar contrato',
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
    // `formValue()` é só o gatilho; gravamos o raw value pra não perder
    // controles desabilitados (ex.: automaticCharge no plano TRIAL).
    this.formValue();
    if (this.editingId() !== null || this.draftSuspended()) return;
    this.draftService.save(this.form.getRawValue());
  });

  ngOnInit(): void {
    // Determine mode up-front so the picker filters know whether to include
    // the current rental's vehicle/driver (edit escape hatch).
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.editingId.set(id);
    this.loadPickers(id);

    // Create-only: recupera o que o usuário já tinha digitado antes de sair pra
    // configurar uma integração. Em edição o backend é a fonte da verdade.
    if (!id) this.restoreDraft();

    // Prime billing access (cached — no-op if already loaded elsewhere).
    this.billingAccess.load().subscribe();

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

    // Disable the toggle up-front when we already know the plan is TRIAL.
    // A microtask-level effect could handle late arrivals; for now, patch on
    // load and the template also reads isTrial() to reinforce.
    if (this.isTrial()) {
      this.form.controls.automaticCharge.disable();
    }

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
   */
  private loadPickers(currentRentalId: string | null): void {
    this.vehiclesService
      .list({
        size: 500,
        sort: 'plate_asc',
        availableForRental: true,
        ...(currentRentalId ? { includeCurrentRentalId: currentRentalId } : {}),
      })
      .subscribe({
        next: (res) => this.vehicles.set(res.content ?? []),
        error: () => this.vehicles.set([]),
      });
    this.driverService
      .list({
        size: 500,
        sort: 'name_asc',
        availableForRental: true,
        ...(currentRentalId ? { includeCurrentRentalId: currentRentalId } : {}),
      })
      .subscribe({
        next: (res) =>
          this.drivers.set((res.content ?? []).filter((d) => d.status !== 'SUSPENDED')),
        error: () => this.drivers.set([]),
      });
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
   */
  protected confirmMissingIntegration(): void {
    const target = this.missingIntegrationTarget();
    this.missingIntegrationTarget.set(null);
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

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `yyyy-MM-dd` normalizado, ou `null` se o valor não for uma data utilizável. */
function asDay(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const day = value.slice(0, 10);
  return DAY_PATTERN.test(day) ? day : null;
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

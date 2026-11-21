import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PaintedCard } from '../../../components/core/painted-card/painted-card';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../../components/segmented-toggle/segmented-toggle';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyContactGate, isCompanyContactIncomplete } from '../../../services/company-contact-gate.service';
import { SessionService } from '../../../services/session.service';
import { VehiclesService } from '../../../services/vehicles.service';
import { DriverService } from '../../../services/driver.service';
import { AsaasIntegrationService } from '../../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../../company-settings/contract-template/contract-template-service';
import { RentalService } from '../rental.service';
import {
  DRIVER_REGISTRATION_INCOMPLETE_COPY,
  isDriverRegistrationIncomplete,
} from '../../../services/driver-invite-outcome';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents } from '../../../utils/validators/ptbr-money.validator';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { formatPersonName, formatPlate, formatVehicleLabel } from '../../../utils/display-format';
import {
  RENTAL_CHARGE_SYNC_STATE_KEY,
  RentalBillingFrequency,
  CreateRentalRequest,
  RentalChargePreviewDto,
  RentalChargeSyncDto,
  RentalLateFineType,
  RentalPreflightItem,
} from '../../../types/rental.types';
import { VehicleListItem } from '../../../types/vehicle.types';
import { DriverListItem } from '../../../types/driver.types';
import { IntervalUnit, addDaysIso, percentTextToBps, splitEvenly } from '../charges-flex/charges-flex';
import { PLAN_ERROR_MESSAGES, apiErrorCode, companySafe, planBlockerMessage } from '../charges-flex/flex-errors';
import { messageWithAccepted, readPreflightError } from '../rental-preflight';
import {
  CAUCAO_PARTS_MAX,
  INTEREST_MAX_PERCENT,
  INTERVAL_MAX,
  OFFSET_MAX_DAYS,
  SPLIT_COUNT_MAX,
  SPLIT_COUNT_MIN,
  WizardInput,
  buildWizardPlan,
  caucaoDue,
  localCharges,
  minChargeCents,
  periodAmounts,
  periodCount,
  periodDue,
  smallestInstalment,
  totalsOf,
} from './wizard-math';
import { RentalCreateRaw, buildCreateBody, buildPreflightBody } from './wizard-payload';
import {
  FUEL_OPTIONS,
  FUEL_OTHER,
  brl,
  brlShort,
  dLong,
  dShort,
  decimalOf,
  intOf,
  listPeriods,
  periodWords,
  plural,
  weekdayLong,
} from './wizard-format';

/** Passos: 1–7 perguntas, 8 Confira, 9 Aluguel criado. */
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const STEP_NAMES = [
  'Quando',
  'Motorista e carro',
  'Valor',
  'Pagamento',
  'Caução',
  'Desconto ou parcelas',
  'Entrega do carro',
] as const;

/** Em que passo mora cada campo (erros do servidor e "Mudar"). */
const FIELD_STEP: Readonly<Record<string, Step>> = {
  startDate: 1,
  pickupTime: 1,
  pickupDay: 1,
  endDate: 1,
  driverId: 2,
  vehicleId: 2,
  billingFrequency: 3,
  periodRateReais: 3,
  firstPaymentDate: 3,
  automaticCharge: 4,
  caucaoReais: 5,
  caucaoParts: 5,
  discountN: 6,
  discountValue: 6,
  splitCount: 6,
  splitIntervalN: 6,
  splitOffset: 6,
  splitSel: 6,
  splitStale: 6,
  initialKm: 7,
  customFuel: 7,
  franchiseKm: 7,
  extraKmPriceReais: 7,
  lateFineValue: 7,
  lateInterestPercent: 7,
};

/** Campo do corpo (preflight / 400) → controle do passo a passo. */
const CONTROL_BY_SERVER_FIELD: Readonly<Record<string, string>> = {
  vehicleId: 'vehicleId',
  driverId: 'driverId',
  startDate: 'startDate',
  endDate: 'endDate',
  pickupDate: 'pickupTime',
  billingFrequency: 'periodRateReais',
  periodRate: 'periodRateReais',
  firstPaymentDate: 'firstPaymentDate',
  caucaoAmount: 'caucaoReais',
  initialKm: 'initialKm',
  dailyInterestAmount: 'lateInterestPercent',
  lateInterestPercentPerMonth: 'lateInterestPercent',
  lateFineType: 'lateFineValue',
  lateFineValue: 'lateFineValue',
  franchiseKm: 'franchiseKm',
  extraKmPrice: 'extraKmPriceReais',
  returnFuelPolicy: 'customFuel',
};

const INTEGRATION_CODES = new Set([
  'AUTOMATIC_CHARGE_NO_INTEGRATION',
  'ASAAS_KEY_REVOKED',
  'ASAAS_WEBHOOK_NOT_REGISTERED',
  'ASAAS_DAILY_QUOTA_INSUFFICIENT',
  'ASAAS_LIMITS_UNAVAILABLE',
]);

const CONTACT_STILL_INCOMPLETE_COPY =
  'Os dados de contato da locadora ainda estão incompletos. Confira em Configurações > Dados de contato e tente de novo.';

const UNIT_WORDS: Readonly<Record<IntervalUnit, [string, string]>> = {
  DAYS: ['dia', 'dias'],
  WEEKS: ['semana', 'semanas'],
  MONTHS: ['mês', 'meses'],
};

interface SummaryRow {
  k: string;
  v: string;
}
export interface SummarySection {
  step: Step;
  title: string;
  filled: boolean;
  rows: SummaryRow[];
  /** "Mudar" aparece para o que já foi preenchido, fora do próprio passo. */
  canEdit: boolean;
}
interface ChargeLine {
  key: string;
  title: string;
  date: string;
  value: string;
}
interface TopIssue {
  key: string;
  text: string;
  step: Step | null;
  link: { label: string; commands: string[] } | null;
  /** "Tentar de novo" (prévia que falhou). */
  retry?: boolean;
}

interface WizardDraft {
  v: 2;
  form: Record<string, unknown>;
  parts: Array<{ amount: string; due: string }>;
  selected: number[];
  selectedFreq: RentalBillingFrequency;
  step: Step;
  maxStep: Step;
}

const WIZARD_DRAFT_PREFIX = 'rentalWizardDraft';
const CREATE_FALLBACK = 'Não foi possível criar o aluguel. Tente de novo.';

/**
 * Copy própria para os códigos de integração (o texto do servidor cita o provedor). O resto
 * passa pelo texto do servidor, que já é pt-BR, e nunca com o nome do provedor.
 */
const INTEGRATION_COPY: Readonly<Record<string, string>> = {
  AUTOMATIC_CHARGE_NO_INTEGRATION:
    'A cobrança por Pix ainda não está ligada na sua conta. Ligue em Configurações > Integrações ou escolha "Eu recebo por fora".',
  ASAAS_KEY_REVOKED: 'A ligação da cobrança por Pix foi recusada. Refaça a ligação em Configurações > Integrações.',
  ASAAS_WEBHOOK_NOT_REGISTERED:
    'A cobrança por Pix não está recebendo os avisos de pagamento. Refaça a ligação em Configurações > Integrações.',
  ASAAS_DAILY_QUOTA_INSUFFICIENT: 'O limite diário de cobranças por Pix acabou. Tente amanhã ou escolha "Eu recebo por fora".',
  ASAAS_LIMITS_UNAVAILABLE: 'Não deu para conferir os limites da cobrança por Pix agora. Tente de novo em instantes.',
};
const SERVER_FALLBACK = 'O sistema recusou um dos dados. Confira os passos e tente de novo.';

export function serverIssueText(item: RentalPreflightItem): string {
  return INTEGRATION_COPY[item.code] ?? companySafe(messageWithAccepted(item), SERVER_FALLBACK);
}
type CaucaoPart = FormGroup<{ amount: FormControl<string>; due: FormControl<string> }>;

/**
 * Novo aluguel, passo a passo (direção B do protótipo final, v380). Só para quem tem a chave
 * `CHARGES_FLEX`: `/alugueis/novo` abre `RentalNew`, que mostra este passo a passo; sem a chave, o formulário
 * de hoje, intocado.
 *
 * O corpo do create sai de `buildCreateBody`, que repete campo a campo o do formulário de hoje.
 * O resumo de cada passo é a conta local (`wizard-math`); o Confira mostra a prévia do servidor.
 */
@Component({
  selector: 'app-rental-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgTemplateOutlet,
    FormField,
    FieldControl,
    BottomSheet,
    ConfirmDialog,
    PaintedCard,
    SegmentedToggle,
  ],
  templateUrl: './rental-wizard.html',
  styleUrl: './rental-wizard.css',
  // Sem encapsulamento: o atributo por seletor dobrava a folha (orçamento de 8 kB).
  encapsulation: ViewEncapsulation.None,
})
export class RentalWizard implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly asaasService = inject(AsaasIntegrationService);
  private readonly contractTemplateService = inject(ContractTemplateService);
  private readonly contactGate = inject(CompanyContactGate);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(FormBuilder);

  protected readonly isOwner = this.session.getCompanyRoleFromToken() === 'OWNER';
  protected readonly today = todayInBusinessTz();
  protected readonly stepNames = STEP_NAMES;
  protected readonly fuelOptions = FUEL_OPTIONS;
  protected readonly fuelOther = FUEL_OTHER;
  protected readonly dashes = [1, 2, 3, 4, 5, 6, 7] as const;

  // ------------------------------------------------------------------ navegação
  protected readonly step = signal<Step>(1);
  private readonly maxStep = signal<Step>(1);
  /** Veio do "Mudar" do Confira: "Salvar e voltar ao resumo". */
  protected readonly returning = signal(false);
  /** Passos em que o usuário já tentou continuar: só então os erros aparecem. */
  private readonly tried = signal<ReadonlySet<number>>(new Set());
  protected readonly sheetOpen = signal(false);
  protected readonly listOpen = signal(false);

  // ------------------------------------------------------------------ dados
  protected readonly drivers = signal<DriverListItem[]>([]);
  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly pickerQuery = signal('');
  protected readonly driverLost = signal(false);
  protected readonly vehicleLost = signal(false);
  private pickerRequest = 0;
  private loadedPeriod = '';
  protected readonly hasContractTemplate = signal(false);
  protected readonly asaasConnected = computed(() => this.asaasService.status()?.connected === true);
  private automaticTouched = false;

  // ------------------------------------------------------------------ formulário
  protected readonly form = this.fb.nonNullable.group({
    driverId: '',
    vehicleId: '',
    startDate: '',
    pickupTime: '09:00',
    pickupOtherDay: false,
    pickupDay: '',
    endDate: '',
    billingFrequency: 'WEEKLY' as RentalBillingFrequency,
    periodRateReais: '',
    firstPaymentDate: '',
    automaticCharge: false,
    caucaoReais: '',
    caucaoPaid: false,
    caucaoSplit: false,
    descOn: false,
    discountN: '',
    discountType: 'AMOUNT' as 'AMOUNT' | 'PERCENT',
    discountValue: '',
    parcOn: false,
    splitScope: 'ALL' as 'ALL' | 'SOME',
    splitCount: '',
    splitIntervalN: '',
    splitUnit: 'DAYS' as IntervalUnit,
    splitOffset: '0',
    initialKm: '',
    fuel: '',
    customFuel: '',
    hasKmLimit: false,
    franchiseKm: '',
    extraKmPriceReais: '',
    lateFineType: 'PERCENT' as RentalLateFineType,
    lateFineValue: '',
    lateInterestPercent: '',
    useContractTemplate: false,
    notes: '',
  });
  protected readonly caucaoParts = new FormArray<CaucaoPart>([]);
  /** Períodos (0-based) escolhidos em "Só algumas" e a frequência em que foram escolhidos. */
  protected readonly selected = signal<readonly number[]>([]);
  private readonly selectedFreq = signal<RentalBillingFrequency>('WEEKLY');

  /** O valor inteiro do formulário (sem campos opcionais), a cada mudança. */
  protected readonly v = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });
  private readonly partsValue = toSignal(this.caucaoParts.valueChanges, { initialValue: [] });

  // ------------------------------------------------------------------ servidor (Confira)
  protected readonly checking = signal(false);
  protected readonly checkFailed = signal(false);
  protected readonly serverPreview = signal<RentalChargePreviewDto | null>(null);
  /** Problemas do preflight/400 por controle, até o campo mudar. */
  protected readonly serverFieldErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly serverSummary = signal<TopIssue[]>([]);
  protected readonly topError = signal<string | null>(null);
  protected readonly saving = signal(false);
  private contactRetried = false;
  protected readonly created = signal<{ id: string; sync: RentalChargeSyncDto | null } | null>(null);

  // ------------------------------------------------------------------ confirmação de desfazer parcelas
  protected readonly discard = signal<{ kind: 'parc' | 'full'; message: string } | null>(null);

  constructor() {
    // A 1ª cobrança nasce igual ao início e o acompanha, até o usuário escolher outra data.
    let lastStart = '';
    this.form.controls.startDate.valueChanges.pipe(takeUntilDestroyed()).subscribe((start) => {
      const first = this.form.controls.firstPaymentDate;
      if (!first.value || first.value === lastStart) first.setValue(start);
      lastStart = start;
    });
    // Campo alterado: a recusa do servidor para ele deixa de valer.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.dropStaleServerErrors());
    // Os erros calculados viram erros dos controles (o `app-form-field` os mostra no lugar).
    effect(() => {
      const errs = this.visibleErrors();
      untracked(() => this.applyControlErrors(errs));
    });
    // Período novo: recarrega os carros e motoristas livres naquele intervalo.
    effect(() => {
      const key = this.periodKey();
      untracked(() => {
        if (key !== this.loadedPeriod) this.loadPickers();
      });
    });
  }

  ngOnInit(): void {
    const restored = this.restoreDraft();
    // O "Novo aluguel" da página do carro chega com `?vehicleId=`: o carro já vem escolhido.
    const vehicleId = this.route.snapshot?.queryParamMap?.get('vehicleId');
    if (!restored && vehicleId) this.form.controls.vehicleId.setValue(vehicleId);
    this.draftReady = true;
    this.loadPickers();
    this.asaasService.load().subscribe({
      next: () => {
        if (!this.automaticTouched && !this.draftRestored()) {
          this.form.controls.automaticCharge.setValue(this.asaasConnected());
        }
      },
      error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
    });
    this.contractTemplateService.get().subscribe({
      next: () => {
        this.hasContractTemplate.set(true);
        if (!this.draftRestored()) this.form.controls.useContractTemplate.setValue(true);
      },
      error: () => this.hasContractTemplate.set(false),
    });
  }

  // ================================================================== derivados
  protected readonly words = computed(() => periodWords(this.v().billingFrequency ?? 'WEEKLY'));
  private readonly start = computed(() => this.v().startDate ?? '');
  private readonly end = computed(() => this.v().endDate ?? '');
  protected readonly periods = computed(() =>
    this.end() > this.start() ? periodCount(this.start(), this.end(), this.v().billingFrequency ?? 'WEEKLY') : 0,
  );
  private readonly firstDue = computed(() => this.v().firstPaymentDate || this.start());
  protected readonly rateCents = computed(() => ptBrMoneyCents(this.v().periodRateReais) ?? 0);
  protected readonly caucaoCents = computed(() => ptBrMoneyCents(this.v().caucaoReais) ?? 0);
  protected readonly automatic = computed(() => this.v().automaticCharge === true);
  protected readonly canSplitCaucao = computed(() => this.caucaoCents() > 0 && !this.v().caucaoPaid);
  protected readonly caucaoSplitOn = computed(() => this.canSplitCaucao() && this.v().caucaoSplit === true);
  private readonly periodKey = computed(() => (this.periods() > 0 ? `${this.start()}|${this.end()}` : ''));

  /** Valores das partes: as primeiras digitadas, a última é o que falta. */
  protected readonly partAmounts = computed(() => {
    const parts = this.partsValue() as Array<{ amount?: string; due?: string }>;
    const typed = parts.slice(0, -1).map((p) => ptBrMoneyCents(p.amount) ?? 0);
    const rest = this.caucaoCents() - typed.reduce((a, b) => a + b, 0);
    return parts.length === 0 ? [] : [...typed, rest];
  });

  private readonly discountState = computed<WizardInput['discount']>(() => {
    const v = this.v();
    if (!v.descOn) return null;
    const n = intOf(v.discountN);
    const value = v.discountType === 'PERCENT' ? percentTextToBps(v.discountValue) : ptBrMoneyCents(v.discountValue);
    if (!n || value === null || value <= 0) return null;
    return { type: v.discountType ?? 'AMOUNT', value, firstPeriods: Math.min(n, Math.max(this.periods(), 1)) };
  });

  private readonly splitState = computed<WizardInput['split']>(() => {
    const v = this.v();
    if (!v.parcOn) return null;
    return {
      count: intOf(v.splitCount) ?? 0,
      intervalN: intOf(v.splitIntervalN) ?? 1,
      unit: v.splitUnit ?? 'DAYS',
      offsetDays: intOf(v.splitOffset) ?? 0,
      scope: v.splitScope ?? 'ALL',
      selected: this.selectedFreq() === v.billingFrequency ? this.selected() : [],
    };
  });

  protected readonly mathInput = computed<WizardInput>(() => {
    const parts = this.partsValue() as Array<{ due?: string }>;
    const amounts = this.partAmounts();
    return {
      frequency: this.v().billingFrequency ?? 'WEEKLY',
      startDate: this.start(),
      periods: this.periods(),
      firstDue: this.firstDue(),
      rateCents: this.rateCents(),
      today: this.today,
      discount: this.discountState(),
      split: this.splitState(),
      caucaoCents: this.caucaoCents(),
      caucaoPaid: this.v().caucaoPaid === true,
      caucaoParts: this.caucaoSplitOn() ? parts.map((p, i) => ({ dueDate: p.due ?? '', amountCents: amounts[i] ?? 0 })) : null,
    };
  });

  protected readonly charges = computed(() => (this.periods() > 0 && this.rateCents() > 0 ? localCharges(this.mathInput()) : []));
  protected readonly localTotals = computed(() => totalsOf(this.charges()));

  /**
   * Parcelas a refazer: só quando a semana escolhida deixou de existir de verdade — o fim
   * mudou e ela saiu do período, ou a frequência mudou (a "semana 3" virou outra coisa).
   * Valor e datas que ainda cabem não desfazem nada: as parcelas se recalculam.
   */
  protected readonly staleSplits = computed<number[]>(() => {
    const v = this.v();
    if (!v.parcOn || v.splitScope !== 'SOME') return [];
    if (this.selectedFreq() !== v.billingFrequency) return [...this.selected()];
    return this.selected().filter((i) => i >= this.periods());
  });

  /** "Só algumas" com um período já vencido: o servidor não parcela, e nada some calado. */
  private readonly pastSelected = computed(() => {
    const v = this.v();
    if (!v.parcOn || v.splitScope !== 'SOME' || this.staleSplits().length) return [];
    return this.selected().filter((i) => i < this.periods() && periodDue(this.firstDue(), i, v.billingFrequency ?? 'WEEKLY') < this.today);
  });

  // ================================================================== validação
  protected readonly errs = computed<Record<string, string>>(() => {
    const v = this.v();
    const e: Record<string, string> = {};
    const w = this.words();
    // 1
    if (!v.driverId) e['driverId'] = 'Escolha quem vai levar o carro.';
    if (!v.vehicleId) e['vehicleId'] = 'Escolha o carro.';
    // 2
    if (!v.startDate) e['startDate'] = 'Escolha o dia em que ele pega o carro.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.pickupTime ?? '')) e['pickupTime'] = 'Hora inválida. Use horas:minutos, por exemplo 09:00.';
    if (!v.endDate) e['endDate'] = 'Escolha o dia da devolução.';
    else if (v.startDate && v.endDate <= v.startDate) e['endDate'] = 'A devolução precisa ser depois da retirada.';
    if (v.pickupOtherDay && v.startDate && v.endDate) {
      const d = v.pickupDay ?? '';
      if (!d || d < v.startDate || d > v.endDate) {
        e['pickupDay'] = `A retirada precisa ser entre ${dShort(v.startDate)} e ${dShort(v.endDate)}.`;
      }
    }
    // 3
    if (this.rateCents() <= 0) e['periodRateReais'] = `Digite quanto ele paga ${w.per.toLowerCase()}, por exemplo 750,00.`;
    if (!v.firstPaymentDate) e['firstPaymentDate'] = 'Escolha o vencimento da primeira cobrança.';
    else if (v.endDate && v.firstPaymentDate > v.endDate) e['firstPaymentDate'] = 'A 1ª cobrança não pode vencer depois da devolução.';
    // 4
    if (v.automaticCharge && !this.asaasConnected()) {
      e['automaticCharge'] = this.isOwner
        ? 'A cobrança por Pix ainda não está ligada na sua conta. Ligue em Configurações ou escolha "Eu recebo por fora".'
        : 'A cobrança por Pix ainda não está ligada. Peça ao dono da conta para ligar, ou escolha "Eu recebo por fora".';
    }
    // 5
    if ((v.caucaoReais ?? '').trim() !== '' && ptBrMoneyCents(v.caucaoReais) === null) {
      e['caucaoReais'] = 'Digite um valor válido, por exemplo 1.500,00. Ou deixe 0 se não cobra.';
    }
    if (this.caucaoSplitOn()) Object.assign(e, this.partErrors());
    // 6
    Object.assign(e, this.planErrors());
    // 7
    if (intOf(v.initialKm) === null) e['initialKm'] = 'Digite os km do painel, só números. Sem isso o contrato fica incompleto.';
    if (v.fuel === FUEL_OTHER && !(v.customFuel ?? '').trim()) e['customFuel'] = 'Escreva a regra do combustível.';
    if (v.hasKmLimit) {
      const k = intOf(v.franchiseKm);
      if (!k || k < 1) e['franchiseKm'] = 'Digite quantos km por dia.';
      if ((v.extraKmPriceReais ?? '').trim() !== '' && ptBrMoneyCents(v.extraKmPriceReais) === null) {
        e['extraKmPriceReais'] = 'Digite um valor válido, por exemplo 0,50.';
      }
    }
    if (v.lateFineType === 'FIXED') {
      const f = ptBrMoneyCents(v.lateFineValue);
      const minWeek = this.minPeriodCents();
      if (f === null) e['lateFineValue'] = 'Digite um valor válido, por exemplo 50,00. Ou 0 se não cobra.';
      else if (minWeek > 0 && f >= minWeek) {
        e['lateFineValue'] = `A multa precisa ser menor que ${brl(minWeek)}, o menor valor de ${w.lower}.`;
      }
    } else {
      const f = (v.lateFineValue ?? '').trim() === '' ? 0 : decimalOf(v.lateFineValue);
      if (f === null || f >= 100) e['lateFineValue'] = 'Digite um percentual de 0 a 99, por exemplo 2.';
    }
    // Juros é opcional, como hoje: vazio = a chave nem vai no corpo.
    const j = (v.lateInterestPercent ?? '').trim() === '' ? 0 : ptBrMoneyCents(v.lateInterestPercent);
    if (j === null || j > INTEREST_MAX_PERCENT * 100) {
      e['lateInterestPercent'] = `Os juros vão de 0% a ${INTEREST_MAX_PERCENT}% ao mês.`;
    }
    return e;
  });

  private partErrors(): Record<string, string> {
    const e: Record<string, string> = {};
    const amounts = this.partAmounts();
    const parts = this.partsValue() as Array<{ due?: string }>;
    const min = minChargeCents(this.automatic());
    amounts.forEach((a, i) => {
      const last = i === amounts.length - 1;
      if (last && a <= 0) e[`part${i}`] = `As partes passam de ${brl(this.caucaoCents())}, o valor da caução.`;
      else if (!last && a <= 0) e[`part${i}`] = 'Digite o valor desta parte.';
      else if (a < min) e[`part${i}`] = `Cada parte precisa ser de pelo menos ${brl(min)}.`;
      const due = parts[i]?.due ?? '';
      if (!due) e[`partDue${i}`] = 'Escolha a data.';
      else if (due < this.today) e[`partDue${i}`] = 'A data precisa ser de hoje em diante.';
      else if (i > 0 && parts[i - 1]?.due && due < (parts[i - 1].due ?? '')) {
        e[`partDue${i}`] = 'Precisa vencer no mesmo dia ou depois da parte anterior.';
      }
    });
    return e;
  }

  private planErrors(): Record<string, string> {
    const v = this.v();
    const e: Record<string, string> = {};
    const w = this.words();
    const periods = this.periods();
    const rate = this.rateCents();
    const min = minChargeCents(this.automatic());
    if (v.descOn) {
      const k = intOf(v.discountN);
      if (!k || k < 1 || k > periods) e['discountN'] = `Digite de 1 a ${periods} cobranças.`;
      if (v.discountType === 'PERCENT') {
        const bps = percentTextToBps(v.discountValue);
        if (bps === null || bps <= 0 || bps >= 10_000) e['discountValue'] = 'Digite um percentual entre 1 e 99.';
      } else {
        const c = ptBrMoneyCents(v.discountValue);
        if (c === null || c <= 0 || c >= rate) {
          e['discountValue'] = `O desconto precisa ser maior que zero e menor que ${brl(rate)}, o valor d${w.fem ? 'a' : 'o'} ${w.lower}.`;
        } else if (rate - c < min) {
          e['discountValue'] = `Com esse desconto a cobrança ficaria abaixo de ${brl(min)}.`;
        }
      }
    }
    if (v.parcOn) {
      const p = intOf(v.splitCount);
      if (!p || p < SPLIT_COUNT_MIN || p > SPLIT_COUNT_MAX) e['splitCount'] = `Digite de ${SPLIT_COUNT_MIN} a ${SPLIT_COUNT_MAX} parcelas.`;
      const unit = v.splitUnit ?? 'DAYS';
      const g = intOf(v.splitIntervalN);
      if (!g || g < 1 || g > INTERVAL_MAX[unit]) {
        e['splitIntervalN'] = `Digite de 1 a ${INTERVAL_MAX[unit]} ${UNIT_WORDS[unit][INTERVAL_MAX[unit] === 1 ? 0 : 1]}.`;
      }
      const off = intOf(v.splitOffset);
      if (off === null || off > OFFSET_MAX_DAYS) e['splitOffset'] = `Digite de 0 a ${OFFSET_MAX_DAYS} dias.`;
      const stale = this.staleSplits();
      if (stale.length) {
        e['splitStale'] = this.staleMessage();
      } else if (v.splitScope === 'SOME' && this.selected().length === 0) {
        e['splitSel'] = `Escolha pelo menos uma ${w.lower}.`;
      } else if (this.pastSelected().length) {
        e['splitSel'] = `${listPeriods(this.pastSelected(), w)} já ${this.pastSelected().length === 1 ? 'venceu e não pode ser parcelada' : 'venceram e não podem ser parceladas'}. Tire da escolha.`;
      }
      if (!e['splitCount']) {
        const smallest = smallestInstalment(this.mathInput());
        if (smallest !== null && smallest < min) {
          e['splitCount'] = `Cada parcela precisa ser de pelo menos ${brl(min)}. A menor ficou com ${brl(smallest)}.`;
        }
      }
    }
    return e;
  }

  protected readonly staleMessage = computed(() => {
    const w = this.words();
    const list = this.staleSplits();
    if (!list.length) return '';
    const who = list.length === 1 ? `d${w.fem ? 'a' : 'o'} ${w.lower} ${list[0] + 1}` : `de ${list.length} ${w.lowerMany}`;
    return `O parcelamento ${who} precisa ser refeito: as datas ou a frequência mudaram. Abra "${STEP_NAMES[5]}" e escolha de novo.`;
  });

  /** Erros que já podem aparecer (passo tentado) + recusas do servidor. */
  private readonly visibleErrors = computed(() => {
    const tried = this.tried();
    const all = this.errs();
    const out: Record<string, string> = {};
    for (const [k, msg] of Object.entries(all)) {
      const s = FIELD_STEP[k] ?? (k.startsWith('part') ? 5 : 0);
      if (tried.has(s)) out[k] = msg;
    }
    for (const [k, msg] of Object.entries(this.serverFieldErrors())) if (!out[k]) out[k] = msg;
    return out;
  });

  protected err(key: string): string | null {
    return this.visibleErrors()[key] ?? null;
  }

  private stepErrors(s: number): string[] {
    return Object.keys(this.errs()).filter((k) => (FIELD_STEP[k] ?? (k.startsWith('part') ? 5 : 0)) === s);
  }

  private applyControlErrors(errs: Record<string, string>): void {
    const controls = this.form.controls as unknown as Record<string, FormControl>;
    for (const [name, control] of Object.entries(controls)) {
      const msg = errs[name];
      control.setErrors(msg ? { serverError: { message: msg } } : null);
      if (msg) control.markAsTouched();
    }
    this.caucaoParts.controls.forEach((g, i) => {
      const a = errs[`part${i}`];
      const d = errs[`partDue${i}`];
      g.controls.amount.setErrors(a ? { serverError: { message: a } } : null);
      g.controls.due.setErrors(d ? { serverError: { message: d } } : null);
      if (a) g.controls.amount.markAsTouched();
      if (d) g.controls.due.markAsTouched();
    });
  }

  private lastValues: Record<string, unknown> = {};
  private dropStaleServerErrors(): void {
    const current = this.form.getRawValue() as unknown as Record<string, unknown>;
    const errs = this.serverFieldErrors();
    if (Object.keys(errs).length) {
      const kept: Record<string, string> = {};
      for (const [k, msg] of Object.entries(errs)) if (current[k] === this.lastValues[k]) kept[k] = msg;
      if (Object.keys(kept).length !== Object.keys(errs).length) this.serverFieldErrors.set(kept);
    }
    this.lastValues = { ...current };
  }

  // ================================================================== resumo
  protected readonly minPeriodCents = computed(() => {
    const a = periodAmounts(this.mathInput());
    return a.length ? Math.min(...a) : this.rateCents();
  });

  private readonly driverName = computed(() => {
    const d = this.drivers().find((x) => x.id === this.v().driverId);
    return d ? formatPersonName(d.name) : '';
  });
  protected readonly firstName = computed(() => this.driverName().split(' ')[0] || 'motorista');
  private readonly carLabel = computed(() => {
    const c = this.vehicles().find((x) => x.id === this.v().vehicleId);
    return c ? `${formatVehicleLabel(c.brand, c.model)} · ${formatPlate(c.plate)}` : '';
  });

  protected readonly discountText = computed(() => {
    const d = this.discountState();
    if (!d) return '';
    const each = d.type === 'PERCENT'
      ? `${(d.value / 100).toLocaleString('pt-BR')}% (${brl(this.rateCents() - periodAmounts({ ...this.mathInput(), periods: 1 })[0])})`
      : brl(d.value);
    const w = this.words();
    const firsts = d.firstPeriods === 1 ? (w.fem ? 'na primeira' : 'no primeiro') : `${w.fem ? 'nas' : 'nos'} ${d.firstPeriods} ${w.fem ? 'primeiras' : 'primeiros'}`;
    return `${each} ${firsts}`;
  });

  protected readonly splitText = computed(() => {
    const s = this.splitState();
    if (!s || s.count < 2) return '';
    const unit = UNIT_WORDS[s.unit];
    const gap = `${s.intervalN} ${s.intervalN === 1 ? unit[0] : unit[1]}`;
    const w = this.words();
    const which = s.scope === 'ALL' ? `Tod${w.fem ? 'a' : 'o'} ${w.lower}` : plural(s.selected.length, w.lower, w.lowerMany);
    return `${which} em ${s.count}, a cada ${gap}`;
  });

  protected readonly sections = computed<SummarySection[]>(() => {
    const v = this.v();
    const s = this.step();
    const reached = (n: number): boolean => this.maxStep() >= n || s >= 8;
    const editable = (n: number): boolean => (this.maxStep() > n || s === 8) && s !== n && s !== 9;
    const w = this.words();
    const pickupDay = v.pickupOtherDay && v.pickupDay ? v.pickupDay : v.startDate;
    const km = intOf(v.initialKm);
    const fine = v.lateFineType === 'FIXED' ? ptBrMoneyCents(v.lateFineValue) : decimalOf(v.lateFineValue);
    const juros = ptBrMoneyCents(v.lateInterestPercent);
    const cau = this.caucaoCents();
    const parts = this.partsValue() as Array<{ due?: string }>;
    const rows3: SummaryRow[] = [{ k: w.per, v: this.rateCents() ? brl(this.rateCents()) : '—' }];
    rows3.push({ k: '1ª cobrança', v: dLong(this.firstDue()) });
    if (this.discountText()) rows3.push({ k: 'Desconto', v: this.discountText() });
    if (this.splitText()) rows3.push({ k: 'Parcelas', v: this.splitText() });
    const cauRows: SummaryRow[] =
      cau <= 0
        ? [{ k: 'Caução', v: 'Sem caução' }]
        : v.caucaoPaid
          ? [{ k: 'Valor', v: `${brl(cau)}, já recebida` }]
          : this.caucaoSplitOn()
            ? this.partAmounts().map((a, i) => ({ k: `Parte ${i + 1}`, v: `${brl(Math.max(a, 0))}${parts[i]?.due ? ' · ' + dShort(parts[i].due) : ''}` }))
            : [{ k: 'Valor', v: `${brl(cau)} em ${dShort(caucaoDue(this.start(), this.firstDue()))}` }];
    const fuel = v.fuel === FUEL_OTHER ? (v.customFuel ?? '').trim() : v.fuel ?? '';
    const delivery: SummaryRow[] = [{ k: 'Km na retirada', v: km !== null ? `${km.toLocaleString('pt-BR')} km` : '—' }];
    if (fuel) delivery.push({ k: 'Combustível', v: fuel });
    delivery.push({ k: 'Limite de km', v: v.hasKmLimit && intOf(v.franchiseKm) ? `${intOf(v.franchiseKm)} km por dia` : 'Sem limite' });
    if (this.hasContractTemplate()) delivery.push({ k: 'Contrato', v: v.useContractTemplate ? 'Gerado pelo modelo' : 'Você envia o PDF' });
    const sec = (step: Step, title: string, rows: SummaryRow[]): SummarySection => ({
      step,
      title,
      rows,
      filled: reached(step),
      canEdit: editable(step),
    });
    return [
      sec(1, 'Período', [
        { k: 'Retirada', v: pickupDay ? `${dLong(pickupDay)}, ${v.pickupTime}` : '—' },
        { k: 'Devolução', v: dLong(v.endDate) },
        { k: 'Duração', v: this.periods() ? plural(this.periods(), w.lower, w.lowerMany) : '—' },
      ]),
      sec(2, 'Motorista e carro', [
        { k: 'Motorista', v: this.driverName() || '—' },
        { k: 'Carro', v: this.carLabel() || '—' },
      ]),
      sec(3, 'Valor', rows3),
      sec(4, 'Pagamento', [{ k: 'Como paga', v: v.automaticCharge ? 'Pix pelo MyCarsHub' : 'Você recebe por fora' }]),
      sec(5, 'Caução', cauRows),
      sec(7, 'Se atrasar', [
        { k: 'Multa', v: fine === null || fine === 0 ? 'Não cobra' : v.lateFineType === 'FIXED' ? this.fixedFineText(fine) : `${fine.toLocaleString('pt-BR')}% da cobrança` },
        { k: 'Juros', v: juros === null || juros === 0 ? 'Não cobra' : `${(juros / 100).toLocaleString('pt-BR')}% ao mês` },
      ]),
      { ...sec(7, 'Contrato e entrega', delivery) },
    ];
  });

  /** "Dar desconto ou parcelar" no resumo (abre o passo 6 e volta). */
  protected readonly planLink = computed(() => {
    const s = this.step();
    if (!((this.maxStep() > 6 || s === 8) && s !== 6 && s !== 9)) return null;
    return this.v().descOn || this.v().parcOn ? 'Mudar desconto e parcelas' : 'Dar desconto ou parcelar';
  });

  /** Números do bloco verde: a prévia do servidor no Confira; antes dela, a conta local. */
  protected readonly money = computed(() => {
    const p = this.step() === 8 ? this.serverPreview() : null;
    const t = p ? totalsOf(p.charges) : this.localTotals();
    const total = p ? p.totalCents : t.totalCents;
    const n = t.count;
    const w = this.words();
    return {
      alugLabel: `Aluguel, ${this.periods() ? plural(this.periods(), w.lower, w.lowerMany) : '—'}`,
      alug: brl(t.rentCents),
      cau: brl(t.caucaoCents),
      total: brl(total),
      count: `${plural(n, 'cobrança', 'cobranças')} ${this.automatic() ? 'por Pix' : 'anotadas para você marcar'}`,
      n,
    };
  });

  protected readonly genText = computed(() => {
    const n = this.money().n;
    return this.automatic()
      ? `Vamos gerar ${plural(n, 'cobrança', 'cobranças')} por Pix.`
      : `Vamos anotar ${plural(n, 'cobrança', 'cobranças')} para você marcar quando receber.`;
  });

  /** A lista do "Ver as N cobranças": as linhas do servidor (fonte da verdade). */
  protected readonly chargeLines = computed<ChargeLine[]>(() => {
    const p = this.serverPreview();
    const w = this.words();
    if (!p) return [];
    return p.charges.map((c, i) => {
      const count = c.instalmentCount ?? 1;
      const idx = c.instalmentIndex ?? 1;
      const title =
        c.kind === 'CAUCAO'
          ? count > 1 ? `Caução, parte ${idx} de ${count}` : 'Caução'
          : count > 1 ? `${w.one} ${c.index + 1}, parcela ${idx} de ${count}` : `${w.one} ${c.index + 1}`;
      return { key: `${i}`, title, date: dLong(c.dueDate), value: brl(c.amountCents) };
    });
  });

  protected readonly stepCount = computed(() => (this.step() <= 7 ? `Passo ${this.step()} de 7` : 'Último passo'));
  protected readonly stepName = computed(() => (this.step() <= 7 ? STEP_NAMES[this.step() - 1] : 'Confira antes de criar'));
  protected dashClass(i: number): string {
    const s = this.step();
    if (s >= 8) return 'on';
    if (i === s) return 'cur';
    return i < this.maxStep() || i < s ? 'on' : '';
  }

  // ================================================================== frases "Em palavras"
  protected readonly endHelp = computed(() => {
    const n = this.periods();
    return n ? `São ${plural(n, this.words().lower, this.words().lowerMany)}.` : 'A devolução precisa ser depois da retirada.';
  });

  protected readonly rateHelp = computed(() => {
    const first = this.firstDue();
    const v = this.v();
    if (!first) return 'Vence no mesmo dia da retirada.';
    if (v.billingFrequency === 'WEEKLY') return `Vence toda ${weekdayLong(first)}, a partir de ${dShort(first)}.`;
    if (v.billingFrequency === 'MONTHLY') return `Vence a cada 30 dias, a partir de ${dShort(first)}.`;
    return `Vence todo dia, a partir de ${dShort(first)}.`;
  });

  protected readonly firstDueHelp = computed(
    () => `É o vencimento da primeira cobrança. As próximas vencem a cada ${this.v().billingFrequency === 'MONTHLY' ? '30 dias' : this.words().lower} a partir dela.`,
  );

  protected readonly say = computed<string>(() => {
    const s = this.step();
    const v = this.v();
    const w = this.words();
    const n = this.periods();
    if (s === 1 && n) {
      return `Ele pega o carro em ${dLong(v.pickupOtherDay && v.pickupDay ? v.pickupDay : v.startDate)}, ${v.pickupTime}, e devolve em ${dLong(v.endDate)}. São ${plural(n, w.lower, w.lowerMany)}.`;
    }
    if (s === 3 && this.rateCents() && n) {
      const rent = this.localTotals().rentCents;
      return `Ele paga ${brlShort(this.rateCents())} ${w.per.toLowerCase()}, por ${plural(n, w.lower, w.lowerMany)}. São ${brl(rent)} de aluguel${rent !== this.rateCents() * n ? ', já com o desconto.' : '.'}`;
    }
    if (s === 5) return this.sections()[4].rows.map((r) => `${r.k}: ${r.v}`).join('. ') + '.';
    if (s === 6) return this.planSentence();
    if (s === 7) {
      const sec = this.sections()[5].rows;
      const fine = sec[0].v === 'Não cobra' ? 'não cobrada' : `de ${sec[0].v}`;
      const juros = sec[1].v === 'Não cobra' ? 'não cobrados' : `de ${sec[1].v}`;
      return `Se atrasar: multa ${fine} e juros ${juros}.`;
    }
    return '';
  });

  private planSentence(): string {
    const v = this.v();
    const w = this.words();
    const n = this.periods();
    const rate = this.rateCents();
    const d = this.discountState();
    const out: string[] = [];
    const low = d ? periodAmounts({ ...this.mathInput(), periods: 1 })[0] : rate;
    const nd = d ? Math.min(d.firstPeriods, n) : 0;
    if (!v.descOn && !v.parcOn) out.push(`Ele paga ${brlShort(rate)} ${w.per.toLowerCase()}, de uma vez, por ${plural(n, w.lower, w.lowerMany)}.`);
    if (d && nd > 0) {
      if (nd >= n) out.push(`Tod${w.fem ? 'as as' : 'os os'} ${w.lowerMany} saem por ${brlShort(low)}.`);
      else {
        const lead = nd === 1 ? `${w.fem ? 'A primeira' : 'O primeiro'} ${w.lower} sai por ` : `${w.fem ? 'As' : 'Os'} ${nd} ${w.fem ? 'primeiras' : 'primeiros'} ${w.lowerMany} saem por `;
        out.push(`${lead}${brlShort(low)}; ${w.fem ? 'as outras' : 'os outros'}, ${brlShort(rate)}.`);
      }
    }
    const s = this.splitState();
    if (s && s.count >= 2) {
      const unit = UNIT_WORDS[s.unit];
      const gap = `${s.intervalN} ${s.intervalN === 1 ? unit[0] : unit[1]}`;
      const part = (c: number): string => brl(Math.floor(c / s.count));
      if (s.scope === 'ALL') {
        if (nd > 0 && nd < n) out.push(`Cada ${w.lower} é paga em ${s.count} parcelas, com ${gap} entre elas: ${part(low)} nas ${nd} primeiras e ${part(rate)} nas outras.`);
        else out.push(`Cada ${w.lower} é paga em ${s.count} parcelas de ${part(nd >= n && d ? low : rate)}, com ${gap} entre elas.`);
      } else if (s.selected.length) {
        out.push(`${listPeriods(s.selected, w)} ${s.selected.length === 1 ? 'é paga' : 'são pagas'} em ${s.count} parcelas, com ${gap} entre elas. ${w.fem ? 'As outras' : 'Os outros'}, de uma vez.`);
      } else {
        out.push(`Toque ${w.fem ? 'nas' : 'nos'} ${w.lowerMany} que vão ser parcelad${w.fem ? 'as' : 'os'}.`);
      }
      if (rate % s.count !== 0 || low % s.count !== 0) out.push('Os centavos que sobram vão na última parcela.');
    }
    return out.join(' ');
  }

  protected readonly fullSub = computed(() =>
    this.rateCents() ? `${brlShort(this.rateCents())} tod${this.words().fem ? 'a' : 'o'} ${this.words().lower}, de uma vez.` : `O valor d${this.words().fem ? 'a' : 'o'} ${this.words().lower}, de uma vez.`,
  );

  protected readonly discountHelp = computed(() => {
    const v = this.v();
    if (v.discountType === 'PERCENT') {
      const d = this.discountState();
      return d ? `${v.discountValue}% de ${brlShort(this.rateCents())} = ${brl(this.rateCents() - periodAmounts({ ...this.mathInput(), periods: 1 })[0])} de desconto em cada uma.` : `Percentual sobre o valor d${this.words().fem ? 'a' : 'o'} ${this.words().lower}.`;
    }
    return `Cada ${this.words().lower} é ${brlShort(this.rateCents())}. Depois volta ao valor cheio.`;
  });

  protected readonly offsetHelp = computed(() => {
    const first = this.firstDue();
    const s = this.splitState();
    if (!first || !s) return '0 = no dia do vencimento.';
    const p1 = addDaysIso(first, s.offsetDays);
    const step = s.unit === 'WEEKS' ? 7 : s.unit === 'MONTHS' ? 30 : 1;
    const p2 = addDaysIso(p1, s.intervalN * step);
    return `Conta a partir do vencimento; 0 = no mesmo dia. Ex.: ${this.words().lower} 1 vence ${dShort(first)} → 1ª parcela em ${dShort(p1)}${s.count > 1 ? `, 2ª em ${dShort(p2)}` : ''}.`;
  });

  protected readonly unitSuffix = computed(() => {
    const n = intOf(this.v().splitIntervalN) ?? 0;
    const u = UNIT_WORDS[this.v().splitUnit ?? 'DAYS'];
    return n === 1 ? u[0] : u[1];
  });

  protected readonly fineHelp = computed(() => {
    const v = this.v();
    if (v.lateFineType !== 'FIXED') return 'Percentual sobre o valor de cada cobrança atrasada.';
    const split = v.parcOn ? ' Com parcelas, a multa é dividida entre elas; os centavos que sobram vão na última.' : '';
    return `Menor que ${brl(this.minPeriodCents())}, o menor valor de ${this.words().lower}.${split}`;
  });

  protected readonly weekItems = computed(() => {
    const n = this.periods();
    const freq = this.v().billingFrequency ?? 'WEEKLY';
    const sel = this.selectedFreq() === freq ? this.selected() : [];
    return Array.from({ length: n }, (_, i) => {
      const due = periodDue(this.firstDue(), i, freq);
      return { i, label: `${this.words().one.slice(0, 3)} ${i + 1}`, date: dShort(due), on: sel.includes(i), past: due < this.today };
    });
  });

  // ================================================================== pickers
  /** Livres no período escolhido (a mesma busca do formulário de hoje). Os outros aparecem apagados. */
  private readonly freeDriverIds = signal<ReadonlySet<string>>(new Set());
  private readonly freeVehicleIds = signal<ReadonlySet<string>>(new Set());

  protected readonly driverOptions = computed(() => {
    const q = this.pickerQuery().trim().toLowerCase();
    const free = this.freeDriverIds();
    return this.drivers()
      .map((d) => ({ id: d.id, name: formatPersonName(d.name), free: free.has(d.id) }))
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.free) - Number(a.free));
  });
  protected readonly vehicleOptions = computed(() => {
    const free = this.freeVehicleIds();
    return this.vehicles()
      .filter((c) => !c.sold)
      .map((c) => ({ id: c.id, name: formatVehicleLabel(c.brand, c.model), plate: formatPlate(c.plate), free: free.has(c.id) }))
      .sort((a, b) => Number(b.free) - Number(a.free));
  });
  protected readonly anyFreeDriver = computed(() => this.driverOptions().some((d) => d.free));
  protected readonly anyFreeVehicle = computed(() => this.vehicleOptions().some((c) => c.free));

  /** Falhou a busca de motoristas ou carros: aviso com "Tentar de novo", nunca a lista vazia calada. */
  protected readonly pickersFailed = signal(false);

  protected retryPickers(): void {
    this.pickersFailed.set(false);
    this.loadPickers();
  }

  /**
   * Motoristas e carros do período escolhido no passo 1. Duas buscas por lista: a de "livres"
   * é a mesma do formulário de hoje (`availableForRental` + `periodStart`/`periodEnd`, corte por
   * colisão real de intervalo, então uma reserva fora do período não esconde nada); a outra traz
   * todos, e quem não está livre aparece apagado com o motivo, em vez de sumir.
   * Sem período ainda não há o que buscar.
   */
  private loadPickers(): void {
    const id = ++this.pickerRequest;
    const key = this.periodKey();
    this.loadedPeriod = key;
    if (!key) return;
    const [periodStart, periodEnd] = key.split('|');
    const free = { availableForRental: true, periodStart, periodEnd };
    const fail = (err: unknown): void => {
      if (id !== this.pickerRequest) return;
      this.apiErrors.claim(err);
      this.pickersFailed.set(true);
    };
    forkJoin([
      this.vehiclesService.list({ size: 500, sort: 'plate_asc', ...free }),
      this.vehiclesService.list({ size: 500, sort: 'plate_asc' }),
    ]).subscribe({
      next: ([freeRes, allRes]) => {
        if (id !== this.pickerRequest) return;
        const freeIds = new Set((freeRes.content ?? []).map((c) => c.id));
        this.freeVehicleIds.set(freeIds);
        this.vehicles.set(allRes.content ?? []);
        const sel = this.form.controls.vehicleId.value;
        const lost = !!sel && !freeIds.has(sel);
        if (lost) this.form.controls.vehicleId.setValue('');
        this.vehicleLost.set(lost);
        this.pickersFailed.set(false);
      },
      error: fail,
    });
    forkJoin([
      this.driverService.list({ size: 500, sort: 'name_asc', ...free }),
      this.driverService.list({ size: 500, sort: 'name_asc' }),
    ]).subscribe({
      next: ([freeRes, allRes]) => {
        if (id !== this.pickerRequest) return;
        const freeIds = new Set((freeRes.content ?? []).filter((x) => x.status !== 'SUSPENDED').map((x) => x.id));
        this.freeDriverIds.set(freeIds);
        this.drivers.set((allRes.content ?? []).filter((x) => x.status !== 'SUSPENDED'));
        const sel = this.form.controls.driverId.value;
        const lost = !!sel && !freeIds.has(sel);
        if (lost) this.form.controls.driverId.setValue('');
        this.driverLost.set(lost);
      },
      error: fail,
    });
  }

  /**
   * Multa FIXA com parcelas no Pix: o servidor divide a multa entre as parcelas
   * (`ChargePlanExpander.fineShares`, centavos na última). As fatias vêm da prévia quando ela
   * as traz; senão, a mesma regra aqui.
   */
  protected readonly fineShares = computed<number[] | null>(() => {
    const v = this.v();
    const s = this.splitState();
    const fine = ptBrMoneyCents(v.lateFineValue) ?? 0;
    if (v.lateFineType !== 'FIXED' || fine <= 0 || !v.automaticCharge || !s || s.count < 2) return null;
    const p = this.step() === 8 ? this.serverPreview() : null;
    const first = p?.charges.find((c) => c.kind === 'RENTAL_PERIOD' && (c.instalmentCount ?? 1) > 1 && c.fineFixedCents != null);
    if (first) {
      return p!.charges
        .filter((c) => c.kind === 'RENTAL_PERIOD' && c.index === first.index && c.fineFixedCents != null)
        .sort((a, b) => (a.instalmentIndex ?? 1) - (b.instalmentIndex ?? 1))
        .map((c) => c.fineFixedCents as number);
    }
    return splitEvenly(fine, s.count);
  });

  private fixedFineText(fine: number): string {
    const shares = this.fineShares();
    if (!shares) return `${brl(fine)} por cobrança`;
    const w = this.words();
    const each = shares.every((x) => x === shares[0])
      ? `${brl(shares[0])} em cada`
      : `${shares.slice(0, -1).map(brl).join(', ')} e ${brl(shares[shares.length - 1])}`;
    const scope = this.v().splitScope === 'SOME' ? `; ${w.fem ? 'nas' : 'nos'} ${w.lowerMany} parcelad${w.fem ? 'as' : 'os'}, ` : ', ';
    return `${brl(fine)} por ${w.lower}${scope}dividida entre as parcelas (${each})`;
  }

  protected pickDriver(id: string): void {
    this.form.controls.driverId.setValue(id);
    this.driverLost.set(false);
  }
  protected pickVehicle(id: string): void {
    this.form.controls.vehicleId.setValue(id);
    this.vehicleLost.set(false);
  }
  protected onQuery(event: Event): void {
    this.pickerQuery.set((event.target as HTMLInputElement).value);
  }

  // ================================================================== ações dos passos
  protected readonly freqOptions: SegmentedToggleOption<RentalBillingFrequency>[] = [
    { value: 'DAILY', label: 'Por dia', ...ACTIVE },
    { value: 'WEEKLY', label: 'Por semana', ...ACTIVE },
    { value: 'MONTHLY', label: 'Por mês', ...ACTIVE },
  ];
  protected readonly moneyUnitOptions: SegmentedToggleOption<'AMOUNT' | 'PERCENT'>[] = [
    { value: 'AMOUNT', label: 'R$', ...ACTIVE },
    { value: 'PERCENT', label: '%', ...ACTIVE },
  ];
  protected readonly fineUnitOptions: SegmentedToggleOption<RentalLateFineType>[] = [
    { value: 'FIXED', label: 'R$', ...ACTIVE },
    { value: 'PERCENT', label: '%', ...ACTIVE },
  ];
  protected readonly scopeOptions: SegmentedToggleOption<'ALL' | 'SOME'>[] = [
    { value: 'ALL', label: 'Todas', ...ACTIVE },
    { value: 'SOME', label: 'Só algumas', ...ACTIVE },
  ];
  protected readonly unitOptions: SegmentedToggleOption<IntervalUnit>[] = [
    { value: 'DAYS', label: 'Dias', ...ACTIVE },
    { value: 'WEEKS', label: 'Semanas', ...ACTIVE },
    { value: 'MONTHS', label: 'Meses', ...ACTIVE },
  ];
  protected readonly limitOptions: SegmentedToggleOption<boolean>[] = [
    { value: false, label: 'Sem limite', ...ACTIVE },
    { value: true, label: 'Com limite por dia', ...ACTIVE },
  ];
  protected readonly segActive = 'text-fg';
  protected readonly segInactive = 'text-fg-muted hover:text-fg';
  protected readonly segContainer = 'bg-surface-sunken';

  protected setFrequency(f: RentalBillingFrequency): void {
    this.form.controls.billingFrequency.setValue(f);
  }
  protected setPay(automatic: boolean): void {
    this.automaticTouched = true;
    this.form.controls.automaticCharge.setValue(automatic);
  }
  protected setDiscountType(t: 'AMOUNT' | 'PERCENT'): void {
    if (this.form.controls.discountType.value === t) return;
    // Trocar de R$ para % muda o significado do número: o campo recomeça vazio.
    this.form.patchValue({ discountType: t, discountValue: '' });
  }
  protected setFineType(t: RentalLateFineType): void {
    if (this.form.controls.lateFineType.value === t) return;
    this.form.patchValue({ lateFineType: t, lateFineValue: '' });
  }
  protected setScope(s: 'ALL' | 'SOME'): void {
    this.form.controls.splitScope.setValue(s);
  }
  protected setUnit(u: IntervalUnit): void {
    this.form.controls.splitUnit.setValue(u);
  }
  protected setLimit(on: boolean): void {
    this.form.controls.hasKmLimit.setValue(on);
  }
  protected setFuel(value: string): void {
    this.form.controls.fuel.setValue(value);
  }

  protected toggleWeek(i: number): void {
    const freq = this.form.controls.billingFrequency.value;
    // Escolha feita noutra frequência: o que estava salvo é a refazer; começa de novo aqui.
    const base = this.selectedFreq() === freq ? this.selected() : [];
    this.selectedFreq.set(freq);
    this.selected.set(base.includes(i) ? base.filter((x) => x !== i) : [...base, i].sort((a, b) => a - b));
  }

  /** Tira da escolha as semanas a refazer (o resto fica). */
  protected dropStale(): void {
    const stale = new Set(this.staleSplits());
    this.selected.update((list) => list.filter((i) => !stale.has(i)));
    this.selectedFreq.set(this.form.controls.billingFrequency.value);
  }

  protected toggleCaucaoPaid(): void {
    this.form.controls.caucaoPaid.setValue(!this.form.controls.caucaoPaid.value);
  }

  protected toggleCaucaoSplit(): void {
    const on = !this.form.controls.caucaoSplit.value;
    if (on && this.caucaoParts.length === 0) {
      const due = caucaoDue(this.start() || this.today, this.firstDue() || this.today);
      const half = Math.floor(this.caucaoCents() / 2);
      this.caucaoParts.push(this.newPart(half, due));
      this.caucaoParts.push(this.newPart(null, addDaysIso(due, 7)));
    }
    this.form.controls.caucaoSplit.setValue(on);
  }

  protected addPart(): void {
    if (this.caucaoParts.length >= CAUCAO_PARTS_MAX) return;
    const last = this.caucaoParts.at(this.caucaoParts.length - 1);
    // A última parte era o "resto": vira digitada com o valor que tinha, e a nova é o resto.
    const lastAmount = this.partAmounts()[this.caucaoParts.length - 1] ?? 0;
    last.controls.amount.setValue(lastAmount > 0 ? formatCents(lastAmount) : '');
    this.caucaoParts.push(this.newPart(null, addDaysIso(last.controls.due.value || this.today, 7)));
  }

  protected removePart(i: number): void {
    if (this.caucaoParts.length <= 2) return;
    this.caucaoParts.removeAt(i);
  }

  private newPart(amount: number | null, due: string): CaucaoPart {
    return new FormGroup({
      amount: new FormControl(amount ? formatCents(amount) : '', { nonNullable: true }),
      due: new FormControl(due, { nonNullable: true }),
    });
  }

  protected restLabel(i: number): string {
    const a = this.partAmounts()[i] ?? 0;
    return formatCents(Math.max(a, 0));
  }

  protected readonly caucaoTotalLabel = computed(() => brl(this.caucaoCents()));

  protected readonly primaryLabel = computed(() => {
    if (this.step() === 8) return this.saving() ? 'Criando…' : 'Criar aluguel';
    return this.returning() ? 'Salvar e voltar ao resumo' : 'Continuar';
  });

  protected readonly canAddPart = computed(() => (this.partsValue() as unknown[]).length < CAUCAO_PARTS_MAX);

  protected onMoney(event: Event, name: 'periodRateReais' | 'caucaoReais' | 'discountValue' | 'lateFineValue' | 'lateInterestPercent' | 'extraKmPriceReais'): void {
    if (name === 'discountValue' && this.form.controls.discountType.value === 'PERCENT') return;
    if (name === 'lateFineValue' && this.form.controls.lateFineType.value !== 'FIXED') return;
    applyPtBrMoneyMaskToControl(event, this.form.controls[name]);
  }
  protected onPartMoney(event: Event, i: number): void {
    applyPtBrMoneyMaskToControl(event, this.caucaoParts.at(i).controls.amount);
  }

  /** "Cobrar valor cheio": desliga desconto e parcelas — com parcelas, só depois de confirmar. */
  protected pickFull(): void {
    const v = this.form.getRawValue();
    if (!v.descOn && !v.parcOn) return;
    if (v.parcOn) {
      this.discard.set({ kind: 'full', message: `Isso desfaz o desconto e ${this.splitWho()}. Quer continuar?` });
      return;
    }
    this.form.patchValue({ descOn: false });
  }

  protected toggleDesc(): void {
    this.form.controls.descOn.setValue(!this.form.controls.descOn.value);
  }

  protected toggleParc(): void {
    const on = this.form.controls.parcOn.value;
    if (on && this.hasSplits()) {
      this.discard.set({ kind: 'parc', message: `Isso desfaz ${this.splitWho()}. Quer continuar?` });
      return;
    }
    this.form.controls.parcOn.setValue(!on);
  }

  private hasSplits(): boolean {
    const v = this.form.getRawValue();
    return v.parcOn && (v.splitScope === 'ALL' || this.selected().length > 0);
  }

  private splitWho(): string {
    const v = this.form.getRawValue();
    const w = this.words();
    if (v.splitScope === 'ALL') return `o parcelamento de tod${w.fem ? 'as as' : 'os os'} ${w.lowerMany}`;
    return `o parcelamento d${w.fem ? 'a' : 'o'}${this.selected().length > 1 ? 's' : ''} ${listPeriods(this.selected(), w).replace(/^(A|O|As|Os) /, '')}`;
  }

  protected confirmDiscard(): void {
    const d = this.discard();
    this.discard.set(null);
    if (!d) return;
    this.selected.set([]);
    if (d.kind === 'full') this.form.patchValue({ descOn: false, parcOn: false });
    else this.form.controls.parcOn.setValue(false);
  }

  protected cancelDiscard(): void {
    this.discard.set(null);
  }

  // ================================================================== navegação
  protected next(): void {
    const s = this.step();
    if (s >= 1 && s <= 7) {
      const errors = this.stepErrors(s);
      if (errors.length) {
        this.tried.update((t) => new Set([...t, s]));
        this.focusFirstInvalid();
        return;
      }
      if (this.returning()) {
        this.go(8);
        return;
      }
      this.go((s + 1) as Step);
      return;
    }
    if (s === 8) this.create();
  }

  protected back(): void {
    const s = this.step();
    if (this.returning()) this.go(8);
    else if (s === 8) this.go(7);
    else if (s > 1) this.go((s - 1) as Step);
    else this.exit();
  }

  protected edit(step: number): void {
    // Na primeira passada (Confira ainda não visto) o "Mudar" leva ao passo e segue em ordem;
    // só depois de todos os passos é que ele volta direto ao Confira.
    this.go(step as Step, this.maxStep() >= 8);
  }

  protected exit(): void {
    this.dropDraft();
    this.router.navigate(['/alugueis']);
  }

  // ================================================================== rascunho (M5)
  // Os atalhos "Abrir o cadastro do motorista" e "Abrir Configurações" navegam na MESMA aba
  // (uma aba nova não tem a sessão). O rascunho, por usuário e empresa no sessionStorage,
  // devolve os 7 passos na volta. Some ao criar e ao sair.
  protected readonly draftRestored = signal(false);
  private draftOff = false;
  /** Só grava depois de restaurar: senão o formulário vazio apagaria o rascunho. */
  private draftReady = false;

  private draftKey(): string | null {
    const userId = this.session.getItem('id');
    const companyId = this.session.getItem('selectedCompanyId');
    return userId && companyId ? `${WIZARD_DRAFT_PREFIX}:${userId}:${companyId}` : null;
  }

  private readonly draftAutosave = effect(() => {
    const data: WizardDraft = {
      v: 2,
      form: this.v(),
      parts: this.partsValue() as Array<{ amount: string; due: string }>,
      selected: [...this.selected()],
      selectedFreq: this.selectedFreq(),
      step: this.step() === 9 ? 8 : this.step(),
      maxStep: this.maxStep(),
    };
    untracked(() => {
      const key = this.draftKey();
      if (!key || !this.draftReady || this.draftOff || this.step() === 9) return;
      this.session.setItem(key, JSON.stringify(data));
    });
  });

  private restoreDraft(): boolean {
    const key = this.draftKey();
    const raw = key ? this.session.getItem(key) : null;
    if (!raw) return false;
    try {
      const d = JSON.parse(raw) as WizardDraft;
      // v2: o período virou o passo 1. Rascunho da ordem antiga não vale.
      if (d?.v !== 2 || !d.form) return false;
      this.form.patchValue(d.form);
      (d.parts ?? []).forEach((p) => this.caucaoParts.push(this.newPart(null, p.due ?? '')));
      (d.parts ?? []).forEach((p, i) => this.caucaoParts.at(i).controls.amount.setValue(p.amount ?? ''));
      this.selected.set(d.selected ?? []);
      this.selectedFreq.set(d.selectedFreq ?? 'WEEKLY');
      this.automaticTouched = true;
      this.maxStep.set(d.maxStep ?? 1);
      this.step.set(d.step ?? 1);
      this.draftRestored.set(true);
      return true;
    } catch {
      return false;
    }
  }

  private dropDraft(): void {
    this.draftOff = true;
    const key = this.draftKey();
    if (key) this.session.removeItem(key);
  }

  /** "Começar do zero": apaga o rascunho e recomeça a tela. */
  protected discardDraft(): void {
    this.dropDraft();
    this.restart();
  }

  protected goToStaleStep(): void {
    this.go(6, this.step() === 8 || this.returning());
  }

  private go(s: Step, returning = false): void {
    this.returning.set(returning);
    this.sheetOpen.set(false);
    this.listOpen.set(false);
    this.step.set(s);
    if (s <= 8 && s > this.maxStep()) this.maxStep.set(s);
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector('[data-wizard-top]')?.scrollIntoView?.({ block: 'start' });
        this.host.nativeElement.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private focusFirstInvalid(): void {
    afterNextRender(
      () => {
        const el = this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"], [data-step-error]');
        el?.scrollIntoView?.({ block: 'center' });
        el?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  // ================================================================== corpo
  protected raw(): RentalCreateRaw {
    const v = this.form.getRawValue();
    const pickupDay = v.pickupOtherDay && v.pickupDay ? v.pickupDay : v.startDate;
    return {
      vehicleId: v.vehicleId,
      driverId: v.driverId,
      startDate: v.startDate,
      endDate: v.endDate,
      billingFrequency: v.billingFrequency,
      periodRateReais: v.periodRateReais,
      caucaoReais: v.caucaoReais,
      caucaoPaid: v.caucaoPaid,
      automaticCharge: v.automaticCharge,
      notes: v.notes,
      initialKm: intOf(v.initialKm),
      pickupDate: pickupDay ? `${pickupDay}T${v.pickupTime}` : '',
      firstPaymentDate: v.firstPaymentDate,
      lateInterestPercent: v.lateInterestPercent,
      lateFineType: v.lateFineType,
      lateFineValueInput: v.lateFineType === 'FIXED' ? v.lateFineValue : (decimalOf(v.lateFineValue) ?? 0),
      franchiseKm: v.hasKmLimit ? intOf(v.franchiseKm) : null,
      extraKmPriceReais: v.hasKmLimit ? v.extraKmPriceReais : '',
      returnFuelPolicy: v.fuel === FUEL_OTHER ? v.customFuel : v.fuel,
      useContractTemplate: this.hasContractTemplate() && v.useContractTemplate,
    };
  }

  protected body() {
    return buildCreateBody(this.raw(), buildWizardPlan(this.mathInput()));
  }

  /** O corpo do create como texto: muda quando qualquer coisa que vai no POST muda. */
  private readonly bodyKey = computed(() => {
    this.v();
    this.mathInput();
    this.hasContractTemplate();
    return JSON.stringify(this.body());
  });
  /** O corpo da prévia que está na tela: é ESTE que o Criar envia. */
  private previewedBody: CreateRentalRequest | null = null;
  private readonly previewedKey = signal<string | null>(null);
  private requestedKey: string | null = null;
  private checkSeq = 0;

  /** No Confira, toda mudança do corpo pede uma prévia nova (a anterior é descartada). */
  private readonly autoCheck = effect(() => {
    const key = this.bodyKey();
    if (this.step() !== 8) return;
    untracked(() => {
      if (key !== this.requestedKey) this.check();
    });
  });

  /** A prévia do servidor está na tela e é do corpo de agora. Sem ela, nada de criar. */
  protected readonly previewCurrent = computed(
    () => !!this.serverPreview() && this.previewedKey() === this.bodyKey() && !this.checking(),
  );

  /** Algo impede criar: erro de algum passo, parcelas a refazer, recusa, prévia ausente ou velha. */
  protected readonly blocked = computed(
    () =>
      Object.keys(this.errs()).length > 0 ||
      this.serverSummary().length > 0 ||
      Object.keys(this.serverFieldErrors()).length > 0 ||
      !!this.serverPreview()?.blocker ||
      !this.previewCurrent(),
  );

  protected retryCheck(): void {
    this.requestedKey = null;
    this.check();
  }

  /** Problemas mostrados no topo (passo dono + "Mudar"). */
  protected readonly topIssues = computed<TopIssue[]>(() => {
    const out: TopIssue[] = [];
    if (this.staleSplits().length) out.push({ key: 'stale', text: this.staleMessage(), step: 6, link: null });
    if (this.step() === 8) {
      const errs = this.errs();
      for (const s of [1, 2, 3, 4, 5, 6, 7] as const) {
        const keys = Object.keys(errs).filter((k) => k !== 'splitStale' && (FIELD_STEP[k] ?? (k.startsWith('part') ? 5 : 0)) === s);
        if (keys.length) out.push({ key: `step${s}`, text: `${STEP_NAMES[s - 1]}: ${errs[keys[0]]}`, step: s, link: null });
      }
      if (this.checkFailed()) {
        out.push({ key: 'preview-failed', text: 'Não foi possível conferir as cobranças. Nada foi criado.', step: null, link: null, retry: true });
      }
      const blocker = this.serverPreview()?.blocker;
      if (blocker) out.push({ key: 'blocker', text: planBlockerMessage(blocker), step: 6, link: null });
      out.push(...this.serverSummary());
      for (const [k, msg] of Object.entries(this.serverFieldErrors())) {
        out.push({ key: `srv-${k}`, text: msg, step: FIELD_STEP[k] ?? null, link: null });
      }
    }
    return out;
  });

  /** Preflight (sem plano) e prévia (com plano) — os números do Confira são os do servidor. */
  private check(): void {
    const seq = ++this.checkSeq;
    const key = this.bodyKey();
    this.requestedKey = key;
    this.serverPreview.set(null);
    this.previewedBody = null;
    this.previewedKey.set(null);
    if (Object.keys(this.errs()).length) {
      this.checking.set(false);
      return;
    }
    const raw = this.raw();
    const body = this.body();
    this.checking.set(true);
    this.checkFailed.set(false);
    this.serverSummary.set([]);
    this.rentalService
      .preflight(buildPreflightBody(raw))
      .pipe(
        switchMap((res) => {
          if (seq !== this.checkSeq) return of(null);
          this.applyServerIssues(res.issues ?? []);
          if ((res.issues ?? []).some((i) => i.severity !== 'WARNING')) return of(null);
          return this.rentalService.chargePreview(body);
        }),
        catchError((err: unknown) => {
          this.apiErrors.claim(err);
          if (seq === this.checkSeq) this.checkFailed.set(true);
          return of(null);
        }),
      )
      .subscribe((preview) => {
        // Resposta de uma prévia antiga (o corpo mudou no meio): descartada.
        if (seq !== this.checkSeq) return;
        this.checking.set(false);
        this.serverPreview.set(preview);
        this.previewedBody = preview ? body : null;
        this.previewedKey.set(preview ? key : null);
      });
  }

  private applyServerIssues(items: readonly RentalPreflightItem[]): void {
    const fields: Record<string, string> = {};
    const summary: TopIssue[] = [];
    for (const item of items) {
      if (item.severity === 'WARNING') continue;
      const control = item.field ? CONTROL_BY_SERVER_FIELD[item.field] : undefined;
      const text = serverIssueText(item);
      if (control && !fields[control]) {
        fields[control] = text;
        continue;
      }
      const driverId = this.form.controls.driverId.value;
      const isDriver = (item.field?.startsWith('driver.') ?? false) || item.code.startsWith('DRIVER_');
      const link = INTEGRATION_CODES.has(item.code)
        ? { label: 'Abrir Configurações > Integrações', commands: ['/configuracoes/integracoes'] }
        : isDriver && item.code !== 'DRIVER_NOT_FOUND' && driverId
          ? { label: 'Abrir o cadastro do motorista', commands: ['/motoristas', driverId, 'editar'] }
          : null;
      summary.push({ key: `${item.code}-${item.field}`, text, step: INTEGRATION_CODES.has(item.code) ? 4 : isDriver ? 2 : null, link });
    }
    this.lastValues = { ...(this.form.getRawValue() as unknown as Record<string, unknown>) };
    this.serverFieldErrors.set(fields);
    this.serverSummary.set(summary);
  }

  // ================================================================== criar
  protected create(): void {
    if (this.saving() || this.checking() || this.blocked()) return;
    this.topError.set(null);
    this.contactRetried = false;
    this.saving.set(true);
    this.contactGate.ensureComplete().subscribe((ok) => {
      if (ok) this.send();
      else this.saving.set(false);
    });
  }

  private send(): void {
    // O corpo cuja prévia está na tela, nunca uma releitura que o Confira não mostrou.
    const body = this.previewedBody;
    if (!body) {
      this.saving.set(false);
      return;
    }
    this.saving.set(true);
    this.rentalService.create(body).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.dropDraft();
        this.created.set({ id: r.id, sync: r.chargeSync ?? null });
        this.go(9);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.fail(err);
      },
    });
  }

  private fail(err: HttpErrorResponse): void {
    if (isCompanyContactIncomplete(err)) {
      this.apiErrors.claim(err);
      if (this.contactRetried) {
        this.contactRetried = false;
        this.topError.set(CONTACT_STILL_INCOMPLETE_COPY);
        return;
      }
      this.contactRetried = true;
      this.contactGate.promptAfterServerRefusal().subscribe((ok) => {
        if (ok) this.send();
        else this.contactRetried = false;
      });
      return;
    }
    const parsed = readPreflightError(err);
    if (parsed && parsed.issues.length) {
      this.apiErrors.claim(err);
      this.applyServerIssues(parsed.issues);
      return;
    }
    const code = apiErrorCode(err);
    if (code && PLAN_ERROR_MESSAGES[code]) {
      this.apiErrors.claim(err);
      this.topError.set(planBlockerMessage({ code, message: (err.error as { message?: string } | null)?.message ?? null }));
      return;
    }
    this.apiErrors.claim(err);
    this.topError.set(
      isDriverRegistrationIncomplete(err)
        ? DRIVER_REGISTRATION_INCOMPLETE_COPY
        : companySafe(this.apiErrors.messageFor(err, CREATE_FALLBACK), CREATE_FALLBACK),
    );
  }

  protected readonly doneText = computed(() => {
    const p = this.serverPreview();
    const n = p ? p.charges.length : this.money().n;
    const first = p?.firstDueDate ?? this.charges()[0]?.dueDate ?? null;
    const verb = this.automatic() ? 'criadas' : 'anotadas';
    return `As ${n} cobranças do ${this.firstName()} foram ${verb}. A primeira vence em ${dLong(first)}.`;
  });

  protected openRental(): void {
    const c = this.created();
    if (!c) return;
    if (c.sync && c.sync.failed > 0) {
      this.router.navigate(['/alugueis', c.id], { state: { [RENTAL_CHARGE_SYNC_STATE_KEY]: c.sync } });
    } else {
      this.router.navigate(['/alugueis', c.id]);
    }
  }

  protected restart(): void {
    this.router.navigateByUrl('/alugueis', { skipLocationChange: true }).then(() => this.router.navigate(['/alugueis', 'novo']));
  }
}

/** Opção ativa do segmento: o "levantado" do protótipo, nos tokens do app (claro e escuro). */
const ACTIVE = {
  activeBackground: 'var(--color-surface)',
  activeShadow: '0 1px 2px rgba(0,0,0,.12)',
} as const;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

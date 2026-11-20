import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormBuilder } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, merge, of, switchMap } from 'rxjs';

import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { SearchSelectOption } from '../../../components/search-select/search-select';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyContactGate, isCompanyContactIncomplete } from '../../../services/company-contact-gate.service';
import {
  DRIVER_REGISTRATION_INCOMPLETE_COPY,
  isDriverRegistrationIncomplete,
} from '../../../services/driver-invite-outcome';
import { DriverService } from '../../../services/driver.service';
import { SessionService } from '../../../services/session.service';
import { VehiclesService } from '../../../services/vehicles.service';
import {
  ChargePlanDto,
  CreateRentalRequest,
  RENTAL_CHARGE_SYNC_STATE_KEY,
  RentalBillingFrequency,
  RentalChargePreviewDto,
  RentalChargeSyncDto,
  RentalPreflightItem,
  RentalPreflightRequest,
} from '../../../types/rental.types';
import { PLAN_ERROR_MESSAGES, apiErrorCode, companySafe, planBlockerMessage } from '../charges-flex/flex-errors';
import { readPreflightError } from '../rental-preflight';
import { RentalService } from '../rental.service';
import { AsaasIntegrationService } from '../../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../../company-settings/contract-template/contract-template-service';
import { CardBilling } from './cards/card-billing';
import { CardContract } from './cards/card-contract';
import { CardNotes } from './cards/card-notes';
import { CardTerms } from './cards/card-terms';
import { ALWAYS_COMPLETE, billingErrors, card5Status, card7Status, termsErrors } from './cards/terms-rules';
import {
  BlockReason,
  CARD_OF_CONTROL,
  CONTACT_STILL_INCOMPLETE_COPY,
  CREATE_FALLBACK,
  blockerCard,
  controlsOfServerError,
  readServerIssues,
} from './create-server';
import {
  CardCompleteness,
  completenessFrom,
  confirmModel,
  createdModel,
  missingRows,
} from './create-summary';
import { CreateActions } from './end/create-actions';
import { BlockedSheet, ConfirmSheet, SheetExit } from './end/create-sheets';
import { CreatedView } from './end/created-view';
import { DriverListItem } from '../../../types/driver.types';
import { VehicleListItem } from '../../../types/vehicle.types';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { formatPersonName, formatPlate, formatVehicleLabel } from '../../../utils/display-format';
import { ptBrMoneyCents } from '../../../utils/validators/ptbr-money.validator';
import { addDaysIso, splitEvenly } from '../charges-flex/charges-flex';
import { caucaoDue, minChargeCents, periodCount, periodDue } from '../rental-wizard/wizard-math';
import { RentalCreateRaw, buildCreateBody, buildPreflightBody } from '../rental-wizard/wizard-payload';
import { FUEL_OTHER, decimalOf, dShort, intOf, periodWords } from '../rental-wizard/wizard-format';
import { CardCaucao } from './cards/card-caucao';
import { CardCharges, WeekItem } from './cards/card-charges';
import { CardDriverVehicle } from './cards/card-driver-vehicle';
import { CardPeriod } from './cards/card-period';
import {
  CaucaoPartGroup,
  PeriodPartGroup,
  centsText,
  createRentalForm,
  newCaucaoPart,
  newPeriodPart,
} from './create-form';
import {
  CreatePlanInput,
  PERIOD_PARTS_MAX,
  buildCreatePlan,
  createCharges,
  createPeriodAmounts,
  partOffsetMax,
  toggleCheck,
} from './create-plan';
import { caucaoPreview, chargesPreview } from './create-preview';
import { CREATE_CARDS, createProgress, progressDone } from './create-progress';
import {
  PeriodValue,
  caucaoAmounts,
  caucaoErrors,
  chargesErrors,
  discountHint,
  driverVehicleErrors,
  firstNOptions,
  partDueOptions,
  periodErrors,
  periodSentence,
  rateHint,
} from './create-rules';

interface CreateDraft {
  v: 1;
  form: Record<string, unknown>;
  parts: Array<{ amount: string; due: string }>;
  periodParts?: Array<{ amount: string; offset: number }>;
  /** O usuário já mexeu no valor de uma parte: ela não se redivide mais sozinha. */
  caucaoPartsEdited?: boolean;
  periodPartsEdited?: boolean;
  selected: number[];
  selectedFreq: RentalBillingFrequency;
}

/** Partes iguais, centavos na última — só onde o valor muda (não reescreve o que já está igual). */
function resplit(parts: FormArray<CaucaoPartGroup> | FormArray<PeriodPartGroup>, totalCents: number): void {
  const n = parts.length;
  if (n < 2 || totalCents <= 0) return;
  const amounts = splitEvenly(totalCents, n).map(centsText);
  parts.controls.forEach((g, i) => {
    if (g.controls.amount.value !== amounts[i]) g.controls.amount.setValue(amounts[i]);
  });
}

/** Chave nova (não lê o rascunho do passo a passo nem o do formulário de hoje). */
export const CREATE_DRAFT_PREFIX = 'rentalCreateDraft';

/** Erros que aparecem sem esperar o campo ser visitado: as linhas de soma e a escolha de semanas. */
const ALWAYS_SHOWN = new Set(['caucaoPartsSum', 'periodPartsSum', 'splitSel']);

/** Onde a 2ª parte nasce, em dias depois do vencimento (por semana: terça → sexta, a prancha). */
const SECOND_PART_OFFSET: Readonly<Record<RentalBillingFrequency, number>> = { DAILY: 1, WEEKLY: 3, MONTHLY: 15 };


/** "Carlos Henrique Souza" → "CS". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Novo aluguel em uma página só, com 8 cards (plano 2026-11-20). Só para quem tem a chave
 * `CHARGES_FLEX`: `/alugueis/novo` abre `RentalNew`, que mostra esta página no lugar do passo a
 * passo; sem a chave, o formulário de hoje, intocado.
 *
 * A página é dona do formulário (o formato do passo a passo, para o corpo sair de
 * `buildCreateBody`) e de tudo o que os cards mostram. Os cards só mostram e avisam.
 * Entregas 1 e 2: cards 1 a 4; os outros são o lugar reservado.
 */
@Component({
  selector: 'app-rental-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultPageLayout,
    CardDriverVehicle,
    CardPeriod,
    CardCaucao,
    CardCharges,
    CardTerms,
    CardContract,
    CardBilling,
    CardNotes,
    CreateActions,
    ConfirmSheet,
    BlockedSheet,
    CreatedView,
  ],
  templateUrl: './rental-create.html',
  styleUrl: './rental-create.css',
  // Sem encapsulamento: os cards usam as classes `rc-*` desta folha (uma folha só, no orçamento).
  encapsulation: ViewEncapsulation.None,
})
export class RentalCreate implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly rentalService = inject(RentalService);
  private readonly contactGate = inject(CompanyContactGate);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly cardNames = CREATE_CARDS;
  protected readonly today = todayInBusinessTz();

  // ------------------------------------------------------------------ formulário
  protected readonly form = createRentalForm(inject(FormBuilder));
  protected readonly caucaoParts = new FormArray<CaucaoPartGroup>([]);
  protected readonly periodParts = new FormArray<PeriodPartGroup>([]);
  /** Períodos escolhidos em "Só algumas" e a frequência em que foram escolhidos. */
  protected readonly selected = signal<readonly number[]>([]);
  private readonly selectedFreq = signal<RentalBillingFrequency>('WEEKLY');

  /** O valor inteiro do formulário, a cada mudança. */
  protected readonly v = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });
  private readonly partsValue = toSignal(this.caucaoParts.valueChanges.pipe(map(() => this.caucaoParts.getRawValue())), {
    initialValue: [] as Array<{ amount: string; due: string }>,
  });
  private readonly periodPartsValue = toSignal(
    this.periodParts.valueChanges.pipe(map(() => this.periodParts.getRawValue())),
    { initialValue: [] as Array<{ amount: string; offset: number }> },
  );

  // ------------------------------------------------------------------ derivados
  protected readonly period = computed<PeriodValue>(() => {
    const v = this.v();
    return {
      startDate: v.startDate,
      pickupTime: v.pickupTime,
      pickupOtherDay: v.pickupOtherDay,
      pickupDay: v.pickupDay,
      endDate: v.endDate,
    };
  });
  protected readonly frequency = computed(() => this.v().billingFrequency);
  protected readonly words = computed(() => periodWords(this.frequency()));
  protected readonly periods = computed(() => {
    const { startDate, endDate } = this.v();
    return endDate > startDate ? periodCount(startDate, endDate, this.frequency()) : 0;
  });
  private readonly firstDue = computed(() => this.v().firstPaymentDate || this.v().startDate);
  protected readonly rateCents = computed(() => ptBrMoneyCents(this.v().periodRateReais) ?? 0);
  private readonly minCents = computed(() => minChargeCents(this.v().automaticCharge === true));
  private readonly pickupDay = computed(() => {
    const v = this.v();
    return v.pickupOtherDay && v.pickupDay ? v.pickupDay : v.startDate;
  });

  // ---- caução
  protected readonly caucao = computed(() => caucaoAmounts({ ...this.v(), parts: this.partsValue() }));
  protected readonly caucaoDues = computed(() => this.partsValue().map((p) => p.due));
  protected readonly caucaoSum = computed(() =>
    this.partsValue().reduce((a, p) => a + (ptBrMoneyCents(p.amount) ?? 0), 0),
  );
  private readonly caucaoPartsOn = computed(() => {
    const v = this.v();
    return !v.caucaoPaid && v.caucaoSplit && this.caucao().net > 0;
  });

  // ---- cobranças
  /** A escolha de "Só algumas" só vale na frequência em que foi feita. */
  private readonly effectiveSelected = computed(() =>
    this.selectedFreq() === this.frequency() ? this.selected() : [],
  );
  /** Escolhas que deixaram de existir: a frequência mudou, ou o fim tirou a semana do período. */
  private readonly staleSelected = computed(() => {
    if (this.selectedFreq() !== this.frequency()) return [...this.selected()];
    return this.selected().filter((i) => i >= this.periods());
  });
  private readonly pastSelected = computed(() =>
    this.effectiveSelected().filter(
      (i) => i < this.periods() && periodDue(this.firstDue(), i, this.frequency()) < this.today,
    ),
  );
  protected readonly periodOffsets = computed(() => this.periodPartsValue().map((p) => p.offset));
  protected readonly periodSum = computed(() =>
    this.periodPartsValue().reduce((a, p) => a + (ptBrMoneyCents(p.amount) ?? 0), 0),
  );

  private readonly discountState = computed<CreatePlanInput['discount']>(() => {
    const v = this.v();
    if (!v.descOn) return null;
    const n = intOf(v.discountN);
    const value = ptBrMoneyCents(v.discountValue);
    if (!n || value === null || value <= 0) return null;
    return { valueCents: value, firstPeriods: Math.min(n, Math.max(this.periods(), 1)) };
  });

  protected readonly planInput = computed<CreatePlanInput>(() => {
    const v = this.v();
    const caucaoParts = this.caucaoPartsOn()
      ? this.partsValue().map((p) => ({ dueDate: p.due, amountCents: ptBrMoneyCents(p.amount) ?? 0 }))
      : null;
    return {
      frequency: this.frequency(),
      startDate: v.startDate,
      periods: this.periods(),
      firstDue: this.firstDue(),
      rateCents: this.rateCents(),
      today: this.today,
      discount: this.discountState(),
      split: v.parcOn
        ? {
            scope: v.splitScope,
            selected: this.effectiveSelected(),
            parts: this.periodPartsValue().map((p) => ({
              amountCents: ptBrMoneyCents(p.amount) ?? 0,
              offsetDays: p.offset,
            })),
          }
        : null,
      caucaoCents: this.caucao().net,
      caucaoPaid: v.caucaoPaid,
      caucaoParts,
    };
  });

  protected readonly charges = computed(() =>
    this.periods() > 0 && this.rateCents() > 0 ? createCharges(this.planInput()) : [],
  );

  /** Menor parte de período que o plano gera (o mínimo por cobrança). */
  private readonly smallestPart = computed<number | null>(() => {
    const split = this.charges().filter((c) => c.kind === 'RENTAL_PERIOD' && c.instalmentCount > 1);
    return split.length ? Math.min(...split.map((c) => c.amountCents)) : null;
  });

  protected readonly weekItems = computed<WeekItem[]>(() => {
    const freq = this.frequency();
    const sel = this.effectiveSelected();
    return Array.from({ length: this.periods() }, (_, i) => {
      const due = periodDue(this.firstDue(), i, freq);
      return { i, label: `${this.words().one.slice(0, 3)} ${i + 1}`, date: dShort(due), on: sel.includes(i), past: due < this.today };
    });
  });

  protected readonly rateHintText = computed(() => rateHint(this.frequency(), this.firstDue(), this.periods()));
  protected readonly discountOptions = computed(() => firstNOptions(this.frequency(), this.periods()));
  protected readonly discountHintText = computed(() => {
    const d = ptBrMoneyCents(this.v().discountValue);
    const n = intOf(this.v().discountN);
    if (!d || !n || this.rateCents() <= 0 || d >= this.rateCents()) return '';
    return discountHint(this.frequency(), n, this.periods(), this.rateCents(), d);
  });
  protected readonly partOptions = computed(() => partDueOptions(this.frequency(), this.firstDue()));
  protected readonly canAddPeriodPart = computed(() => this.periodPartsValue().length < PERIOD_PARTS_MAX);
  protected readonly canDropSelection = computed(
    () => this.staleSelected().length > 0 || this.pastSelected().length > 0,
  );

  // ---- prévias (conta local, na hora)
  protected readonly caucaoPreviewModel = computed(() => {
    const p = this.planInput();
    return caucaoPreview({
      netCents: this.caucao().net,
      discountCents: this.caucao().discount,
      parts: p.caucaoParts,
      singleDue: caucaoDue(p.startDate || this.today, p.firstDue || this.today),
      pickupDay: this.pickupDay(),
    });
  });
  protected readonly chargesPreviewModel = computed(() =>
    chargesPreview({
      frequency: this.frequency(),
      startDate: this.v().startDate,
      endDate: this.v().endDate,
      firstDue: this.firstDue(),
      discount: this.discountState(),
      charges: this.charges(),
    }),
  );

  // ------------------------------------------------------------------ validação e etapas
  private readonly card1Errors = computed(() => driverVehicleErrors(this.v()));
  private readonly card2Errors = computed(() => periodErrors(this.period()));
  private readonly card3Errors = computed(() =>
    caucaoErrors({ ...this.v(), parts: this.partsValue() }, { today: this.today, minCents: this.minCents() }),
  );
  private readonly card4Errors = computed(() =>
    chargesErrors(
      { ...this.v(), parts: this.periodPartsValue() },
      {
        words: this.words(),
        periods: this.periods(),
        minCents: this.minCents(),
        selected: this.effectiveSelected(),
        stale: this.staleSelected(),
        past: this.pastSelected(),
        smallestPart: this.smallestPart(),
      },
    ),
  );

  /** Campos que o usuário já visitou: só neles o erro aparece. */
  private readonly touched = signal<ReadonlySet<string>>(new Set());
  /** Tocou em "Criar aluguel": todos os erros aparecem. */
  protected readonly submitted = signal(false);
  /** Recusas do servidor (preflight/400) por controle, até o campo mudar. */
  protected readonly serverFieldErrors = signal<Readonly<Record<string, string>>>({});

  /** Os erros de um card: os da tela e as recusas do servidor que moram nele. */
  private cardErrors(card: number, local: Record<string, string>): Record<string, string> {
    const out = { ...local };
    for (const [k, msg] of Object.entries(this.serverFieldErrors())) {
      if (CARD_OF_CONTROL[k] === card && !out[k]) out[k] = msg;
    }
    return out;
  }

  // ---- cards 5 a 8 (regras em `cards/terms-rules.ts`)
  /** Valor de UMA cobrança para a multa e os juros: a menor (com desconto), ou o valor cheio. */
  protected readonly chargeCents = computed(() => {
    const amounts = createPeriodAmounts(this.planInput());
    return amounts.length ? Math.min(...amounts) : this.rateCents();
  });
  private readonly card5Errors = computed(() => termsErrors(this.v(), { chargeCents: this.chargeCents() }));
  private readonly billingCtx = computed(() => ({ asaasConnected: this.asaasConnected(), isOwner: this.isOwner }));
  private readonly card7Errors = computed(() => billingErrors(this.v(), this.billingCtx()));

  protected readonly shownErrors = computed<Readonly<Partial<Record<string, string>>>>(() => {
    const t = this.touched();
    const all = {
      ...this.card1Errors(),
      ...this.card2Errors(),
      ...this.card3Errors(),
      ...this.card4Errors(),
      ...this.card5Errors(),
      ...this.card7Errors(),
    };
    const out: Record<string, string> = {};
    const showAll = this.submitted();
    for (const [k, msg] of Object.entries(all)) if (showAll || t.has(k) || ALWAYS_SHOWN.has(k)) out[k] = msg;
    for (const [k, msg] of Object.entries(this.serverFieldErrors())) if (!out[k]) out[k] = msg;
    return out;
  });

  /** Uma recusa do servidor num campo do card também o deixa por fazer, até o campo mudar. */
  private withServer(card: number, status: CardCompleteness): CardCompleteness {
    if (!status.complete) return status;
    const server = this.cardErrors(card, {});
    const first = Object.values(server)[0];
    return first ? { complete: false, firstMissing: first } : status;
  }

  /** Pronto? e o que falta, card a card: a barra de etapas e o "Faltam N coisas" leem daqui. */
  protected readonly cardStatus = computed<CardCompleteness[]>(() => [
    completenessFrom(this.cardErrors(0, this.card1Errors())),
    completenessFrom(this.cardErrors(1, this.card2Errors())),
    // A caução é opcional ("deixe 0 se não cobra"), mas o card só fica pronto depois de
    // respondido: vazio é "ainda não preenchido", não "sem caução".
    completenessFrom(
      this.cardErrors(2, this.card3Errors()),
      this.v().caucaoReais.trim() === '' ? 'Digite o valor da caução. Se não cobra, coloque 0.' : null,
    ),
    completenessFrom(this.cardErrors(3, this.card4Errors())),
    this.withServer(4, card5Status(this.v(), { chargeCents: this.chargeCents() })),
    this.withServer(5, ALWAYS_COMPLETE),
    this.withServer(6, card7Status(this.v(), this.billingCtx())),
    this.withServer(7, ALWAYS_COMPLETE),
  ]);

  protected readonly progress = computed(() => createProgress(progressDone(this.cardStatus().map((s) => s.complete))));
  protected readonly missing = computed(() => missingRows(this.cardStatus()));

  protected readonly sentence = computed(() =>
    periodSentence(this.v().startDate, this.v().endDate, this.v().billingFrequency),
  );

  protected markTouched(key: string): void {
    if (this.touched().has(key)) return;
    this.touched.update((t) => new Set([...t, key]));
  }

  // ------------------------------------------------------------------ motoristas e carros
  private readonly drivers = signal<DriverListItem[]>([]);
  private readonly vehicles = signal<VehicleListItem[]>([]);
  /** Livres no período escolhido; `null` sem período (ninguém aparece ocupado). */
  private readonly freeDriverIds = signal<ReadonlySet<string> | null>(null);
  private readonly freeVehicleIds = signal<ReadonlySet<string> | null>(null);
  protected readonly driverLost = signal(false);
  protected readonly vehicleLost = signal(false);
  protected readonly pickersFailed = signal(false);
  private allRequest = 0;
  private freeRequest = 0;
  private loadedPeriod: string | null = null;

  private readonly periodKey = computed(() => {
    const { startDate, endDate } = this.v();
    return startDate && endDate && endDate > startDate ? `${startDate}|${endDate}` : '';
  });

  protected readonly driverOptions = computed<SearchSelectOption[]>(() => {
    const free = this.freeDriverIds();
    return this.drivers().map((d) => {
      const name = formatPersonName(d.name);
      return { id: d.id, title: name, initials: initialsOf(name), busy: !!free && !free.has(d.id) };
    });
  });

  protected readonly vehicleOptions = computed<SearchSelectOption[]>(() => {
    const free = this.freeVehicleIds();
    return this.vehicles()
      .filter((c) => !c.sold)
      .map((c) => ({
        id: c.id,
        title: formatPlate(c.plate),
        subtitle: formatVehicleLabel(c.brand, c.model),
        busy: !!free && !free.has(c.id),
      }));
  });

  constructor() {
    // A 1ª cobrança nasce igual ao início e o acompanha, até o usuário escolher outra data.
    let lastStart = '';
    this.form.controls.startDate.valueChanges.pipe(takeUntilDestroyed()).subscribe((start) => {
      const first = this.form.controls.firstPaymentDate;
      if (!first.value || first.value === lastStart) first.setValue(start);
      lastStart = start;
    });
    // Período novo: recarrega quem está livre nesse intervalo.
    effect(() => {
      const key = this.periodKey();
      untracked(() => {
        if (key !== this.loadedPeriod) this.loadFree();
      });
    });
    // Enquanto ninguém digitou numa parte, as partes se redividem sozinhas quando o total ou a
    // quantidade muda (iguais, centavos na última). Depois da primeira edição, ficam como estão.
    effect(() => {
      const net = this.caucao().net;
      const n = this.partsValue().length;
      if (this.caucaoPartsEdited()) return;
      untracked(() => n >= 2 && resplit(this.caucaoParts, net));
    });
    effect(() => {
      const rate = this.rateCents();
      const n = this.periodPartsValue().length;
      if (this.periodPartsEdited()) return;
      untracked(() => n >= 2 && resplit(this.periodParts, rate));
    });
    // Campo alterado: a recusa do servidor para ele deixa de valer (a caução também pelas partes).
    merge(this.form.valueChanges, this.caucaoParts.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dropStaleServerErrors());
    // Só o que o usuário faz conta como edição (o rascunho nasce daí); padrões e restauração, não.
    merge(this.form.valueChanges, this.caucaoParts.valueChanges, this.periodParts.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.programmaticDepth === 0) this.userEdited.set(true);
      });
    // O corpo mudou depois de pedir a prévia: a prévia e o Confira deixam de valer (como o
    // `bodyKey`/`previewedKey` do passo a passo). O usuário toca em Criar de novo.
    effect(() => {
      const key = this.bodyKey();
      untracked(() => this.invalidateIfChanged(key));
    });
    // Os padrões que chegam depois (Pix ligado, modelo de contrato) esperam a página ficar livre.
    effect(() => {
      const busy = this.checking() || this.confirmOpen() || this.saving();
      if (!busy) untracked(() => this.drainDefaults());
    });
  }

  // ------------------------------------------------------------------ edição do usuário
  /** O usuário mexeu em algo: só então há rascunho. */
  private readonly userEdited = signal(false);
  private programmaticDepth = 0;

  /** Uma mudança que não é do usuário (padrão, restauração, escolha que deixou de estar livre). */
  private programmatic(fn: () => void): void {
    this.programmaticDepth++;
    try {
      fn();
    } finally {
      this.programmaticDepth--;
    }
  }

  private readonly pendingDefaults: Array<() => void> = [];

  /** Aplica um padrão assíncrono agora, ou quando não houver conferência nem Confira abertos. */
  private whenIdle(fn: () => void): void {
    if (this.checking() || this.confirmOpen() || this.saving()) this.pendingDefaults.push(fn);
    else this.programmatic(fn);
  }

  private drainDefaults(): void {
    while (this.pendingDefaults.length) {
      const fn = this.pendingDefaults.shift();
      if (fn) this.programmatic(fn);
    }
  }

  /** Digitou o valor de uma parte: daqui em diante, as partes não se redividem mais. */
  protected readonly caucaoPartsEdited = signal(false);
  protected readonly periodPartsEdited = signal(false);

  // ---- cards 6 e 7: o modelo de contrato e a ligação da cobrança por Pix (como o passo a passo)
  private readonly asaasService = inject(AsaasIntegrationService);
  private readonly contractTemplateService = inject(ContractTemplateService);
  protected readonly isOwner = this.session.getCompanyRoleFromToken() === 'OWNER';
  protected readonly asaasConnected = computed(() => this.asaasService.status()?.connected === true);
  protected readonly hasContractTemplate = signal(false);
  /** O usuário escolheu como cobrar / o contrato: a resposta que chega depois não muda a escolha. */
  private automaticTouched = false;
  private templateTouched = false;

  ngOnInit(): void {
    const restored = this.restoreDraft();
    // O "Novo aluguel" da página do carro chega com `?vehicleId=`: o carro já vem escolhido.
    const vehicleId = this.route.snapshot?.queryParamMap?.get('vehicleId');
    if (!restored && vehicleId) this.programmatic(() => this.form.controls.vehicleId.setValue(vehicleId));
    this.draftReady = true;
    this.loadAll();
    // Padrões do passo a passo: com a cobrança por Pix ligada, "Cobranças automáticas"; com
    // modelo de contrato, "gerar pelo modelo". O rascunho vence os dois.
    this.asaasService.load().subscribe({
      next: () =>
        this.whenIdle(() => {
          const automatic = this.form.controls.automaticCharge;
          if (!restored && !this.automaticTouched) automatic.setValue(this.asaasConnected());
          // Rascunho de quando o Pix estava ligado: nunca "automáticas" sem a ligação.
          else if (automatic.value && !this.asaasConnected()) automatic.setValue(false);
        }),
      error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
    });
    this.contractTemplateService.get().subscribe({
      next: () =>
        this.whenIdle(() => {
          this.hasContractTemplate.set(true);
          if (!restored && !this.templateTouched) this.form.controls.useContractTemplate.setValue(true);
        }),
      error: () => this.hasContractTemplate.set(false),
    });
  }

  // ---- cards 6, 7 e 8
  protected setUseTemplate(on: boolean): void {
    this.templateTouched = true;
    this.form.controls.useContractTemplate.setValue(on);
  }

  protected setAutomatic(on: boolean): void {
    this.automaticTouched = true;
    this.form.controls.automaticCharge.setValue(on);
  }

  protected setNotes(text: string): void {
    this.form.controls.notes.setValue(text);
  }

  protected retryPickers(): void {
    this.pickersFailed.set(false);
    this.loadAll();
    this.loadFree();
  }

  /** Todos os motoristas (menos os suspensos) e carros: a lista existe antes do período. */
  private loadAll(): void {
    const id = ++this.allRequest;
    const fail = (err: unknown): void => {
      if (id !== this.allRequest) return;
      this.apiErrors.claim(err);
      this.pickersFailed.set(true);
    };
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => {
        if (id === this.allRequest) this.vehicles.set(res.content ?? []);
      },
      error: fail,
    });
    this.driverService.list({ size: 500, sort: 'name_asc' }).subscribe({
      next: (res) => {
        if (id === this.allRequest) this.drivers.set((res.content ?? []).filter((d) => d.status !== 'SUSPENDED'));
      },
      error: fail,
    });
  }

  /**
   * Quem está livre no período: a mesma busca do formulário de hoje (`availableForRental` +
   * `periodStart`/`periodEnd`, corte por colisão real de intervalo). Quem não está livre aparece
   * apagado; uma escolha que deixou de estar livre cai, com aviso.
   */
  private loadFree(): void {
    const id = ++this.freeRequest;
    const key = this.periodKey();
    this.loadedPeriod = key;
    if (!key) {
      this.freeDriverIds.set(null);
      this.freeVehicleIds.set(null);
      return;
    }
    const [periodStart, periodEnd] = key.split('|');
    const free = { size: 500, availableForRental: true, periodStart, periodEnd };
    const fail = (err: unknown): void => {
      if (id !== this.freeRequest) return;
      this.apiErrors.claim(err);
      this.pickersFailed.set(true);
    };
    this.vehiclesService.list({ ...free, sort: 'plate_asc' }).subscribe({
      next: (res) => {
        if (id !== this.freeRequest) return;
        const ids = new Set((res.content ?? []).map((c) => c.id));
        this.freeVehicleIds.set(ids);
        const sel = this.form.controls.vehicleId.value;
        const lost = !!sel && !ids.has(sel);
        if (lost) this.programmatic(() => this.form.controls.vehicleId.setValue(''));
        this.vehicleLost.set(lost);
      },
      error: fail,
    });
    this.driverService.list({ ...free, sort: 'name_asc' }).subscribe({
      next: (res) => {
        if (id !== this.freeRequest) return;
        const ids = new Set((res.content ?? []).filter((d) => d.status !== 'SUSPENDED').map((d) => d.id));
        this.freeDriverIds.set(ids);
        const sel = this.form.controls.driverId.value;
        const lost = !!sel && !ids.has(sel);
        if (lost) this.programmatic(() => this.form.controls.driverId.setValue(''));
        this.driverLost.set(lost);
      },
      error: fail,
    });
  }

  // ------------------------------------------------------------------ cards 1 e 2
  protected setDriver(id: string): void {
    this.form.controls.driverId.setValue(id);
    this.driverLost.set(false);
    this.markTouched('driverId');
  }

  protected setVehicle(id: string): void {
    this.form.controls.vehicleId.setValue(id);
    this.vehicleLost.set(false);
    this.markTouched('vehicleId');
  }

  protected patchPeriod(patch: Partial<PeriodValue>): void {
    this.form.patchValue(patch);
  }

  // ------------------------------------------------------------------ card 3 · Caução
  protected caucaoCheck(which: 'full' | 'desc' | 'split'): void {
    const v = this.form.getRawValue();
    const next = toggleCheck({ descOn: v.caucaoDescOn, splitOn: v.caucaoSplit }, which);
    if (next.splitOn && !v.caucaoSplit && this.caucaoParts.length === 0) this.seedCaucaoParts(next.descOn);
    this.form.patchValue({ caucaoDescOn: next.descOn, caucaoSplit: next.splitOn });
  }

  protected toggleCaucaoPaid(): void {
    this.form.controls.caucaoPaid.setValue(!this.form.controls.caucaoPaid.value);
  }

  /** Duas partes iguais (centavos na última): na data da caução e duas semanas depois. */
  private seedCaucaoParts(descOn: boolean): void {
    const v = this.form.getRawValue();
    const gross = ptBrMoneyCents(v.caucaoReais) ?? 0;
    const discount = descOn ? (ptBrMoneyCents(v.caucaoDiscount) ?? 0) : 0;
    const net = Math.max(0, gross - discount);
    const amounts = net > 0 ? splitEvenly(net, 2).map(centsText) : ['', ''];
    const first = caucaoDue(v.startDate || this.today, this.firstDue() || this.today);
    const due = first < this.today ? this.today : first;
    this.caucaoParts.push(newCaucaoPart(amounts[0], due));
    this.caucaoParts.push(newCaucaoPart(amounts[1], addDaysIso(due, 14)));
  }

  /** Uma parte a mais, com o que falta para a soma e duas semanas depois da última. */
  protected addCaucaoPart(): void {
    if (this.caucaoParts.length >= 24) return;
    const last = this.caucaoParts.at(this.caucaoParts.length - 1);
    const rest = this.caucao().net - this.caucaoSum();
    this.caucaoParts.push(newCaucaoPart(rest > 0 ? centsText(rest) : '', addDaysIso(last?.controls.due.value || this.today, 14)));
  }

  protected removeCaucaoPart(i: number): void {
    if (this.caucaoParts.length > 2) this.caucaoParts.removeAt(i);
  }

  // ------------------------------------------------------------------ card 4 · Cobranças
  protected setFrequency(f: RentalBillingFrequency): void {
    this.form.controls.billingFrequency.setValue(f);
    // "Vence na" de cada parte fica dentro do período da frequência nova.
    const max = partOffsetMax(f);
    this.periodParts.controls.forEach((p) => {
      if (p.controls.offset.value > max) p.controls.offset.setValue(max);
    });
  }

  protected chargesCheck(which: 'full' | 'desc' | 'split'): void {
    const v = this.form.getRawValue();
    const next = toggleCheck({ descOn: v.descOn, splitOn: v.parcOn }, which);
    if (next.splitOn && !v.parcOn && this.periodParts.length === 0) this.seedPeriodParts();
    this.form.patchValue({ descOn: next.descOn, parcOn: next.splitOn });
  }

  /** Duas partes iguais: no vencimento e uns dias depois (por semana, terça e sexta). */
  private seedPeriodParts(): void {
    const rate = this.rateCents();
    const amounts = rate > 0 ? splitEvenly(rate, 2).map(centsText) : ['', ''];
    this.periodParts.push(newPeriodPart(amounts[0], 0));
    this.periodParts.push(newPeriodPart(amounts[1], SECOND_PART_OFFSET[this.frequency()]));
  }

  protected addPeriodPart(): void {
    if (this.periodParts.length >= PERIOD_PARTS_MAX) return;
    const last = this.periodParts.at(this.periodParts.length - 1);
    const rest = this.rateCents() - this.periodSum();
    const offset = Math.min((last?.controls.offset.value ?? 0) + 1, partOffsetMax(this.frequency()));
    this.periodParts.push(newPeriodPart(rest > 0 ? centsText(rest) : '', offset));
  }

  protected removePeriodPart(i: number): void {
    if (this.periodParts.length > 2) this.periodParts.removeAt(i);
  }

  protected setScope(s: 'ALL' | 'SOME'): void {
    this.form.controls.splitScope.setValue(s);
  }

  protected toggleWeek(i: number): void {
    this.userEdited.set(true);
    const freq = this.frequency();
    // Escolha feita noutra frequência: o que estava salvo não vale; começa de novo aqui.
    const base = this.selectedFreq() === freq ? this.selected() : [];
    this.selectedFreq.set(freq);
    this.selected.set(base.includes(i) ? base.filter((x) => x !== i) : [...base, i].sort((a, b) => a - b));
  }

  /** Tira da escolha o que deixou de existir e o que já venceu. */
  protected dropStaleWeeks(): void {
    this.userEdited.set(true);
    const drop = new Set([...this.staleSelected(), ...this.pastSelected()]);
    const freq = this.frequency();
    const base = this.selectedFreq() === freq ? this.selected() : [];
    this.selected.set(base.filter((i) => !drop.has(i)));
    this.selectedFreq.set(freq);
  }

  // ------------------------------------------------------------------ corpo
  /** Os valores crus do corpo; a caução vai LÍQUIDA (o desconto dela é só da tela). */
  protected raw(): RentalCreateRaw {
    const v = this.form.getRawValue();
    const net = this.caucao().net;
    return {
      vehicleId: v.vehicleId,
      driverId: v.driverId,
      startDate: v.startDate,
      endDate: v.endDate,
      billingFrequency: v.billingFrequency,
      periodRateReais: v.periodRateReais,
      caucaoReais: net > 0 ? centsText(net) : '',
      caucaoPaid: v.caucaoPaid,
      automaticCharge: v.automaticCharge,
      notes: v.notes,
      initialKm: intOf(v.initialKm),
      pickupDate: this.pickupDay() ? `${this.pickupDay()}T${v.pickupTime}` : '',
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

  protected plan(): ChargePlanDto | null {
    return buildCreatePlan(this.planInput());
  }

  /** O corpo do create (a entrega 5 o manda, depois da prévia do servidor). */
  protected body(): CreateRentalRequest {
    return buildCreateBody(this.raw(), this.plan());
  }

  protected preflightBody(): RentalPreflightRequest {
    return buildPreflightBody(this.raw());
  }

  // ------------------------------------------------------------------ fim da página
  /** Tocou em Criar com algo faltando: o "Faltam N coisas" aparece acima dos botões. */
  protected readonly showMissing = signal(false);
  protected readonly checking = signal(false);
  protected readonly checkFailed = signal(false);
  protected readonly serverPreview = signal<RentalChargePreviewDto | null>(null);
  protected readonly confirmOpen = signal(false);
  /** "Não dá para criar ainda": os motivos, ou `null` com a folha fechada. */
  protected readonly blockReasons = signal<readonly BlockReason[] | null>(null);
  protected readonly saving = signal(false);
  protected readonly created = signal<{ id: string; sync: RentalChargeSyncDto | null } | null>(null);
  /** O corpo cuja prévia está no Confira: é ESTE que o Criar envia, e é dele que o Confira fala. */
  private readonly previewedBody = signal<CreateRentalRequest | null>(null);
  private readonly previewedKey = signal<string | null>(null);
  /** O corpo da conferência em voo. */
  private requestedKey: string | null = null;
  /** Algo mudou durante a conferência (ou com o Confira aberto): tocar em Criar de novo. */
  protected readonly checkStale = signal(false);
  private checkSeq = 0;
  private contactRetried = false;
  /** Um POST de criação em voo: nunca dois. */
  private sending = false;

  /** O corpo do create como texto: muda quando qualquer coisa que vai no POST muda. */
  private readonly bodyKey = computed(() => {
    this.v();
    this.planInput();
    this.hasContractTemplate();
    return JSON.stringify(this.body());
  });

  private driverNameOf(id: string): string {
    return this.driverOptions().find((d) => d.id === id)?.title ?? '';
  }
  private plateOf(id: string): string {
    return this.vehicleOptions().find((c) => c.id === id)?.title ?? '';
  }

  /** O Confira sai do corpo conferido e da prévia do servidor, nunca do formulário de agora. */
  protected readonly confirm = computed(() => {
    const body = this.previewedBody();
    const preview = this.serverPreview();
    if (!body || !preview) return null;
    return confirmModel({
      preview,
      frequency: body.billingFrequency,
      periods: periodCount(body.startDate, body.endDate, body.billingFrequency),
      startDate: body.startDate,
      endDate: body.endDate,
      firstDue: body.firstPaymentDate || body.startDate,
      driverName: this.driverNameOf(body.driverId),
      plate: this.plateOf(body.vehicleId),
      automatic: body.automaticCharge === true,
      // Com "Recebi por fora" o corpo leva a caução cheia (o desconto é ignorado).
      caucaoPaid: body.caucaoPaid === true,
      caucaoGrossCents: body.caucaoAmount ?? 0,
      useContractTemplate: body.contractSource === 'AUTO',
    });
  });

  protected readonly done = computed(() => {
    const c = this.created();
    const body = this.previewedBody();
    if (!c || !body) return null;
    return createdModel({
      driverName: this.driverNameOf(body.driverId),
      plate: this.plateOf(body.vehicleId),
      startDate: body.startDate,
      endDate: body.endDate,
      automatic: body.automaticCharge === true,
      preview: this.serverPreview(),
      useContractTemplate: body.contractSource === 'AUTO',
      sync: c.sync,
    });
  });

  /** O corpo mudou: a conferência em voo é descartada e a prévia na tela deixa de valer. */
  private invalidateIfChanged(key: string): void {
    if (this.checking() && this.requestedKey !== null && key !== this.requestedKey) {
      this.checkSeq++;
      this.requestedKey = null;
      this.checking.set(false);
      this.checkStale.set(true);
    }
    const shown = this.previewedKey();
    if (shown !== null && key !== shown && !this.saving() && !this.created()) {
      this.serverPreview.set(null);
      this.previewedBody.set(null);
      this.previewedKey.set(null);
      this.confirmOpen.set(false);
      this.checkStale.set(true);
    }
  }

  /** "Criar aluguel": com algo faltando, mostra o que falta; senão, confere com o servidor. */
  protected create(): void {
    if (this.checking() || this.saving()) return;
    this.submitted.set(true);
    if (this.missing().length > 0) {
      this.showMissing.set(true);
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[data-testid="create-missing"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }
    this.showMissing.set(false);
    this.checkStale.set(false);
    this.check();
  }

  /** Preflight (sem o plano) e prévia do servidor (com o plano) — a mesma ordem do passo a passo. */
  private check(): void {
    const seq = ++this.checkSeq;
    const body = this.body();
    const key = this.bodyKey();
    this.requestedKey = key;
    this.checking.set(true);
    this.checkFailed.set(false);
    this.serverPreview.set(null);
    this.previewedBody.set(null);
    this.previewedKey.set(null);
    this.rentalService
      .preflight(this.preflightBody())
      .pipe(
        switchMap((res) => {
          if (seq !== this.checkSeq) return of(null);
          const issues = res.issues ?? [];
          if (issues.some((i) => i.severity !== 'WARNING')) {
            this.applyServerIssues(issues);
            return of(null);
          }
          return this.rentalService.chargePreview(body);
        }),
        catchError((err: unknown) => {
          this.apiErrors.claim(err);
          if (seq === this.checkSeq) this.checkFailed.set(true);
          return of(null);
        }),
      )
      .subscribe((preview) => {
        if (seq !== this.checkSeq) return;
        this.checking.set(false);
        this.requestedKey = null;
        if (!preview) return;
        // O corpo mudou enquanto o servidor respondia: esta resposta não é do que está na tela.
        if (this.bodyKey() !== key) {
          this.checkStale.set(true);
          return;
        }
        if (preview.blocker) {
          const card = blockerCard(preview.blocker, body.chargePlan ?? null);
          this.blockReasons.set([{ key: 'blocker', text: planBlockerMessage(preview.blocker), card, link: null }]);
          return;
        }
        this.serverPreview.set(preview);
        this.previewedBody.set(body);
        this.previewedKey.set(key);
        this.confirmOpen.set(true);
      });
  }

  private lastValues: Record<string, unknown> = {};

  /** O que as recusas do servidor olham: os controles e as partes da caução. */
  private serverWatch(): Record<string, unknown> {
    return {
      ...(this.form.getRawValue() as unknown as Record<string, unknown>),
      $caucaoParts: JSON.stringify(this.caucaoParts.getRawValue()),
    };
  }

  private applyServerIssues(items: readonly RentalPreflightItem[]): void {
    const { fields, reasons } = readServerIssues(items, this.form.controls.driverId.value);
    this.lastValues = this.serverWatch();
    this.serverFieldErrors.set(fields);
    this.confirmOpen.set(false);
    if (reasons.length) this.blockReasons.set(reasons);
  }

  /** Uma recusa some quando QUALQUER controle de que o valor recusado depende muda. */
  private dropStaleServerErrors(): void {
    const current = this.serverWatch();
    const errs = this.serverFieldErrors();
    if (Object.keys(errs).length) {
      const kept: Record<string, string> = {};
      for (const [k, msg] of Object.entries(errs)) {
        if (controlsOfServerError(k).every((c) => current[c] === this.lastValues[c])) kept[k] = msg;
      }
      if (Object.keys(kept).length !== Object.keys(errs).length) this.serverFieldErrors.set(kept);
    }
    this.lastValues = { ...current };
  }

  /** "Criar aluguel e cobranças" no Confira: dados da locadora completos, e o corpo da prévia. */
  protected confirmCreate(): void {
    if (this.saving() || !this.previewedBody() || this.bodyKey() !== this.previewedKey()) return;
    this.contactRetried = false;
    this.saving.set(true);
    this.contactGate.ensureComplete().subscribe((ok) => {
      if (ok) this.send();
      else this.saving.set(false);
    });
  }

  private send(): void {
    const body = this.previewedBody();
    if (!body) {
      this.saving.set(false);
      return;
    }
    if (this.sending) return;
    this.sending = true;
    this.saving.set(true);
    this.rentalService.create(body).subscribe({
      next: (r) => {
        this.sending = false;
        this.saving.set(false);
        this.dropDraft();
        this.confirmOpen.set(false);
        this.created.set({ id: r.id, sync: r.chargeSync ?? null });
        // A página virou "Aluguel criado": o foco vai para o título novo.
        afterNextRender(
          () => {
            const h1 = this.host.nativeElement.querySelector<HTMLElement>('h1');
            h1?.setAttribute('tabindex', '-1');
            h1?.focus();
          },
          { injector: this.injector },
        );
      },
      error: (err: HttpErrorResponse) => {
        this.sending = false;
        this.fail(err);
      },
    });
  }

  private block(text: string): void {
    this.confirmOpen.set(false);
    this.blockReasons.set([{ key: 'create', text, card: null, link: null }]);
  }

  /**
   * A criação foi recusada. No caminho "dados da locadora incompletos", o botão fica ocupado
   * (`saving`) até a pergunta responder: um segundo toque não manda um segundo POST.
   */
  private fail(err: HttpErrorResponse): void {
    if (isCompanyContactIncomplete(err)) {
      this.apiErrors.claim(err);
      if (this.contactRetried) {
        this.contactRetried = false;
        this.saving.set(false);
        this.block(CONTACT_STILL_INCOMPLETE_COPY);
        return;
      }
      this.contactRetried = true;
      this.contactGate.promptAfterServerRefusal().subscribe((ok) => {
        if (ok) {
          this.send();
        } else {
          this.contactRetried = false;
          this.saving.set(false);
        }
      });
      return;
    }
    this.saving.set(false);
    const parsed = readPreflightError(err);
    if (parsed && parsed.issues.length) {
      this.apiErrors.claim(err);
      this.applyServerIssues(parsed.issues);
      return;
    }
    const code = apiErrorCode(err);
    this.apiErrors.claim(err);
    if (code && PLAN_ERROR_MESSAGES[code]) {
      this.block(planBlockerMessage({ code, message: (err.error as { message?: string } | null)?.message ?? null }));
      return;
    }
    this.block(
      isDriverRegistrationIncomplete(err)
        ? DRIVER_REGISTRATION_INCOMPLETE_COPY
        : companySafe(this.apiErrors.messageFor(err, CREATE_FALLBACK), CREATE_FALLBACK),
    );
  }

  /** A folha fechou: com "Mudar" ou "Voltar e editar" de um motivo, vai ao card. */
  protected onConfirmClosed(exit: SheetExit | null): void {
    this.confirmOpen.set(false);
    // Voltou a editar: a prévia era do corpo de antes; o próximo Criar confere de novo.
    if (!this.created()) {
      this.serverPreview.set(null);
      this.previewedBody.set(null);
      this.previewedKey.set(null);
    }
    if (exit?.kind === 'card') this.goToCard(exit.card);
  }

  protected onBlockedClosed(exit: SheetExit | null): void {
    this.blockReasons.set(null);
    if (exit?.kind === 'card') this.goToCard(exit.card);
  }

  /** Rola até o card e põe o foco no título dele ("Ir", "Mudar"). */
  protected goToCard(card: number): void {
    afterNextRender(
      () => {
        const heading = this.host.nativeElement.querySelector<HTMLElement>(`#rc-c${card + 1}`);
        heading?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        heading?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** "Cancelar": volta à lista e o rascunho fica (dá para continuar depois). */
  protected cancel(): void {
    this.router.navigate(['/alugueis']);
  }

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
    this.router
      .navigateByUrl('/alugueis', { skipLocationChange: true })
      .then(() => this.router.navigate(['/alugueis', 'novo']));
  }

  // ------------------------------------------------------------------ rascunho
  // Os atalhos (cadastro do motorista, Configurações) navegam na MESMA aba. O rascunho, por
  // usuário e empresa no sessionStorage, devolve a página na volta. Chave própria, v1.
  protected readonly draftRestored = signal(false);
  private draftOff = false;
  /** Só grava depois de restaurar: senão o formulário vazio apagaria o rascunho. */
  private draftReady = false;

  private draftKey(): string | null {
    const userId = this.session.getItem('id');
    const companyId = this.session.getItem('selectedCompanyId');
    return userId && companyId ? `${CREATE_DRAFT_PREFIX}:${userId}:${companyId}` : null;
  }

  private readonly draftAutosave = effect(() => {
    const data: CreateDraft = {
      v: 1,
      form: this.v(),
      parts: this.partsValue(),
      periodParts: this.periodPartsValue(),
      caucaoPartsEdited: this.caucaoPartsEdited(),
      periodPartsEdited: this.periodPartsEdited(),
      selected: [...this.selected()],
      selectedFreq: this.selectedFreq(),
    };
    // Só depois de uma edição do usuário: os padrões (Pix ligado, modelo de contrato, carro da
    // página do carro) sozinhos não são rascunho, e a próxima visita não diria "continuamos".
    const edited = this.userEdited();
    untracked(() => {
      const key = this.draftKey();
      if (!key || !this.draftReady || this.draftOff || !edited) return;
      this.session.setItem(key, JSON.stringify(data));
    });
  });

  private restoreDraft(): boolean {
    const key = this.draftKey();
    const raw = key ? this.session.getItem(key) : null;
    if (!raw) return false;
    try {
      const d = JSON.parse(raw) as CreateDraft;
      if (d?.v !== 1 || !d.form) return false;
      this.programmatic(() => {
        this.form.patchValue(d.form);
        (d.parts ?? []).forEach((p) => this.caucaoParts.push(newCaucaoPart(p.amount ?? '', p.due ?? '')));
        (d.periodParts ?? []).forEach((p) =>
          this.periodParts.push(newPeriodPart(p.amount ?? '', Number(p.offset) || 0)),
        );
      });
      // Um rascunho já é do usuário: continua sendo guardado.
      this.userEdited.set(true);
      this.caucaoPartsEdited.set(d.caucaoPartsEdited === true);
      this.periodPartsEdited.set(d.periodPartsEdited === true);
      this.selected.set(d.selected ?? []);
      this.selectedFreq.set(d.selectedFreq ?? 'WEEKLY');
      this.draftRestored.set(true);
      return true;
    } catch {
      return false;
    }
  }

  /** Apaga o rascunho (ao criar e no "Começar do zero"). */
  protected dropDraft(): void {
    this.draftOff = true;
    const key = this.draftKey();
    if (key) this.session.removeItem(key);
  }

  /** "Começar do zero": apaga o rascunho e recomeça a tela. */
  protected discardDraft(): void {
    this.dropDraft();
    this.router
      .navigateByUrl('/alugueis', { skipLocationChange: true })
      .then(() => this.router.navigate(['/alugueis', 'novo']));
  }
}

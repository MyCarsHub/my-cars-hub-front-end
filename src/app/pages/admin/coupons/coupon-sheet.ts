import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  merge,
  of,
  switchMap,
  timeout,
  timer,
} from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { PaintedCard } from '../../../components/core/painted-card/painted-card';
import { SegmentedTabs, SegmentedTabsOption } from '../../../components/core/segmented-tabs/segmented-tabs';
import { NotificationService } from '../../../services/notification.service';
import {
  ALL_PLANS_CODE,
  AdminCoupon,
  AdminCouponPreview,
  AdminCouponRequest,
  CouponCompany,
  CouponDuration,
} from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { parsePtBrMoneyCents, parsePtBrNumber } from '../../../utils/ptbr-number';
import { AdminCouponsService } from './admin-coupons.service';
import {
  ALL_PLANS_TIERS,
  allPlansNames,
  copyCouponCode,
  copyCouponMessage,
  couponDate,
  couponErrorMessage,
  couponPlanLabel,
  createOutcomeUnknown,
  discountLabel,
  durationNote,
  modeCopy,
  offerHeadline,
  openCodeMessage,
  shareMessage,
} from './coupon-copy';
import { PlanPriceRow, planPriceRows } from './coupon-plan-prices';
import { CouponPlanPricesTable } from './coupon-plan-prices-table';
import { planTierOf } from '../../../utils/plan-features';

export const PREVIEW_DEBOUNCE_MS = 350;
export const CREATE_TIMEOUT_MS = 20000;

const MIN_SEARCH_LENGTH = 2;
const PERCENT_DECIMALS = 2;
const STRIPE_GATEWAY = 'stripe';

type DiscountKind = 'AMOUNT' | 'PERCENT';
type Audience = 'COMPANY' | 'OPEN';

export const DEFAULT_EXPIRES_IN_DAYS = 30;
export const DEFAULT_MAX_REDEMPTIONS = 1;
const MAX_DAYS = 365;
/** Teto de meses do servidor (`AdminCouponService.MAX_MONTHS`). */
export const MAX_MONTHS = 36;
const MAX_USES = 1000;
/** Letras, números e hífen, de 4 a 30: a mesma regra do servidor. */
const CODE_PATTERN = /^[A-Za-z0-9-]{4,30}$/;

const AUDIENCE_OPTIONS: readonly SegmentedTabsOption<Audience>[] = [
  { value: 'COMPANY', label: 'Uma empresa', testId: 'coupon-audience-company' },
  { value: 'OPEN', label: 'Qualquer pessoa', testId: 'coupon-audience-open' },
];

const KIND_OPTIONS: readonly SegmentedTabsOption<DiscountKind>[] = [
  { value: 'AMOUNT', label: 'Em R$', testId: 'coupon-kind-amount' },
  { value: 'PERCENT', label: 'Em %', testId: 'coupon-kind-percent' },
];

const DURATION_OPTIONS: readonly SegmentedTabsOption<CouponDuration>[] = [
  { value: 'ONCE', label: 'Uma vez', testId: 'coupon-duration-once' },
  { value: 'REPEATING', label: 'Por meses', testId: 'coupon-duration-repeating' },
  { value: 'FOREVER', label: 'Para sempre', testId: 'coupon-duration-forever' },
];

const DURATION_HINT: Record<CouponDuration, string> = {
  ONCE: 'O desconto entra só na próxima fatura do cliente.',
  REPEATING: `De 1 a ${MAX_MONTHS} meses. O desconto começa na próxima fatura do cliente.`,
  FOREVER: 'O desconto começa na próxima fatura e vale em todas, até você desativar o cupom.',
};

/** 100% para sempre é liberado, mas deixa o plano grátis: o botão só pede uma confirmação. */
const FREE_FOREVER_PERCENT = 100;

/**
 * "Criar cupom". O servidor escolhe o modo: a prévia diz qual foi e o botão
 * muda com ela. Criar só existe com a prévia dos valores que estão na tela,
 * então nada é aplicado a partir de um número que o admin não viu.
 */
@Component({
  selector: 'app-coupon-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, BottomSheet, CouponPlanPricesTable, PaintedCard, SegmentedTabs],
  templateUrl: './coupon-sheet.html',
})
export class CouponSheet implements OnInit {
  private readonly service = inject(AdminCouponsService);
  private readonly notify = inject(NotificationService);
  private readonly doc = inject(DOCUMENT);
  private readonly sheet = viewChild.required(BottomSheet);

  /** Vem preenchida pelo atalho do detalhe da empresa. */
  readonly company = input<CouponCompany | null>(null);
  readonly saved = output<{ coupon: AdminCoupon; company: CouponCompany | null }>();
  readonly closed = output<void>();
  /** A criação ficou sem resposta: o cupom pode existir, e só a lista sabe. */
  readonly listMayHaveChanged = output<void>();

  protected readonly audienceOptions = AUDIENCE_OPTIONS;
  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly durationOptions = DURATION_OPTIONS;
  protected readonly allPlansCode = ALL_PLANS_CODE;
  protected readonly allPlansLabel = `Todos os planos (${allPlansNames()})`;
  protected readonly maxMonths = MAX_MONTHS;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly planControl = new FormControl('', { nonNullable: true });
  /** Texto mascarado: o valor só vira centavos em `discount`. */
  protected readonly amountControl = new FormControl('', { nonNullable: true });
  protected readonly percentControl = new FormControl('', { nonNullable: true });
  /** Texto: vazio até o admin digitar, e `3,5` ou `40` não viram meses. */
  protected readonly monthsControl = new FormControl('', { nonNullable: true });
  protected readonly reasonControl = new FormControl('', { nonNullable: true });
  protected readonly codeControl = new FormControl('', { nonNullable: true });
  protected readonly daysControl = new FormControl(String(DEFAULT_EXPIRES_IN_DAYS), { nonNullable: true });
  protected readonly usesControl = new FormControl(String(DEFAULT_MAX_REDEMPTIONS), { nonNullable: true });
  protected readonly firstPurchaseControl = new FormControl(false, { nonNullable: true });

  private readonly planValue = toSignal(this.planControl.valueChanges, { initialValue: '' });
  private readonly amountValue = toSignal(this.amountControl.valueChanges, { initialValue: '' });
  private readonly percentValue = toSignal(this.percentControl.valueChanges, { initialValue: '' });
  private readonly monthsValue = toSignal(this.monthsControl.valueChanges, { initialValue: '' });
  private readonly reasonValue = toSignal(this.reasonControl.valueChanges, { initialValue: '' });
  private readonly codeValue = toSignal(this.codeControl.valueChanges, { initialValue: '' });
  private readonly daysValue = toSignal(this.daysControl.valueChanges, { initialValue: String(DEFAULT_EXPIRES_IN_DAYS) });
  private readonly usesValue = toSignal(this.usesControl.valueChanges, { initialValue: String(DEFAULT_MAX_REDEMPTIONS) });
  private readonly firstPurchaseValue = toSignal(this.firstPurchaseControl.valueChanges, { initialValue: false });

  protected readonly audience = signal<Audience>('COMPANY');
  protected readonly selected = signal<CouponCompany | null>(null);
  protected readonly kind = signal<DiscountKind>('AMOUNT');
  protected readonly duration = signal<CouponDuration>('REPEATING');
  /** O admin tocou em criar um cupom de 100% para sempre e falta confirmar. */
  protected readonly confirmingFree = signal(false);
  protected readonly results = signal<CouponCompany[]>([]);
  protected readonly searchError = signal<string | null>(null);
  private readonly plans = signal<PlanResponse[]>([]);
  protected readonly plansError = signal<string | null>(null);

  protected readonly preview = signal<AdminCouponPreview | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewError = signal<string | null>(null);

  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly created = signal<AdminCoupon | null>(null);

  private readonly previewRequests = new Subject<AdminCouponRequest | null>();

  /** Planos pagos, da Stripe, à venda: os que um cupom pode cobrir. */
  private readonly onSale = computed(() =>
    this.plans().filter(
      (plan) =>
        plan.price > 0 &&
        plan.gateway === STRIPE_GATEWAY &&
        plan.purchasable !== false &&
        plan.contactOnly !== true,
    ),
  );

  protected readonly planOptions = computed(() =>
    this.onSale()
      .map((plan) => ({
        code: plan.code,
        label: `${couponPlanLabel(plan.code)} · ${discountLabel({
          amountOffCents: Math.round(plan.price * 100),
          percentOff: null,
        })}`,
      })),
  );

  private readonly discount = computed<Pick<AdminCouponRequest, 'amountOffCents' | 'percentOff'> | null>(() => {
    if (this.kind() === 'AMOUNT') {
      const cents = parsePtBrMoneyCents(this.amountValue()).scaled;
      return cents !== null && cents > 0 ? { amountOffCents: cents, percentOff: null } : null;
    }
    const scaled = parsePtBrNumber(this.percentValue(), PERCENT_DECIMALS).scaled;
    return scaled !== null && scaled > 0 ? { amountOffCents: null, percentOff: scaled / 100 } : null;
  });

  /** Valor digitado que não é um desconto. Vazio ainda não é erro. */
  protected readonly discountInvalid = computed(() => {
    const raw = this.kind() === 'AMOUNT' ? this.amountValue() : this.percentValue();
    return raw.trim() !== '' && this.discount() === null;
  });

  protected readonly isOpen = computed(() => this.audience() === 'OPEN');
  protected readonly allPlans = computed(() => this.planValue() === ALL_PLANS_CODE);
  protected readonly isRepeating = computed(() => this.duration() === 'REPEATING');
  protected readonly durationHint = computed(() => DURATION_HINT[this.duration()]);

  /**
   * O plano mais barato que "todos os planos" cobre: um desconto em R$ do tamanho dele
   * deixaria esse plano de graça. O servidor confere de novo com a tabela de planos.
   */
  protected readonly cheapest = computed(() => {
    const covered = this.onSale().filter((plan) =>
      (ALL_PLANS_TIERS as readonly string[]).includes(planTierOf(plan.name) ?? ''),
    );
    const plan = covered.reduce<PlanResponse | null>((min, p) => (!min || p.price < min.price ? p : min), null);
    if (!plan) return null;
    const cents = Math.round(plan.price * 100);
    return { cents, plan: couponPlanLabel(plan.code), price: discountLabel({ amountOffCents: cents, percentOff: null }) };
  });

  /** Em R$ e todos os planos: o limite aparece antes de digitar. */
  protected readonly amountLimitHint = computed(() => {
    const cheapest = this.cheapest();
    if (!this.allPlans() || this.kind() !== 'AMOUNT' || !cheapest) return null;
    return `Em todos os planos, o valor precisa ser menor que ${cheapest.price}: é o ${cheapest.plan}, o plano mais barato.`;
  });

  /** Valor em R$ que zera (ou passa) o plano mais barato. */
  protected readonly amountOverLimit = computed(() => {
    const cheapest = this.cheapest();
    const cents = this.discount()?.amountOffCents ?? null;
    if (!this.allPlans() || this.kind() !== 'AMOUNT' || !cheapest || cents === null || cents < cheapest.cents) {
      return null;
    }
    const typed = discountLabel({ amountOffCents: cents, percentOff: null });
    const relation = cents === cheapest.cents ? 'é o preço do' : 'é mais que o';
    return `${typed} ${relation} ${cheapest.plan} (${cheapest.price}), o plano mais barato. Use um valor menor ou escolha um plano só.`;
  });

  private readonly months = computed(() => wholeNumber(this.monthsValue(), 1, MAX_MONTHS));
  /** Vazio ainda não é erro; o botão só espera. */
  protected readonly monthsInvalid = computed(
    () => this.isRepeating() && this.monthsValue().trim() !== '' && this.months() === null,
  );

  private readonly code = computed(() => this.codeValue().trim().toUpperCase());
  private readonly days = computed(() => wholeNumber(this.daysValue(), 1, MAX_DAYS));
  private readonly uses = computed(() => wholeNumber(this.usesValue(), 1, MAX_USES));

  protected readonly codeInvalid = computed(() => this.code() !== '' && !CODE_PATTERN.test(this.code()));
  protected readonly daysInvalid = computed(() => this.days() === null);
  protected readonly usesInvalid = computed(() => this.uses() === null);

  private readonly draft = computed<AdminCouponRequest | null>(() => {
    const planCode = this.planValue();
    const discount = this.discount();
    if (!planCode || !discount || this.amountOverLimit()) return null;
    const duration = this.duration();
    const durationMonths = duration === 'REPEATING' ? this.months() : null;
    if (duration === 'REPEATING' && durationMonths === null) return null;
    const plan = planCode === ALL_PLANS_CODE ? { planCode: null, allPlans: true } : { planCode };
    const base = { ...plan, ...discount, duration, durationMonths, reason: '' };
    if (this.isOpen()) {
      const days = this.days();
      const uses = this.uses();
      if (this.codeInvalid() || days === null || uses === null) return null;
      return {
        ...base,
        openCode: true,
        ...(this.code() !== '' ? { code: this.code() } : {}),
        maxRedemptions: uses,
        expiresInDays: days,
        firstPurchaseOnly: this.firstPurchaseValue(),
      };
    }
    const company = this.selected();
    return company ? { companyId: company.id, ...base } : null;
  });

  protected readonly canSubmit = computed(
    () =>
      this.preview() !== null &&
      !this.noInvoiceInWindow() &&
      this.reasonValue().trim() !== '' &&
      !this.creating(),
  );

  protected readonly submitLabel = computed(() => {
    if (this.creating()) return 'Criando…';
    const mode = this.preview()?.mode;
    if (mode === 'APPLIED_TO_SUBSCRIPTION') return 'Aplicar na assinatura';
    return mode === 'PROMOTION_CODE' || mode === 'OPEN_CODE' ? 'Gerar código' : 'Criar cupom';
  });

  protected readonly modeView = computed(() => {
    const preview = this.preview();
    return preview ? modeCopy(preview.mode) : null;
  });

  protected readonly invoiceDates = computed(() =>
    (this.preview()?.discountedInvoices ?? []).map((invoice) => couponDate(invoice)),
  );

  protected readonly firstFullDate = computed(() => couponDate(this.preview()?.firstFullInvoice ?? null));

  /** `null` = o código ainda não tem janela; lista vazia = nenhuma fatura cai nela. */
  protected readonly noInvoiceInWindow = computed(() => this.preview()?.discountedInvoices?.length === 0);

  /** Para sempre não tem fatura cheia: a data única vira "em diante". */
  protected readonly foreverPreview = computed(() => (this.preview()?.duration ?? this.duration()) === 'FOREVER');

  /** Em todos os planos, num código, quem lê quer a oferta; o valor de cada plano vem na tabela. */
  protected readonly headline = computed(() => {
    const preview = this.preview();
    const discount = this.discount();
    if (!preview) return null;
    if (this.allPlans() && preview.mode !== 'APPLIED_TO_SUBSCRIPTION' && discount) {
      return offerHeadline({ ...discount, duration: this.duration(), durationMonths: this.months() });
    }
    return preview.summary;
  });

  /** "Quanto cada plano paga": só em todos os planos, com a prévia do servidor. */
  protected readonly priceRows = computed<PlanPriceRow[]>(() => {
    const preview = this.preview();
    if (!preview || !this.allPlans() || preview.mode === 'APPLIED_TO_SUBSCRIPTION') return [];
    return planPriceRows(
      (preview.plans ?? []).map((plan) => ({
        planCode: plan.planCode,
        planName: plan.planName,
        period: plan.period,
        listCents: plan.listAmountCents,
        discountedCents: plan.discountedAmountCents,
      })),
    );
  });

  protected readonly priceNote = computed(() =>
    durationNote({ duration: this.duration(), durationMonths: this.months() }),
  );

  protected readonly title = computed(() => {
    const coupon = this.created();
    if (!coupon) return 'Criar cupom';
    return coupon.mode === 'APPLIED_TO_SUBSCRIPTION' ? 'Desconto aplicado' : 'Código criado';
  });

  /** A frase pronta para o dono mandar; só existe para o código aberto. */
  protected readonly createdSummary = computed(() => {
    const coupon = this.createdView();
    if (!coupon?.promotionCode || coupon.mode !== 'OPEN_CODE') return null;
    return openCodeMessage(coupon.promotionCode, coupon, this.preview()?.discountedAmountCents ?? null);
  });

  /** O cupom criado, com o que a resposta não trouxer completado pelo que estava na folha. */
  private readonly createdView = computed(() => {
    const coupon = this.created();
    if (!coupon) return null;
    return {
      ...coupon,
      planCode: coupon.planCode ?? (this.allPlans() ? ALL_PLANS_CODE : this.planValue()),
      allPlans: coupon.allPlans ?? this.allPlans(),
      duration: coupon.duration ?? this.duration(),
      durationMonths: coupon.durationMonths ?? this.months(),
    };
  });

  protected readonly createdValidity = computed(() => couponDate(this.created()?.expiresAt ?? null));

  constructor() {
    merge(
      this.planControl.valueChanges,
      this.amountControl.valueChanges,
      this.percentControl.valueChanges,
      this.monthsControl.valueChanges,
      this.codeControl.valueChanges,
      this.daysControl.valueChanges,
      this.usesControl.valueChanges,
      this.firstPurchaseControl.valueChanges,
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refreshPreview());

    // O `timer` fica dentro do `switchMap`: uma tecla nova cancela também a
    // consulta em voo, e resposta velha nunca chega à tela.
    this.previewRequests
      .pipe(
        switchMap((request) =>
          timer(PREVIEW_DEBOUNCE_MS).pipe(
            switchMap(() => (request ? this.askPreview(request) : of(null))),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();

    this.searchControl.valueChanges
      .pipe(
        debounceTime(PREVIEW_DEBOUNCE_MS),
        map((term) => term.trim()),
        distinctUntilChanged(),
        switchMap((term) => {
          this.searchError.set(null);
          if (term.length < MIN_SEARCH_LENGTH) return of([]);
          return this.service.searchCompanies(term).pipe(
            catchError((err: unknown) => {
              this.searchError.set(couponErrorMessage(err, 'load'));
              return of([]);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.results.set(list));
  }

  ngOnInit(): void {
    this.selected.set(this.company());
    this.service.plans().subscribe({
      next: (plans) => {
        this.plans.set(plans ?? []);
        this.adoptPlan(this.selected());
      },
      error: (err: unknown) => this.plansError.set(couponErrorMessage(err, 'load')),
    });
  }

  protected selectCompany(company: CouponCompany): void {
    this.selected.set(company);
    this.results.set([]);
    this.searchControl.setValue('', { emitEvent: false });
    this.adoptPlan(company);
    this.refreshPreview();
  }

  protected changeCompany(): void {
    this.selected.set(null);
    this.refreshPreview();
  }

  protected setAudience(audience: Audience): void {
    this.audience.set(audience);
    this.refreshPreview();
  }

  protected onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const upper = input.value.toUpperCase();
    if (upper !== input.value) input.value = upper;
    this.codeControl.setValue(upper);
  }

  protected setKind(kind: DiscountKind): void {
    this.kind.set(kind);
    this.refreshPreview();
  }

  protected setDuration(duration: CouponDuration): void {
    this.duration.set(duration);
    this.confirmingFree.set(false);
    this.refreshPreview();
  }

  protected onAmountInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.amountControl);
  }

  /** Assinatura ativa só aceita o plano atual: já começa nele. */
  private adoptPlan(company: CouponCompany | null): void {
    const code = company?.planCode;
    if (code && this.planOptions().some((option) => option.code === code)) {
      this.planControl.setValue(code);
    }
  }

  /** Qualquer mudança invalida a prévia na hora: é ela que libera o botão. */
  protected refreshPreview(): void {
    this.confirmingFree.set(false);
    const request = this.draft();
    this.preview.set(null);
    this.previewError.set(null);
    this.previewLoading.set(request !== null);
    this.previewRequests.next(request);
  }

  private askPreview(request: AdminCouponRequest) {
    return this.service.preview(request).pipe(
      map((preview) => {
        this.previewLoading.set(false);
        this.preview.set(preview);
        return null;
      }),
      catchError((err: unknown) => {
        this.previewLoading.set(false);
        this.previewError.set(couponErrorMessage(err, 'preview'));
        return of(null);
      }),
    );
  }

  /** 100% e para sempre: nada bloqueia, só uma confirmação neutra antes. */
  private readonly freeForever = computed(
    () => this.duration() === 'FOREVER' && this.discount()?.percentOff === FREE_FOREVER_PERCENT,
  );

  protected submit(): void {
    if (!this.canSubmit()) return;
    if (this.freeForever()) {
      this.confirmingFree.set(true);
      return;
    }
    this.create();
  }

  protected confirmFree(): void {
    this.confirmingFree.set(false);
    this.create();
  }

  protected cancelFree(): void {
    this.confirmingFree.set(false);
  }

  private create(): void {
    const request = this.draft();
    const company = this.isOpen() ? null : this.selected();
    if (!this.canSubmit() || !request || (!this.isOpen() && !company)) return;
    this.creating.set(true);
    this.createError.set(null);
    this.service.create({ ...request, reason: this.reasonControl.value.trim() }).pipe(timeout(CREATE_TIMEOUT_MS)).subscribe({
      next: (coupon) => {
        this.creating.set(false);
        this.created.set(coupon);
        this.saved.emit({ coupon, company });
      },
      error: (err: unknown) => {
        this.creating.set(false);
        this.createError.set(couponErrorMessage(err, 'create'));
        if (createOutcomeUnknown(err)) this.listMayHaveChanged.emit();
      },
    });
  }

  protected copyCreated(): void {
    const code = this.created()?.promotionCode;
    if (code) void copyCouponCode(this.doc.defaultView, this.notify, code);
  }

  /** Copia a mensagem completa de compartilhar, não o resumo da tela. */
  protected copyMessage(): void {
    const coupon = this.createdView();
    if (!coupon?.promotionCode) return;
    const text = shareMessage({ code: coupon.promotionCode, coupon, company: this.selected()?.name ?? null });
    void copyCouponMessage(this.doc.defaultView, this.notify, text);
  }

  protected finish(): void {
    this.sheet().requestClose(true);
  }
}

/** Inteiro dentro da faixa, ou `null`: `1e2` e `3,5` não passam. */
function wholeNumber(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

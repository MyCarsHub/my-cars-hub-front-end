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
  timer,
} from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { PaintedCard } from '../../../components/core/painted-card/painted-card';
import { SegmentedTabs, SegmentedTabsOption } from '../../../components/core/segmented-tabs/segmented-tabs';
import { NotificationService } from '../../../services/notification.service';
import {
  AdminCoupon,
  AdminCouponPreview,
  AdminCouponRequest,
  CouponCompany,
} from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { parsePtBrMoneyCents, parsePtBrNumber } from '../../../utils/ptbr-number';
import { AdminCouponsService } from './admin-coupons.service';
import {
  copyCouponCode,
  couponDate,
  couponErrorMessage,
  couponPlanLabel,
  discountLabel,
  durationLabel,
  modeCopy,
} from './coupon-copy';

export const PREVIEW_DEBOUNCE_MS = 350;

const MIN_SEARCH_LENGTH = 2;
const PERCENT_DECIMALS = 2;
const STRIPE_GATEWAY = 'stripe';

type DiscountKind = 'AMOUNT' | 'PERCENT';

const KIND_OPTIONS: readonly SegmentedTabsOption<DiscountKind>[] = [
  { value: 'AMOUNT', label: 'Em R$', testId: 'coupon-kind-amount' },
  { value: 'PERCENT', label: 'Em %', testId: 'coupon-kind-percent' },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: durationLabel(i + 1),
}));

/**
 * "Criar cupom". O servidor escolhe o modo: a prévia diz qual foi e o botão
 * muda com ela. Criar só existe com a prévia dos valores que estão na tela,
 * então nada é aplicado a partir de um número que o admin não viu.
 */
@Component({
  selector: 'app-coupon-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, BottomSheet, PaintedCard, SegmentedTabs],
  templateUrl: './coupon-sheet.html',
})
export class CouponSheet implements OnInit {
  private readonly service = inject(AdminCouponsService);
  private readonly notify = inject(NotificationService);
  private readonly doc = inject(DOCUMENT);
  private readonly sheet = viewChild.required(BottomSheet);

  /** Vem preenchida pelo atalho do detalhe da empresa. */
  readonly company = input<CouponCompany | null>(null);
  readonly saved = output<{ coupon: AdminCoupon; company: CouponCompany }>();
  readonly closed = output<void>();

  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly monthOptions = MONTH_OPTIONS;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly planControl = new FormControl('', { nonNullable: true });
  /** Texto mascarado: o valor só vira centavos em `discount`. */
  protected readonly amountControl = new FormControl('', { nonNullable: true });
  protected readonly percentControl = new FormControl('', { nonNullable: true });
  protected readonly monthsControl = new FormControl(1, { nonNullable: true });
  protected readonly reasonControl = new FormControl('', { nonNullable: true });

  private readonly planValue = toSignal(this.planControl.valueChanges, { initialValue: '' });
  private readonly amountValue = toSignal(this.amountControl.valueChanges, { initialValue: '' });
  private readonly percentValue = toSignal(this.percentControl.valueChanges, { initialValue: '' });
  private readonly monthsValue = toSignal(this.monthsControl.valueChanges, { initialValue: 1 });
  private readonly reasonValue = toSignal(this.reasonControl.valueChanges, { initialValue: '' });

  protected readonly selected = signal<CouponCompany | null>(null);
  protected readonly kind = signal<DiscountKind>('AMOUNT');
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

  protected readonly planOptions = computed(() =>
    this.plans()
      .filter(
        (plan) =>
          plan.price > 0 &&
          plan.gateway === STRIPE_GATEWAY &&
          plan.purchasable !== false &&
          plan.contactOnly !== true,
      )
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

  private readonly draft = computed<AdminCouponRequest | null>(() => {
    const company = this.selected();
    const planCode = this.planValue();
    const discount = this.discount();
    if (!company || !planCode || !discount) return null;
    return { companyId: company.id, planCode, ...discount, durationMonths: this.monthsValue(), reason: '' };
  });

  protected readonly canSubmit = computed(
    () => this.preview() !== null && this.reasonValue().trim() !== '' && !this.creating(),
  );

  protected readonly submitLabel = computed(() => {
    if (this.creating()) return 'Criando…';
    const mode = this.preview()?.mode;
    if (mode === 'APPLIED_TO_SUBSCRIPTION') return 'Aplicar na assinatura';
    return mode === 'PROMOTION_CODE' ? 'Gerar código' : 'Criar cupom';
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

  protected readonly title = computed(() => {
    const coupon = this.created();
    if (!coupon) return 'Criar cupom';
    return coupon.mode === 'APPLIED_TO_SUBSCRIPTION' ? 'Desconto aplicado' : 'Código criado';
  });

  protected readonly createdValidity = computed(() => couponDate(this.created()?.expiresAt ?? null));

  constructor() {
    merge(
      this.planControl.valueChanges,
      this.amountControl.valueChanges,
      this.percentControl.valueChanges,
      this.monthsControl.valueChanges,
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

  protected setKind(kind: DiscountKind): void {
    this.kind.set(kind);
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

  protected submit(): void {
    const request = this.draft();
    const company = this.selected();
    if (!this.canSubmit() || !request || !company) return;
    this.creating.set(true);
    this.createError.set(null);
    this.service.create({ ...request, reason: this.reasonControl.value.trim() }).subscribe({
      next: (coupon) => {
        this.creating.set(false);
        this.created.set(coupon);
        this.saved.emit({ coupon, company });
      },
      error: (err: unknown) => {
        this.creating.set(false);
        this.createError.set(couponErrorMessage(err, 'create'));
      },
    });
  }

  protected copyCreated(): void {
    const code = this.created()?.promotionCode;
    if (code) void copyCouponCode(this.doc.defaultView, this.notify, code);
  }

  protected finish(): void {
    this.sheet().requestClose(true);
  }
}

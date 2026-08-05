import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { timeout } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../components/core/page-card/page-card';
import { PlanCardComponent } from '../../components/core/plan-card/plan-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../components/segmented-toggle/segmented-toggle';
import { ApiErrorService } from '../../services/api-error.service';
import { showsAsUnlimited } from '../../utils/plan-limits';
import {
  BillingService,
  CHECKOUT_PENDING_KEY,
  CHECKOUT_PLAN_CODE_KEY,
  isFreePlanInForce,
} from '../../services/billing.service';
import { BillingAccessService } from '../../services/billing-access.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import {
  BillingCycle,
  GatewayOverride,
  PlanGateway,
  PlanPeriod,
  PlanResponse,
  SubscriptionChangeOutcome,
  SubscriptionStatus,
} from '../../types/billing.types';

/**
 * What the CTA of a given plan card means for THIS customer. Derived from
 * (subscription status × current plan × target plan) — never from the plan
 * code alone, which is what let an unpaid checkout render as "Plano atual".
 */
export type PlanIntent =
  | 'CURRENT'
  | 'PENDING_PAYMENT'
  | 'SUBSCRIBE'
  | 'UPGRADE'
  /** Target is the FREE plan — the only thing `/downgrade` accepts. */
  | 'DOWNGRADE'
  /**
   * Cheaper PAID plan, same period. The backend answers 400 on `/downgrade`
   * for a paid target, so this is a brand new checkout, not a schedule.
   */
  | 'PLAN_SWITCH'
  | 'SCHEDULED'
  /** Mensal → Anual. New paid commitment, no proration on the month left. */
  | 'PERIOD_UPGRADE'
  /** Anual → Mensal. Burns the remainder of an already-paid year. */
  | 'PERIOD_DOWNGRADE';

/** `visibilitychange` + `focus` fire together; don't double-fetch. */
const REVALIDATE_THROTTLE_MS = 2000;

/** While waiting for the webhook, re-read `/subscription` on this cadence. */
const AWAIT_PAYMENT_POLL_MS = 2500;

/**
 * Hard bound on "verificando pagamento" when the gateway round-trip is already
 * OVER (we came back to this page). The webhook may never land (abandoned
 * checkout); after this the page goes back to a fully interactive state so the
 * user can retry instead of staring at disabled buttons forever.
 */
const AWAIT_PAYMENT_TIMEOUT_MS = 30000;

/**
 * Same bound, but for a checkout still OPEN in another tab: the user has not
 * even finished typing the card yet. A real payment with 3-D Secure routinely
 * takes minutes, and expiring at 30s dropped the banner — and the promise that
 * this page updates itself — right in the middle of the payment.
 */
const CHECKOUT_TAB_TIMEOUT_MS = 15 * 60 * 1000;

/** Slower cadence for that long window: this tab is in the background. */
const CHECKOUT_TAB_POLL_MS = 5000;

/**
 * Ceiling on `POST /billing/checkout`. There is no HTTP timeout interceptor in
 * the app, so a request that neither answers nor errors left the reserved tab
 * orphaned and the CTA stuck on "Processando…" with no error and no retry.
 */
const CHECKOUT_REQUEST_TIMEOUT_MS = 20000;

/**
 * `checkout-open`: the gateway is live in another tab and we may be waiting a
 * long time. `returned`: the user is back on this page, so the wait must be
 * short and end in a fully interactive page.
 */
type AwaitMode = 'returned' | 'checkout-open';

/** Acento do toggle de ciclo: laranja da marca no Mensal, Hub Green no Anual. */
const CYCLE_MONTHLY_BACKGROUND = 'linear-gradient(135deg, #FA602E 0%, #F63B04 55%, #C22F00 100%)';
const CYCLE_MONTHLY_SHADOW = '0 6px 18px -6px rgba(235,63,0,0.4)';
const CYCLE_YEARLY_BACKGROUND = 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)';
const CYCLE_YEARLY_SHADOW = '0 6px 18px -6px rgba(16,185,129,0.45)';

@Component({
  selector: 'app-billing',
  imports: [
    CommonModule,
    DefaultPageLayout,
    ConfirmDialog,
    PageCard,
    PlanCardComponent,
    AlertBanner,
    SegmentedToggle,
  ],
  templateUrl: './billing.html',
  styleUrl: './billing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Billing implements OnInit, OnDestroy {
  private readonly billingService = inject(BillingService);
  private readonly access = inject(BillingAccessService);
  private readonly session = inject(SessionService);
  private readonly externalNav = inject(ExternalNavigationService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly logger = inject(LoggerService);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly isPlatformAdmin = this.session.isPlatformAdmin();
  protected readonly adminGateway = signal<GatewayOverride>('stripe');

  protected readonly plans = this.billingService.plans;
  protected readonly subscription = this.billingService.subscription;
  protected readonly loading = this.billingService.loading;
  protected readonly error = this.billingService.error;

  protected readonly cycle = signal<BillingCycle>('MONTHLY');
  protected readonly expandedPlanId = signal<string | null>(null);
  protected readonly showCompare = signal(false);

  /** Plan whose CTA is currently in flight (per-card spinner + per-card error). */
  protected readonly busyPlanId = signal<string | null>(null);
  /** Error scoped to the card the user just clicked, not a banner off-screen. */
  protected readonly ctaError = signal<{ planId: string; message: string } | null>(null);
  /**
   * Failure of an ACCOUNT-level action (cancelar / reativar). These have no plan
   * card to attach to, so they get their own inline banner next to the buttons —
   * never a toast, which is what used to duplicate the page-level banner.
   */
  protected readonly accountActionError = signal<string | null>(null);
  /** True from "checkout started" until we have revalidated after the return. */
  protected readonly awaitingPayment = signal(false);
  /**
   * Set only when the browser refused the checkout tab. Carries the URL the
   * user can click themselves — never auto-navigated, or we would be back to
   * the blocked pop-up.
   */
  protected readonly manualCheckout = signal<{
    planCode: string;
    planName: string;
    url: string;
  } | null>(null);

  private readonly manualCheckoutLink =
    viewChild<ElementRef<HTMLAnchorElement>>('manualCheckoutLink');

  /**
   * The banner is at the top of the page while the failure is reported on the
   * card the user clicked — on a phone the two are rarely on screen together.
   * Focusing the link moves the keyboard and the viewport to the only action
   * that unblocks the checkout.
   */
  private readonly focusManualCheckoutLink = effect(() => {
    this.manualCheckoutLink()?.nativeElement.focus();
  });
  protected readonly accountActionBusy = signal(false);

  protected readonly showCancelDialog = signal(false);
  protected readonly downgradeTarget = signal<PlanResponse | null>(null);
  /** Mensal↔Anual target awaiting an explicit, informed confirmation. */
  protected readonly periodSwitchTarget = signal<PlanResponse | null>(null);

  protected readonly recommendedName = 'PRO';

  private visibilityListener: (() => void) | null = null;
  private focusListener: (() => void) | null = null;
  private lastRevalidateAt = 0;
  /** Poll handle + hard deadline for the post-gateway "verificando" window. */
  private awaitPollHandle: ReturnType<typeof setInterval> | null = null;
  private awaitDeadline = 0;
  /** Which waiting window is running — they have very different bounds. */
  private awaitMode: AwaitMode = 'returned';

  /**
   * Which gateway to render. PLATFORM_ADMIN can switch; everyone else sees
   * `stripe` (default). See gotchas — the company gateway isn't currently
   * exposed on `access-status` / `subscription`, so we hardcode stripe as
   * the customer-facing default.
   */
  protected readonly activeGateway = computed<PlanGateway>(() =>
    this.isPlatformAdmin ? this.adminGateway() : 'stripe',
  );

  /** Gradient do card recomendado — orange no Mensal, Hub Green no Anual. */
  protected readonly recommendedGradient = computed<string>(() =>
    this.cycle() === 'YEARLY'
      ? 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)'
      : 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)',
  );

  /** Sombra colorida do card recomendado, casando com o gradient ativo. */
  protected readonly recommendedShadow = computed<string>(() =>
    this.cycle() === 'YEARLY'
      ? '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 32px 72px -22px rgba(16,185,129,0.45)'
      : '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 32px 72px -22px rgba(235,63,0,0.45)',
  );

  /** Cor do texto no botão branco do card recomendado (matching gradient). */
  protected readonly recommendedAccentText = computed<string>(() =>
    this.cycle() === 'YEARLY' ? 'text-emerald-700' : 'text-brand-strong',
  );

  // ---------------------------------------------------------------------------
  // Subscription truth — status FIRST, plan second.
  // ---------------------------------------------------------------------------

  protected readonly status = computed<SubscriptionStatus | null>(
    () => this.subscription()?.status ?? null,
  );

  /** A subscription row is in force (free or paid). */
  protected readonly isActive = computed(() => this.status() === 'ACTIVE');

  /**
   * ACTIVE on the FREE plan. After an applied downgrade the backend keeps the
   * subscription ACTIVE with `currentPeriodEnd: null`, so status alone can no
   * longer be read as "assinatura paga vigente".
   *
   * Requires the `/plans` row as positive evidence — while `plans()` is empty
   * (still loading, or `/plans` failed) an ACTIVE subscription counts as PAID,
   * which is what keeps "Cancelar assinatura" on screen for a real customer.
   */
  protected readonly isFreeActive = computed(() =>
    isFreePlanInForce(this.subscription(), this.plans()),
  );

  /** The subscription is PAID and in force — the only "assinatura vigente". */
  protected readonly isPaidActive = computed(() => this.isActive() && !this.isFreeActive());

  /**
   * The subscription STATUS is `TRIALING` — the gateway's trial window.
   *
   * This is NOT the TRIAL plan. A PRO subscription inside its trial period is
   * `TRIALING` while the plan in force is still PRO, with PRO's limits. Reading
   * this status as "the customer is on the TRIAL plan" is what made a PRO trial
   * render the TRIAL card as "Plano atual" — and turned a perfectly legal 4th
   * vehicle (PRO allows 15) into a reported bug. Plan comes from the plan;
   * this signal only ever answers "está em período de teste?".
   */
  protected readonly isTrialingStatus = computed(() => this.status() === 'TRIALING');

  /**
   * A plan is genuinely in force. `TRIALING` counts: a trial always runs ON a
   * plan, so treating it as "no plan" left the PRO card saying "Assinar PRO" to
   * someone already on PRO. `PENDING` / `INCOMPLETE` deliberately do NOT count —
   * an abandoned checkout has no plan in force.
   */
  protected readonly isPlanInForce = computed(() => this.isActive() || this.isTrialingStatus());

  /**
   * The plan actually in force — free plans included, since a free ACTIVE plan
   * genuinely IS the current plan. `null` unless a plan is in force: an
   * abandoned checkout must never mark a card as the current plan (that both
   * lied to the user and disabled the button they needed to retry).
   */
  protected readonly currentPlanCode = computed<string | null>(() =>
    this.isPlanInForce() ? (this.subscription()?.planCode ?? null) : null,
  );

  /** Checkout started, payment NOT confirmed. */
  protected readonly pendingPlanCode = computed<string | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    if (sub.pendingPlanCode) return sub.pendingPlanCode;
    // Fallback for backends that don't send `pendingPlanCode` yet: a
    // non-active, non-trial subscription pointing at a paid plan is pending.
    const status = sub.status;
    if (status === 'PENDING' || status === 'INCOMPLETE') return sub.planCode;
    return null;
  });

  protected readonly pendingPlan = computed<PlanResponse | null>(() => {
    const code = this.pendingPlanCode();
    if (!code) return null;
    return this.plans().find((p) => p.code === code) ?? null;
  });

  protected readonly pendingPlanName = computed<string | null>(
    () => this.pendingPlan()?.name ?? this.pendingPlanCode(),
  );

  protected readonly scheduledDowngradeCode = computed<string | null>(
    () => this.subscription()?.scheduledDowngradePlanCode ?? null,
  );

  protected readonly scheduledDowngradeName = computed<string | null>(() => {
    const code = this.scheduledDowngradeCode();
    if (!code) return null;
    return this.plans().find((p) => p.code === code)?.name ?? code;
  });

  protected readonly scheduledDowngradeAt = computed<string | null>(
    () => this.subscription()?.scheduledDowngradeAt ?? null,
  );

  /**
   * Eyebrow above the hero title. Answers "qual plano?", never "qual status?" —
   * the status has its own pill right next to it (`statusLabel()`), so a
   * TRIALING subscription reads "Plano atual / PRO / Período de teste" instead
   * of replacing the plano with the estado and leaving PRO looking like TRIAL.
   */
  protected readonly heroEyebrow = computed<string>(() => {
    if (this.isFreeActive()) return 'Plano gratuito';
    if (this.isPlanInForce()) return 'Plano atual';
    switch (this.status()) {
      case 'CANCELED':
      case 'EXPIRED':
        return 'Assinatura encerrada';
      default:
        return 'Assinatura';
    }
  });

  protected readonly heroPlanTitle = computed<string>(() => {
    const sub = this.subscription();
    if (!sub) return 'Sem plano ativo';
    switch (sub.status) {
      case 'PENDING':
      case 'INCOMPLETE':
        return 'Nenhum plano ativo';
      default:
        return sub.planName || 'Sem plano ativo';
    }
  });

  /** Honest one-liner explaining a non-ACTIVE state. */
  protected readonly heroNotice = computed<string | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    if (this.isFreeActive()) {
      return 'Você está no plano gratuito, sem cobranças. Escolha um plano pago para liberar todos os recursos.';
    }
    switch (sub.status) {
      case 'ACTIVE':
        return null;
      case 'TRIALING':
        return 'Você está no período de teste — nenhum pagamento foi confirmado ainda.';
      case 'PENDING':
      case 'INCOMPLETE':
        return 'Seu pagamento ainda não foi confirmado. Conclua o pagamento para liberar o plano.';
      case 'PAST_DUE':
      case 'UNPAID':
        return 'Não conseguimos confirmar a última cobrança. Regularize o pagamento para manter o acesso.';
      case 'PAUSED':
        return 'Sua assinatura está pausada.';
      case 'CANCELED':
      case 'EXPIRED':
        return 'Sua assinatura não está mais ativa. Escolha um plano para voltar a usar tudo.';
      default:
        return 'Não reconhecemos o status desta assinatura. Se algo parecer errado, fale com o suporte.';
    }
  });

  /**
   * Reactivate is the way out of the "cancel scheduled" dead end — but the
   * backend only accepts it on an ACTIVE subscription whose paid period has NOT
   * run out yet. Showing the button to a TRIALING user who cancelled — or to an
   * ACTIVE one whose `currentPeriodEnd` is already in the past — guaranteed a
   * 400 + error toast every time.
   */
  protected readonly canReactivate = computed<boolean>(() => {
    const sub = this.subscription();
    // Nothing to reactivate on a free plan: there is no paid commitment and no
    // scheduled cancellation to undo.
    if (this.isFreeActive()) return false;
    if (sub?.status !== 'ACTIVE' || sub.cancelAtPeriodEnd !== true) return false;
    // Expired period → the only way back is a new payment, not /reactivate.
    // A NULL `currentPeriodEnd` is "we don't know", not "expired": hiding the
    // button there would strand a paid subscriber whose period end is
    // momentarily absent. The backend still arbitrates, and a 400 already
    // routes the user to the plans with an explanation. `isFreePlanInForce()`
    // reads the same null the same way — neither rule treats a missing value
    // as evidence against the customer.
    if (sub.currentPeriodEnd === null) return true;
    return this.daysLeftInPaidPeriod() > 0;
  });

  protected readonly canCancel = computed<boolean>(() => {
    const sub = this.subscription();
    if (!sub) return false;
    if (sub.cancelAtPeriodEnd) return false;
    // A free ACTIVE plan is the floor — "Cancelar assinatura" would be a 400
    // and means nothing to the user.
    if (this.isFreeActive()) return false;
    return sub.status === 'ACTIVE' || sub.status === 'TRIALING' || sub.status === 'PAST_DUE';
  });

  // ---------------------------------------------------------------------------
  // Blocked-access reason (arrives as `?reason=` from the guard / paywall).
  // ---------------------------------------------------------------------------

  protected readonly blockedReason = signal<string | null>(null);

  protected readonly blockedMessage = computed<string | null>(() => {
    switch (this.blockedReason()) {
      case 'TRIAL_EXPIRED':
        return 'Seu período de teste terminou. Escolha um plano para voltar a usar a plataforma.';
      case 'PAYMENT_FAILED':
      case 'PAST_DUE':
        return 'Não conseguimos confirmar seu pagamento. Regularize para reabrir o acesso.';
      case 'CANCELED':
        return 'Sua assinatura foi cancelada. Escolha um plano para retomar o acesso.';
      case 'NO_SUBSCRIPTION':
        return 'Você precisa de um plano ativo para acessar o restante da plataforma.';
      case null:
        return null;
      default:
        return 'O acesso à plataforma está bloqueado até você ter um plano ativo.';
    }
  });

  // ---------------------------------------------------------------------------
  // Plan rows
  // ---------------------------------------------------------------------------

  /**
   * Rows filtered by current gateway + selected period, one row per `name`.
   * When multiple codes exist for the same (name, period, gateway) we keep
   * the first — backend should already dedupe, but this stays defensive.
   */
  protected readonly visiblePlans = computed<PlanResponse[]>(() => {
    const gw = this.activeGateway();
    const period: PlanPeriod = this.cycle();
    const seen = new Set<string>();
    const out: PlanResponse[] = [];
    for (const p of this.plans()) {
      if (p.gateway !== gw) continue;
      if (p.period !== period) continue;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      out.push(p);
    }
    return out;
  });

  /**
   * Percent savings for a given `name`, based on YEARLY vs MONTHLY row of
   * the same name + active gateway. Returns 0 when either side is missing.
   */
  protected planYearlySavingsByName(name: string): number {
    const gw = this.activeGateway();
    let monthly = 0;
    let yearly = 0;
    for (const p of this.plans()) {
      if (p.gateway !== gw) continue;
      if (p.name !== name) continue;
      if (p.period === 'MONTHLY') monthly = p.price;
      else if (p.period === 'YEARLY') yearly = p.price;
    }
    if (monthly <= 0 || yearly <= 0) return 0;
    return Math.round(100 * (1 - yearly / (monthly * 12)));
  }

  /** Best yearly savings across all plan groups (for the cycle-toggle badge). */
  protected readonly yearlySavingsBadge = computed<number>(() => {
    const gw = this.activeGateway();
    const monthly = new Map<string, number>();
    const yearly = new Map<string, number>();
    for (const p of this.plans()) {
      if (p.gateway !== gw) continue;
      if (p.period === 'MONTHLY') monthly.set(p.name, p.price);
      else if (p.period === 'YEARLY') yearly.set(p.name, p.price);
    }
    let best = 0;
    for (const [name, m] of monthly) {
      const y = yearly.get(name);
      if (!y || m <= 0 || y <= 0) continue;
      const pct = 100 * (1 - y / (m * 12));
      if (pct > best) best = pct;
    }
    return Math.round(best);
  });

  /**
   * Opções do toggle Mensal/Anual. O badge de desconto só existe quando há
   * economia real no anual — a opção sai sem `badge` quando não há.
   */
  protected readonly cycleOptions = computed<readonly SegmentedToggleOption<BillingCycle>[]>(() => {
    const savings = this.yearlySavingsBadge();
    return [
      {
        value: 'MONTHLY',
        label: 'Mensal',
        activeBackground: CYCLE_MONTHLY_BACKGROUND,
        activeShadow: CYCLE_MONTHLY_SHADOW,
      },
      {
        value: 'YEARLY',
        label: 'Anual',
        badge: savings > 0 ? `-${savings}%` : undefined,
        activeBackground: CYCLE_YEARLY_BACKGROUND,
        activeShadow: CYCLE_YEARLY_SHADOW,
      },
    ];
  });

  /**
   * The exact row backing the subscription in force. `null` while the
   * subscription is not ACTIVE.
   */
  protected currentPlan = computed<PlanResponse | null>(() => {
    const code = this.currentPlanCode();
    if (!code) return null;
    return this.plans().find((p) => p.code === code) ?? null;
  });

  /** Paid gradient only when the plan is really paid and active. */
  protected readonly currentHeroBackground = computed<string | null>(() => {
    if (!this.isPaidActive()) return null;
    const sub = this.subscription();
    if (!sub) return null;
    const name = (sub.planName ?? '').toUpperCase();
    if (name !== 'PRO' && name !== 'ENTERPRISE' && name !== 'BUSINESS') return null;
    return sub.billingCycle === 'YEARLY'
      ? 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)'
      : 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)';
  });

  protected readonly currentHeroMutedClass = computed<string>(() =>
    this.currentHeroBackground() ? 'text-white/80' : 'text-neutral-400',
  );

  protected readonly currentHeroGlow = computed<string>(() =>
    this.currentHeroBackground() ? 'rgba(255,255,255,0.20)' : 'rgba(235,63,0,0.25)',
  );

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.blockedReason.set(this.route.snapshot.queryParamMap.get('reason'));

    if (this.isBrowser && this.session.getItem(CHECKOUT_PENDING_KEY) === 'true') {
      // A checkout round-trip was already in progress when this page loaded:
      // keep the "verificando" state up until the PAID plan actually lands (the
      // webhook is async, so the very first `/subscription` read rarely shows it).
      this.beginAwaitPaymentWindow('returned');
    }

    // The page still renders without `/plans` (the banner from the service
    // explains the empty plan grid), but the failure must leave a trace: this
    // is the call that turns "gratuito vs pago" into a fact. Losing it degrades
    // the classification to "unknown", and `isFreePlanInForce` deliberately
    // resolves unknown as PAID rather than hiding the cancel button.
    this.billingService.loadPlans().subscribe({
      error: (err: unknown) => {
        // The service already put the message in the page-level banner; claiming
        // it here stops the interceptor safety net from saying the same thing again.
        this.apiErrors.claim(err);
        // Warning, not error: the page stays usable and the fallback is
        // documented — `isFreePlanInForce` resolves the unknown plan as PAID.
        this.logger.warn('[billing] loadPlans failed', { error: err });
      },
    });
    this.refreshSubscription();

    if (!this.isBrowser) return;
    this.visibilityListener = () => {
      if (this.document.visibilityState === 'visible') this.revalidate();
    };
    this.focusListener = () => this.revalidate();
    this.document.addEventListener('visibilitychange', this.visibilityListener);
    window.addEventListener('focus', this.focusListener);
  }

  ngOnDestroy(): void {
    this.stopAwaitPolling();
    if (!this.isBrowser) return;
    if (this.visibilityListener) {
      this.document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.focusListener) {
      window.removeEventListener('focus', this.focusListener);
      this.focusListener = null;
    }
  }

  /**
   * Re-read subscription + access status when the user comes back to the app
   * (gateway tab closed, app switched back). Without this the page keeps
   * showing whatever it rendered before the user left for the checkout.
   */
  protected revalidate(): void {
    // `visibilitychange` and `focus` both fire on return from the gateway;
    // collapse the burst into a single round-trip.
    const now = Date.now();
    if (now - this.lastRevalidateAt < REVALIDATE_THROTTLE_MS) return;
    this.lastRevalidateAt = now;

    // The user is looking at THIS tab again, so the long "they are still typing
    // a card somewhere else" window no longer applies: fall back to the short
    // bounded one, or an abandoned checkout would keep every CTA disabled for
    // fifteen minutes.
    if (this.awaitingPayment() && this.awaitMode === 'checkout-open') {
      this.beginAwaitPaymentWindow('returned');
    }

    this.access.invalidate();
    // Background revalidation on tab focus — the user did not ask for it, so a
    // failure must stay silent rather than pop a toast they cannot act on.
    this.access.load().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
    this.refreshSubscription();
  }

  private refreshSubscription(): void {
    this.billingService.loadSubscription().subscribe({
      next: () => this.settlePendingPayment(),
      error: (err: unknown) => {
        // Same deal as `loadPlans`: the banner already carries this message.
        this.apiErrors.claim(err);
        this.settlePendingPayment();
      },
    });
  }

  /**
   * Leave the "processando pagamento" state only when the wait is genuinely
   * over. Fresh backend DATA is not enough: the very first `/subscription` read
   * after the gateway round-trip happens before the webhook lands, and dropping
   * the flag there announced "nada aconteceu" for a payment still in flight.
   *
   * We settle when the paid plan is actually in force, when the backend no
   * longer reports a pending checkout (abandoned / cancelled), or when the hard
   * deadline expires — never leaving every CTA disabled with no way out.
   */
  private settlePendingPayment(): void {
    if (this.awaitingPayment()) {
      const settled =
        this.isPaidActive() || this.pendingPlanCode() === null || Date.now() >= this.awaitDeadline;
      if (!settled) return;
      this.awaitingPayment.set(false);
    }
    this.stopAwaitPolling();
    this.clearCheckoutMarkers();
  }

  /**
   * Enter the bounded "verificando pagamento" window. The checkout now runs in
   * ANOTHER tab, so this tab has no navigation of its own to wait for: polling
   * is what turns it into the paid plan the moment the webhook lands, and the
   * hard deadline is what keeps it from sitting on disabled CTAs forever if the
   * user abandons the gateway tab and never comes back to it.
   */
  private beginAwaitPaymentWindow(mode: AwaitMode): void {
    const returned = mode === 'returned';
    this.awaitMode = mode;
    this.awaitingPayment.set(true);
    this.awaitDeadline =
      Date.now() + (returned ? AWAIT_PAYMENT_TIMEOUT_MS : CHECKOUT_TAB_TIMEOUT_MS);
    this.stopAwaitPolling();
    this.awaitPollHandle = setInterval(
      () => this.refreshSubscription(),
      returned ? AWAIT_PAYMENT_POLL_MS : CHECKOUT_TAB_POLL_MS,
    );
  }

  private stopAwaitPolling(): void {
    if (this.awaitPollHandle) {
      clearInterval(this.awaitPollHandle);
      this.awaitPollHandle = null;
    }
  }

  private clearCheckoutMarkers(): void {
    if (!this.isBrowser) return;
    this.session.removeItem(CHECKOUT_PENDING_KEY);
    this.session.removeItem(CHECKOUT_PLAN_CODE_KEY);
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  protected setCycle(cycle: BillingCycle): void {
    this.cycle.set(cycle);
  }

  protected setAdminGateway(g: GatewayOverride): void {
    this.adminGateway.set(g);
  }

  /** Monthly-equivalent price for a plan row. Yearly rows return price/12. */
  protected monthlyEquivalent(plan: PlanResponse): number {
    return plan.period === 'MONTHLY' ? plan.price : plan.price / 12;
  }

  /**
   * Display a plan limit in the comparison table.
   *
   * A regra de "ilimitado" mora em `utils/plan-limits.ts` e vale para os dois
   * motivos: limite nulo (sentinela da coluna) e plano maquiado (ENTERPRISE,
   * que tem teto real e mesmo assim não mostra número).
   */
  protected formatLimit(value: number | null, planName: string): string {
    return showsAsUnlimited(planName, value) ? '∞' : String(value);
  }

  /**
   * Mesmo predicado do `formatLimit`, exposto ao template porque o `∞` precisa
   * de equivalente textual: o glifo vai `aria-hidden` e um `sr-only` em
   * português ocupa o lugar dele para quem não enxerga a célula. Sem isso o
   * leitor de tela ou fala "infinity" ou cala a célula.
   */
  protected isUnlimited(value: number | null, planName: string): boolean {
    return showsAsUnlimited(planName, value);
  }

  protected formatPrice(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(value);
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  protected statusLabel(status: SubscriptionStatus): string {
    switch (status) {
      case 'PENDING':
      case 'INCOMPLETE':
        return 'Aguardando pagamento';
      case 'TRIALING':
        return 'Período de teste';
      case 'ACTIVE':
        return 'Ativa';
      case 'PAST_DUE':
      case 'UNPAID':
        return 'Pagamento pendente';
      case 'PAUSED':
        return 'Pausada';
      case 'CANCELED':
        return 'Cancelada';
      case 'EXPIRED':
        return 'Expirada';
      default:
        return 'Status desconhecido';
    }
  }

  protected statusBadgeClass(status: SubscriptionStatus): string {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'TRIALING':
      case 'PENDING':
      case 'INCOMPLETE':
      case 'PAST_DUE':
      case 'UNPAID':
      case 'PAUSED':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'CANCELED':
      case 'EXPIRED':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }

  protected statusDotClass(status: SubscriptionStatus): string {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-500';
      case 'TRIALING':
      case 'PENDING':
      case 'INCOMPLETE':
      case 'PAUSED':
        return 'bg-amber-500';
      case 'PAST_DUE':
      case 'UNPAID':
        return 'bg-rose-500';
      case 'CANCELED':
      case 'EXPIRED':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  }

  protected statusPillClass(status: SubscriptionStatus): string {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'TRIALING':
      case 'PENDING':
      case 'INCOMPLETE':
      case 'PAUSED':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'PAST_DUE':
      case 'UNPAID':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'CANCELED':
      case 'EXPIRED':
        return 'bg-gray-50 text-gray-700 border-gray-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  }

  // ---------------------------------------------------------------------------
  // Plan card presentation
  // ---------------------------------------------------------------------------

  protected trackByPlanId(_i: number, plan: PlanResponse): string {
    return plan.id;
  }

  /** True only when the plan is paid, active and in force. */
  protected isCurrent(plan: PlanResponse): boolean {
    return this.currentPlanCode() === plan.code;
  }

  protected isPending(plan: PlanResponse): boolean {
    return this.pendingPlanCode() === plan.code;
  }

  /** Mobile ordering: the card that matters to this user comes first. */
  protected isPrioritized(plan: PlanResponse): boolean {
    return this.isPending(plan) || this.isCurrent(plan);
  }

  protected isRecommended(plan: PlanResponse): boolean {
    return plan.name === this.recommendedName;
  }

  protected isBusinessPlan(plan: PlanResponse): boolean {
    return plan.name === 'BUSINESS' || plan.name === 'ENTERPRISE';
  }

  protected planVariant(plan: PlanResponse): 'trial' | 'pro' | 'business' {
    if (this.isRecommended(plan)) return 'pro';
    if (this.isBusinessPlan(plan)) return 'business';
    return 'trial';
  }

  /** Fallback feature lists, used only when the API carries no limits. */
  private readonly trialFeatures: readonly string[] = [
    'Contratos, cobranças, multas, manutenções',
    'Suporte por email',
  ];

  private readonly proFeatures: readonly string[] = [
    'Cobranças automáticas por Asaas e Stripe',
    'Assinatura eletrônica com validade jurídica',
    'Vistoria digital completa em 14 ângulos por veículo',
    'Multi-usuário com controle de acesso',
    'Suporte prioritário',
  ];

  private readonly businessFeatures: readonly string[] = [
    'Multi-empresa ilimitado (cadastre suas filiais)',
    'Usuários e papéis ilimitados',
    'Relatórios avançados exportáveis',
    'Onboarding assistido dedicado',
    'Suporte prioritário com SLA',
  ];

  private readonly enterpriseFeatures: readonly string[] = [
    'Multi-marca / multi-filial',
    'Usuários e papéis ilimitados',
    'Integrações premium (ERP, telemetria)',
    'Suporte dedicado com SLA',
    'Gerente de conta',
  ];

  /**
   * Human label for a plan limit. Mesma decisão de maquiagem da tabela
   * comparativa (`utils/plan-limits.ts`), para o card e a tabela nunca
   * discordarem sobre o mesmo plano.
   */
  private limitLabel(
    planName: string,
    value: number | null | undefined,
    singular: string,
    plural: string,
  ): string {
    // Campo ausente = a API não mandou a coluna; some o bullet em vez de
    // inventar um limite.
    if (value === undefined) return '';
    if (showsAsUnlimited(planName, value)) return `${plural} ilimitados`;
    return value === 1 ? `1 ${singular}` : `Até ${value} ${plural}`;
  }

  /**
   * Feature bullets. The capacity lines come from the API row (so the card
   * can't contradict the plan the backend actually sells); the qualitative
   * lines stay curated per tier.
   */
  protected planFeatures(plan: PlanResponse): readonly string[] {
    const out: string[] = [];
    const vehicles = this.limitLabel(plan.name, plan.vehicleLimit, 'veículo', 'veículos');
    if (vehicles) out.push(vehicles);
    const drivers = this.limitLabel(plan.name, plan.driverLimit, 'motorista', 'motoristas');
    if (drivers) out.push(drivers);
    if (plan.trialDays > 0) out.push(`${plan.trialDays} dias de teste grátis`);

    if (this.isRecommended(plan)) return [...out, ...this.proFeatures];
    if (plan.name === 'ENTERPRISE') return [...out, ...this.enterpriseFeatures];
    if (this.isBusinessPlan(plan)) return [...out, ...this.businessFeatures];
    return [...out, ...this.trialFeatures];
  }

  protected planSubtitle(plan: PlanResponse): string | null {
    if (this.cycle() === 'YEARLY') {
      const monthly = this.formatPrice(this.monthlyEquivalent(plan));
      const savings = this.planYearlySavingsByName(plan.name);
      return savings > 0
        ? `Equivale a ${monthly}/mês · economiza ${savings}%`
        : `Equivale a ${monthly}/mês`;
    }
    if (this.isRecommended(plan)) {
      const savings = this.planYearlySavingsByName(plan.name);
      if (savings > 0) {
        // Preview the effective monthly if user switched to yearly.
        const gw = this.activeGateway();
        const yearlyRow = this.plans().find(
          (p) => p.name === plan.name && p.gateway === gw && p.period === 'YEARLY',
        );
        if (yearlyRow) {
          return `ou ${this.formatPrice(yearlyRow.price / 12)}/mês no anual`;
        }
      }
    }
    return null;
  }

  protected planDescription(plan: PlanResponse): string | null {
    if (this.isRecommended(plan)) return 'Pra operações que precisam de mais capacidade.';
    if (plan.name === 'ENTERPRISE') return 'Frota grande, integrações premium, suporte dedicado.';
    if (this.isBusinessPlan(plan))
      return 'Pra frotas grandes, multi-filial, com integrações customizadas.';
    return null;
  }

  protected planRibbon(plan: PlanResponse): string | null {
    if (this.isPending(plan)) return 'Aguardando pagamento';
    if (this.scheduledDowngradeCode() === plan.code) return 'Mudança agendada';
    if (this.isRecommended(plan)) return 'Mais popular';
    if (this.isBusinessPlan(plan)) return 'Sua frota cresceu?';
    return null;
  }

  /**
   * The core branch: what does clicking this card mean? Compares the TARGET
   * plan against the plan actually in force, so a downgrade can never be
   * routed into `/checkout`.
   */
  protected planIntent(plan: PlanResponse): PlanIntent {
    if (this.isPending(plan)) return 'PENDING_PAYMENT';
    if (this.isCurrent(plan)) return 'CURRENT';
    if (this.scheduledDowngradeCode() === plan.code) return 'SCHEDULED';

    // The FREE row is never something you buy. It is either the plan already in
    // force, or a `/downgrade` destination — never a `/checkout`. Classified
    // BEFORE everything else: the free row is MONTHLY, so a YEARLY subscriber
    // would otherwise fall into the period branch and be sent to /checkout for
    // a R$ 0,00 plan, which the backend answers with a 400.
    if (this.isFreePlan(plan)) return this.freePlanIntent();

    const current = this.currentPlan();
    if (!current) return 'SUBSCRIBE';

    // Nothing paid is in force: every paid target is a plain first checkout,
    // and there is no paid period a period switch could burn.
    if (current.price <= 0) return 'UPGRADE';

    // A PERIOD change is its own thing and must be classified BEFORE the price
    // comparison. Comparing monthly-equivalents made PRO_YEARLY → PRO_MONTHLY
    // look like an UPGRADE (or a DOWNGRADE), and either verdict routed the
    // user somewhere that silently burns the year they already paid for:
    // the backend charges the new cycle immediately and cancels the old one
    // with NO proration and NO refund.
    if (plan.period !== current.period) {
      return current.period === 'YEARLY' ? 'PERIOD_DOWNGRADE' : 'PERIOD_UPGRADE';
    }

    // Same period, cheaper, but PAID: `/downgrade` answers 400 for a paid
    // target ("…exige um novo checkout"), so this is a checkout, not a
    // scheduled change.
    const target = this.monthlyEquivalent(plan);
    const currentValue = this.monthlyEquivalent(current);
    return target > currentValue ? 'UPGRADE' : 'PLAN_SWITCH';
  }

  protected isFreePlan(plan: PlanResponse): boolean {
    return plan.price <= 0;
  }

  /**
   * What the FREE card means. Only two answers are ever allowed — `CURRENT`
   * (non-actionable) or `DOWNGRADE` (goes to `/downgrade`); a R$ 0,00 plan must
   * never reach `/checkout`.
   *
   * Labelling it CURRENT for every non-paid status was a dead end: a
   * PAST_DUE / CANCELED / EXPIRED user is BLOCKED by `BillingAccessService`
   * while this card told them the free plan was already theirs, leaving paying
   * again as the only exit.
   */
  private freePlanIntent(): PlanIntent {
    // The backend confirms a free plan actually in force.
    if (this.isFreeActive()) return 'CURRENT';
    if (this.canReturnToFree()) return 'DOWNGRADE';
    // No subscription row at all: free is already the floor this account falls
    // back to, so there is nothing to downgrade to.
    return 'CURRENT';
  }

  /**
   * A PAID plan is in force under a trial. Positive evidence only — the `/plans`
   * row must exist and cost money. Without it we say no, so a `/plans` outage
   * cannot flip the free card into a state-changing action.
   */
  private isTrialingOnPaidPlan(): boolean {
    if (!this.isTrialingStatus()) return false;
    const plan = this.currentPlan();
    return plan !== null && plan.price > 0;
  }

  /**
   * Statuses from which "voltar ao plano gratuito" is a real, useful action.
   * An unknown status stays out: we do not fire a state-changing request on a
   * state we cannot reason about.
   */
  private canReturnToFree(): boolean {
    if (this.isPaidActive()) return true;
    // A trial running on a PAID plan is NOT the free plan — labelling the free
    // card "Plano atual" there told a PRO trial they were on TRIAL, which is the
    // exact plano-vs-status collision this page had to stop repeating.
    if (this.isTrialingOnPaidPlan()) return true;
    switch (this.status()) {
      case 'PAST_DUE':
      case 'UNPAID':
      case 'PAUSED':
      case 'CANCELED':
      case 'EXPIRED':
        return true;
      default:
        return false;
    }
  }

  protected planCtaLabel(plan: PlanResponse): string {
    if (this.busyPlanId() === plan.id) return 'Processando…';
    switch (this.planIntent(plan)) {
      case 'CURRENT':
        return 'Plano atual';
      case 'PENDING_PAYMENT':
        return 'Concluir pagamento';
      case 'SCHEDULED':
        return 'Mudança agendada';
      case 'UPGRADE':
        return `Fazer upgrade para ${plan.name}`;
      case 'PERIOD_UPGRADE':
        return `Mudar ${plan.name} para o plano anual`;
      case 'PERIOD_DOWNGRADE':
        return `Mudar ${plan.name} para o plano mensal`;
      case 'DOWNGRADE':
        return 'Voltar ao plano gratuito';
      case 'PLAN_SWITCH':
        return `Mudar para ${plan.name}`;
      case 'SUBSCRIBE':
      default:
        return `Assinar ${plan.name}`;
    }
  }

  protected planCtaNote(plan: PlanResponse): string | null {
    switch (this.planIntent(plan)) {
      case 'UPGRADE':
        // Only when there is a paid period to lose — a first checkout from the
        // free plan costs the user nothing extra.
        return this.burnsPaidPeriod()
          ? 'Cobrança imediata do novo plano; o restante do período pago não vira crédito.'
          : null;
      case 'PENDING_PAYMENT':
        // Must read as "resume", never as "pay again": the CTA reopens the
        // SAME charge that was already started, it does not create a second.
        return 'Retoma a mesma cobrança já iniciada — nada é cobrado duas vezes.';
      case 'PERIOD_UPGRADE':
        return 'Cobrança anual imediata, sem proporcional do mês em curso.';
      case 'PERIOD_DOWNGRADE':
        return 'Cancela sua anual na hora, sem reembolso do período restante.';
      case 'DOWNGRADE':
        // `burnsPaidPeriod()` is the ONLY proof there is a paid period left to
        // honour. Without it (PAST_DUE / CANCELED / EXPIRED) the promise would
        // be a statement about money the UI cannot back.
        return this.burnsPaidPeriod()
          ? 'Vale a partir do fim do período já pago.'
          : 'Sem cobranças. Você volta para o plano gratuito.';
      case 'PLAN_SWITCH':
        // Paid → paid is a new charge, NOT a scheduled change: say so before
        // the click, not after the card is billed.
        return 'Cobrança imediata do novo plano; o restante do período pago não vira crédito.';
      case 'SCHEDULED': {
        const at = this.scheduledDowngradeAt();
        return at ? `Entra em vigor em ${this.formatDate(at)}.` : 'Já agendado.';
      }
      default:
        return null;
    }
  }

  protected planCtaDisabled(plan: PlanResponse): boolean {
    const intent = this.planIntent(plan);
    if (intent === 'CURRENT' || intent === 'SCHEDULED') return true;
    // NOTE: PENDING_PAYMENT is deliberately NOT a disabling intent — that is
    // exactly the button a user who abandoned the checkout needs. It only
    // greys out while another request is genuinely in flight.
    return this.busyPlanId() !== null || this.awaitingPayment();
  }

  protected planCardError(plan: PlanResponse): string | null {
    const err = this.ctaError();
    return err && err.planId === plan.id ? err.message : null;
  }

  protected planAccentClass(plan: PlanResponse): string {
    return this.isRecommended(plan) ? this.recommendedAccentText() : 'text-brand-strong';
  }

  protected planBeforeFeaturesText(plan: PlanResponse): string | null {
    return this.isBusinessPlan(plan) ? 'Tudo que o plano Pro tem +' : null;
  }

  protected planGradient(plan: PlanResponse): string | null {
    return this.isRecommended(plan) ? this.recommendedGradient() : null;
  }

  protected planShadow(plan: PlanResponse): string | null {
    return this.isRecommended(plan) ? this.recommendedShadow() : null;
  }

  /** Human period label for the comparison tables — never the raw plan code. */
  protected planPeriodLabel(plan: PlanResponse): string {
    return plan.period === 'YEARLY' ? 'Cobrança anual' : 'Cobrança mensal';
  }

  protected planCycleSuffix(): string {
    return this.cycle() === 'MONTHLY' ? 'mês' : 'ano';
  }

  protected taglineFor(plan: PlanResponse): string {
    switch (plan.name) {
      case 'TRIAL':
      case 'STARTER':
        return 'Para começar';
      case 'PRO':
        return 'Para escalar';
      case 'BUSINESS':
      case 'ENTERPRISE':
        return 'Para grandes frotas';
      default:
        return '';
    }
  }

  protected readonly hasAnyTrial = computed<boolean>(() =>
    this.visiblePlans().some((p) => p.trialDays > 0),
  );

  protected readonly maxTrialDays = computed<number>(() => {
    let max = 0;
    for (const p of this.visiblePlans()) {
      if (p.trialDays > max) max = p.trialDays;
    }
    return max;
  });

  protected toggleCompare(): void {
    this.showCompare.update((v) => !v);
  }

  protected toggleExpanded(planId: string): void {
    this.expandedPlanId.update((cur) => (cur === planId ? null : planId));
  }

  protected isExpanded(planId: string): boolean {
    return this.expandedPlanId() === planId;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Single entry point for every plan CTA. Branches by intent, not by code. */
  protected onPlanCta(plan: PlanResponse): void {
    if (this.planCtaDisabled(plan)) return;
    this.ctaError.set(null);
    // A leftover "abra o checkout manualmente" link points at the PREVIOUS
    // plan's session; it must not survive the click on another card.
    this.manualCheckout.set(null);
    // A stale page-level banner from a previous failure must not outlive the
    // action the user just took.
    this.billingService.clearError();
    switch (this.planIntent(plan)) {
      case 'SUBSCRIBE':
        this.startCheckout(plan);
        return;
      case 'UPGRADE':
        // An upgrade takes the same server path as PLAN_SWITCH: immediate
        // charge, old subscription cancelled on the spot, no proration and no
        // refund. If there is a paid period left to burn, the user must be told
        // in numbers first — the cheaper direction already was.
        if (this.burnsPaidPeriod()) {
          this.periodSwitchTarget.set(plan);
          return;
        }
        this.startCheckout(plan);
        return;
      case 'PENDING_PAYMENT':
        // Resume, do NOT re-open. Same plan code, no gateway override, so the
        // backend can match the pending session instead of minting a second.
        this.startCheckout(plan, { resumePending: true });
        return;
      case 'PERIOD_UPGRADE':
      case 'PERIOD_DOWNGRADE':
      case 'PLAN_SWITCH':
        // Never straight to /checkout: the user must first be told, in words,
        // exactly what the immediate charge costs them.
        this.periodSwitchTarget.set(plan);
        return;
      case 'DOWNGRADE':
        this.downgradeTarget.set(plan);
        return;
      default:
        return;
    }
  }

  /**
   * Plan codes this page already POSTed a checkout for and got an `externalId`
   * back. In-memory on purpose: it only has to survive until the redirect
   * leaves the page, and a genuinely new page load re-reads the pending state
   * from `/subscription`.
   */
  private readonly startedCheckoutCodes = new Set<string>();

  /**
   * Paid transitions only. Downgrades must never reach this method, and a
   * period switch only reaches it after `confirmPeriodSwitch()`.
   *
   * `resumePending` means "the user is finishing a checkout already started":
   * we deliberately drop the admin gateway override so the request is byte-for-
   * byte the one that created the pending session, letting the backend hand
   * back the SAME session instead of opening a second charge.
   */
  private startCheckout(plan: PlanResponse, opts?: { resumePending: boolean }): void {
    if (this.busyPlanId() !== null) return;
    // A R$ 0,00 plan has nothing to charge: `/checkout` answers 400 and the
    // user gets a dead button. The free plan is reached via `/downgrade`.
    if (plan.price <= 0) {
      this.ctaError.set({
        planId: plan.id,
        message: 'O plano gratuito não passa por pagamento.',
      });
      return;
    }
    this.busyPlanId.set(plan.id);
    // ORDER IS LOAD-BEARING. The new tab receives a SNAPSHOT of this tab's
    // sessionStorage taken at `window.open` time; later writes never propagate.
    // Writing the plan code after the POST resolved meant the gateway tab got a
    // snapshot WITHOUT it, which silently demoted `/billing/success` to its
    // ±15min heuristic and could congratulate an abandoned checkout.
    this.writeCheckoutMarkers(plan.code);
    // THE tab, reserved right here — still inside the click gesture. Opening it
    // after the POST resolves is what made mobile browsers treat the checkout as
    // an unsolicited pop-up and block it.
    const tab = this.externalNav.openPendingTab();
    // A previous POST for this plan already answered with an `externalId`: a
    // gateway session EXISTS even though we never reached it (empty
    // `redirectUrl`). Retrying as a plain new checkout minted a SECOND Stripe
    // session — and a second chance to be charged. Resume instead.
    const resume = opts?.resumePending === true || this.startedCheckoutCodes.has(plan.code);
    const override = this.isPlatformAdmin && !resume ? this.adminGateway() : undefined;
    this.billingService
      .startCheckout(plan.code, override)
      .pipe(timeout(CHECKOUT_REQUEST_TIMEOUT_MS))
      .subscribe({
        next: (res) => {
          // Record BEFORE the redirect branch: the session exists regardless of
          // whether this response was usable.
          if (res.externalId) this.startedCheckoutCodes.add(plan.code);
          const redirectUrl = res.redirectUrl?.trim() ?? '';
          if (!redirectUrl) {
            // No URL to navigate to: the reserved tab would sit there blank
            // forever. Without this branch the CTA also stayed "Processando…"
            // with no error and no retry.
            tab.close();
            this.failCheckout(
              plan,
              res.externalId
                ? 'Não recebemos o link de pagamento. Tente novamente — a mesma cobrança será retomada, nada é cobrado duas vezes.'
                : 'Não recebemos o link de pagamento. Tente novamente.',
            );
            return;
          }
          if (tab.blocked) {
            // Honest degradation: we cannot open the tab for them, so we hand
            // over a link they can click themselves — that click IS a gesture no
            // blocker refuses. Nothing is marked as "in progress" until they do.
            this.offerManualCheckout(plan, redirectUrl);
            return;
          }
          this.markCheckoutStarted();
          tab.navigate(redirectUrl);
        },
        // Covers the `timeout()` above too: a request that never answers takes
        // the exact same recovery path as an outright failure.
        error: (err: unknown) => {
          tab.close();
          this.failCheckout(plan, 'Não foi possível iniciar o pagamento. Tente novamente.', err);
        },
      });
  }

  /**
   * Tell the gateway tab — and a later reload of THIS tab — which checkout is in
   * flight. Must run BEFORE `openPendingTab()`: the new tab only ever sees the
   * sessionStorage snapshot taken at open time. `/billing/success` reads
   * `CHECKOUT_PLAN_CODE_KEY` to prove the payment landed on the plan that was
   * actually being bought; without it, it can only fall back to weaker evidence.
   */
  private writeCheckoutMarkers(planCode: string): void {
    if (!this.isBrowser) return;
    this.session.setItem(CHECKOUT_PENDING_KEY, 'true');
    this.session.setItem(CHECKOUT_PLAN_CODE_KEY, planCode);
  }

  /**
   * The checkout is now live in ANOTHER tab. This tab keeps the bounded
   * "verificando" window so it converts to the paid plan on its own, and drops
   * the per-card spinner: the button is not what the user is waiting on.
   * The markers are already written — see `writeCheckoutMarkers()`.
   */
  private markCheckoutStarted(): void {
    this.busyPlanId.set(null);
    this.manualCheckout.set(null);
    this.beginAwaitPaymentWindow('checkout-open');
  }

  /** Pop-up blocked: surface a real, clickable link instead of a dead end. */
  private offerManualCheckout(plan: PlanResponse, url: string): void {
    this.busyPlanId.set(null);
    this.awaitingPayment.set(false);
    this.stopAwaitPolling();
    // Nothing is in flight until the user clicks the link: the markers written
    // before the (refused) tab would otherwise make a reload of this page wait
    // for a checkout that was never opened.
    this.clearCheckoutMarkers();
    this.manualCheckout.set({ planCode: plan.code, planName: plan.name, url });
    this.ctaError.set({
      planId: plan.id,
      message:
        'Seu navegador bloqueou a abertura da aba de pagamento. Use o botão acima para abrir o checkout.',
    });
  }

  /**
   * The user clicked the manual link — the gateway is opening in a new tab
   * right now, so this tab enters the same waiting window a normal checkout
   * would. The anchor's own navigation is left untouched.
   */
  protected onManualCheckoutOpened(): void {
    const manual = this.manualCheckout();
    if (!manual) return;
    this.ctaError.set(null);
    // `target="_blank"` on an anchor is implicitly `noopener`, so this tab's
    // sessionStorage is NOT cloned into the gateway tab. The markers are still
    // written for THIS tab (a reload must resume the wait); `/billing/success`
    // falls back to its own evidence and never assumes a payment happened.
    this.writeCheckoutMarkers(manual.planCode);
    this.markCheckoutStarted();
  }

  /**
   * Release every busy flag and surface the failure on the clicked card.
   *
   * ONE surface: the card. `messageFor` resolves the same backend `{message}`
   * the service would have put in the page-level banner, and claims the error so
   * the interceptor safety net stays quiet; `clearError()` then drops the
   * service's copy so the banner does not repeat what the card already says.
   *
   * `err` is absent when the request SUCCEEDED but carried no usable redirect
   * URL — there is nothing to claim in that case.
   */
  private failCheckout(plan: PlanResponse, fallback: string, err?: unknown): void {
    this.busyPlanId.set(null);
    this.awaitingPayment.set(false);
    this.stopAwaitPolling();
    this.clearCheckoutMarkers();
    const message = err === undefined ? fallback : this.apiErrors.messageFor(err, fallback);
    this.ctaError.set({ planId: plan.id, message });
    this.billingService.clearError();
  }

  protected confirmDowngrade(): void {
    const plan = this.downgradeTarget();
    if (!plan) return;
    this.downgradeTarget.set(null);
    this.busyPlanId.set(plan.id);
    this.billingService.downgrade(plan.code).subscribe({
      next: (res) => {
        this.busyPlanId.set(null);
        // The backend ships a ready pt-BR sentence; ours is the fallback.
        this.notifications.success(res.message ?? this.downgradeOutcomeFallback(res.outcome, plan));
        if (res.outcome === 'APPLIED') {
          // The change is already in force: the account is ACTIVE on the free
          // plan and no longer blocked. Re-read both sources so the paywall and
          // the guard let the user through without a reload.
          this.revalidateAfterImmediateChange();
        }
      },
      error: (err: unknown) => {
        this.busyPlanId.set(null);
        // `/downgrade` may still refuse a CANCELED / EXPIRED account. The
        // backend `{message}` wins; the fallback must say what to do next
        // instead of inviting a pointless retry of the same request.
        const fallback = this.isPaidActive()
          ? 'Não foi possível alterar o plano. Tente novamente.'
          : 'Não foi possível voltar ao plano gratuito nesta situação. Escolha um plano ou fale com o suporte.';
        this.ctaError.set({ planId: plan.id, message: this.apiErrors.messageFor(err, fallback) });
        this.billingService.clearError();
      },
    });
  }

  /**
   * Statuses where `/downgrade` takes effect on the spot (backend contract:
   * outcome `APPLIED`, `effectiveAt: null`) instead of being scheduled.
   */
  private isImmediateDowngrade(): boolean {
    const status = this.status();
    return status === 'CANCELED' || status === 'EXPIRED';
  }

  /**
   * Fallback copy per outcome. `APPLIED` must never carry a future date — the
   * backend sends `effectiveAt: null` precisely because it already happened.
   */
  private downgradeOutcomeFallback(outcome: SubscriptionChangeOutcome, plan: PlanResponse): string {
    switch (outcome) {
      case 'APPLIED':
        return `Sua conta já está liberada no plano ${plan.name}.`;
      case 'SCHEDULED':
        return `Mudança para ${plan.name} agendada.`;
      case 'NO_OP':
        return 'Nenhuma alteração necessária.';
      default:
        return 'Plano atualizado.';
    }
  }

  /**
   * After a change that is already in force: the cached access decision and the
   * subscription snapshot are both stale, and the user is very likely sitting
   * on a blocked page. Refresh both, bypassing the revalidate throttle.
   */
  private revalidateAfterImmediateChange(): void {
    this.lastRevalidateAt = 0;
    this.revalidate();
  }

  protected dismissDowngrade(): void {
    this.downgradeTarget.set(null);
  }

  /** Only the FREE plan reaches this dialog — see `planIntent()`. */
  protected readonly downgradeDialogMessage = computed<string>(() => {
    if (!this.downgradeTarget()) return '';
    // Two genuinely different situations, and the paid-period sentence is only
    // true in the first: a PAST_DUE / CANCELED / EXPIRED account has no paid
    // access left to keep, so promising it would be a lie about money.
    if (this.burnsPaidPeriod()) {
      const until = this.formatDate(this.subscription()?.currentPeriodEnd ?? null);
      return `Você continua com o acesso pago até ${until}. A partir dessa data sua conta passa para o plano gratuito. Nenhuma cobrança nova é feita agora.`;
    }
    // CANCELED / EXPIRED: the backend applies the change IMMEDIATELY (outcome
    // `APPLIED`, `effectiveAt: null`). No paid period exists, so no date is
    // promised — and the wording matches what actually happens on confirm.
    if (this.isImmediateDowngrade()) {
      return 'Sua conta é liberada agora no plano gratuito, com os limites desse plano. Nenhuma cobrança nova é feita, e você pode assinar um plano pago quando quiser.';
    }
    return 'Sua conta passa para o plano gratuito, com os limites do plano gratuito. Nenhuma cobrança nova é feita agora, e você pode assinar um plano pago quando quiser.';
  });

  protected readonly downgradeDialogTitle = computed<string>(() =>
    this.downgradeTarget() ? 'Voltar ao plano gratuito' : 'Alterar plano',
  );

  // ---------------------------------------------------------------------------
  // Immediate plan change (Mensal ↔ Anual, or paid → cheaper paid) — always
  // charged on the spot, so explicit, informed consent is required.
  // ---------------------------------------------------------------------------

  /** Whole days left in the period the customer already paid for. */
  private daysLeftInPaidPeriod(): number {
    const end = this.subscription()?.currentPeriodEnd;
    if (!end) return 0;
    const endMs = new Date(end).getTime();
    if (Number.isNaN(endMs)) return 0;
    const diff = Math.ceil((endMs - Date.now()) / 86_400_000);
    return diff > 0 ? diff : 0;
  }

  /**
   * True when an immediate plan change would throw away days the customer has
   * already paid for. The gate for requiring an explicit consent dialog.
   */
  protected burnsPaidPeriod(): boolean {
    return this.isPaidActive() && this.daysLeftInPaidPeriod() > 0;
  }

  /** Which of the immediate changes the dialog is confirming. */
  private readonly periodSwitchIntent = computed<PlanIntent | null>(() => {
    const plan = this.periodSwitchTarget();
    return plan ? this.planIntent(plan) : null;
  });

  /** The confirmation burns money the user already paid for. */
  protected readonly periodSwitchIsLoss = computed<boolean>(() => {
    const intent = this.periodSwitchIntent();
    if (intent === 'PERIOD_DOWNGRADE' || intent === 'PLAN_SWITCH') return true;
    // An UPGRADE only reaches this dialog when there IS a paid period to burn.
    return intent === 'UPGRADE';
  });

  protected readonly periodSwitchDialogTitle = computed<string>(() => {
    const plan = this.periodSwitchTarget();
    if (!plan) return 'Mudar período de cobrança';
    const intent = this.periodSwitchIntent();
    if (intent === 'UPGRADE') return `Fazer upgrade para ${plan.name} agora`;
    if (intent === 'PLAN_SWITCH') return `Mudar para ${plan.name} agora`;
    return this.periodSwitchIsLoss()
      ? 'Você vai perder o restante do ano já pago'
      : `Mudar ${plan.name} para o plano anual`;
  });

  /**
   * Spells out the loss in numbers. Stripe is charged immediately and the old
   * subscription is cancelled with no proration and no refund — if the user
   * confirms, they eat the remainder. Nothing here may be softened.
   */
  protected readonly periodSwitchDialogMessage = computed<string>(() => {
    const plan = this.periodSwitchTarget();
    if (!plan) return '';
    const price = this.formatPrice(plan.price);
    const until = this.formatDate(this.subscription()?.currentPeriodEnd ?? null);
    const days = this.daysLeftInPaidPeriod();

    const intent = this.periodSwitchIntent();
    if (intent === 'PLAN_SWITCH' || intent === 'UPGRADE') {
      // Paid → other paid (cheaper OR pricier) is NOT schedulable: the backend
      // rejects it on `/downgrade`, so the only route is a new charge today —
      // and the old subscription dies on the spot, in both directions.
      const left =
        days > 0
          ? `Você ainda tem ${days} dia(s) pagos, válidos até ${until}, e vai perder todos eles.`
          : `Você perde o que restar do período pago (até ${until}).`;
      return (
        `${price} do plano ${plan.name} são cobrados agora e sua assinatura atual é encerrada na hora. ` +
        `${left} Não há reembolso, crédito nem cálculo proporcional. ` +
        `Se quiser trocar sem perder nada, espere ${until} e mude depois dessa data.`
      );
    }

    if (this.periodSwitchIsLoss()) {
      const left =
        days > 0
          ? `Você ainda tem ${days} dia(s) pagos, válidos até ${until}, e vai perder todos eles.`
          : `Você perde o que restar do período pago (até ${until}).`;
      return (
        `Sua assinatura anual é cancelada na hora e ${price} do plano mensal são cobrados agora. ` +
        `${left} Não há reembolso, crédito nem cálculo proporcional. ` +
        `Se quiser o plano mensal sem perder nada, espere ${until} e mude depois dessa data.`
      );
    }

    return (
      `${price} do plano anual são cobrados agora e sua assinatura mensal é encerrada na hora. ` +
      `Os dias que restam do mês já pago (até ${until}) não viram desconto nem crédito.`
    );
  });

  protected readonly periodSwitchConfirmLabel = computed<string>(() =>
    this.periodSwitchIsLoss() ? 'Sim, perder o restante e mudar' : 'Confirmar e pagar agora',
  );

  protected readonly periodSwitchVariant = computed<'warning' | 'danger'>(() =>
    this.periodSwitchIsLoss() ? 'danger' : 'warning',
  );

  protected confirmPeriodSwitch(): void {
    const plan = this.periodSwitchTarget();
    if (!plan) return;
    this.periodSwitchTarget.set(null);
    this.startCheckout(plan);
  }

  protected dismissPeriodSwitch(): void {
    this.periodSwitchTarget.set(null);
  }

  protected openCancel(): void {
    this.showCancelDialog.set(true);
  }

  protected onCancelConfirmed(): void {
    this.showCancelDialog.set(false);
    this.accountActionError.set(null);
    this.accountActionBusy.set(true);
    this.billingService.cancel().subscribe({
      next: () => {
        // `/cancel` also drops the pending checkout server-side, so the local
        // "voltando do gateway" marker would otherwise strand the page in
        // "verificando pagamento" for a charge that no longer exists.
        this.settlePendingPayment();
        this.billingService.loadSubscription().subscribe({
          next: () => this.accountActionBusy.set(false),
          error: () => this.accountActionBusy.set(false),
        });
        this.notifications.success('Cancelamento agendado para o fim do período atual.');
      },
      error: (err: unknown) => {
        this.accountActionBusy.set(false);
        this.accountActionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível cancelar a assinatura. Tente novamente.'),
        );
        this.billingService.clearError();
      },
    });
  }

  protected onCancelDismissed(): void {
    this.showCancelDialog.set(false);
  }

  /**
   * Undo a scheduled cancellation. A 400 means the paid period already ran
   * out — the only way back is a new payment, so we send the user there.
   */
  protected reactivate(): void {
    if (this.accountActionBusy()) return;
    this.accountActionError.set(null);
    this.accountActionBusy.set(true);
    this.billingService.reactivate().subscribe({
      next: (res) => {
        this.accountActionBusy.set(false);
        this.notifications.success(res.message ?? 'Assinatura reativada.');
      },
      error: (err: unknown) => {
        this.accountActionBusy.set(false);
        this.accountActionError.set(
          this.apiErrors.messageFor(
            err,
            'Não foi possível reativar. Escolha um plano para retomar o acesso.',
          ),
        );
        this.billingService.clearError();
        this.scrollToPlans();
      },
    });
  }

  /** Send the user to the plans section (used when reactivate is impossible). */
  private scrollToPlans(): void {
    if (!this.isBrowser) return;
    this.document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected dismissBlockedMessage(): void {
    this.blockedReason.set(null);
  }
}

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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { timeout } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { BottomSheet } from '../../components/core/bottom-sheet/bottom-sheet';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { PLAN_CAPACITY, PlanTier } from '../../utils/plan-limits';
import { PLAN_TIER_ORDER, planTierOf } from '../../utils/plan-features';
import { PLAN_COPY, planRows } from '../../utils/plan-grid-copy';
import {
  formatDayMonth,
  formatDayMonthTime,
  formatFullDate,
  parseServerTime,
  remainingLabel,
} from '../../utils/server-time';
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
  BillingInvoice,
  BillingState,
  BillingSummary,
  PlanGateway,
  PlanPeriod,
  PlanResponse,
  SubscriptionChangeOutcome,
  SubscriptionStatus,
} from '../../types/billing.types';
import { environment } from '../../../environments/environment';
import { PlanColumn, PlanGrid } from './plan-grid';

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

/** A página do cliente sempre vende pelo gateway de produção. */
const ACTIVE_GATEWAY: PlanGateway = 'stripe';

/** Folhas da página: uma de cada vez. */
type BillingSheet = 'pay' | 'plans' | 'cancel' | 'paid' | 'invoices';

/** Depois de abrir a fatura do Stripe, relê o resumo nesta cadência… */
const INVOICE_POLL_MS = 4000;
/** …por no máximo este tempo (3-D Secure e app do banco levam minutos). */
const INVOICE_WATCH_MS = 15 * 60 * 1000;


/** "Starter", "Pro"… a partir do `plans.name` da API. */
export function displayPlanName(name: string | null): string {
  const tier = planTierOf(name);
  if (tier) return PLAN_COPY[tier].name;
  if (!name) return '';
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function brandName(brand: string | null | undefined): string {
  switch ((brand ?? '').toLowerCase()) {
    case 'visa':
      return 'Visa';
    case 'mastercard':
      return 'Mastercard';
    case 'amex':
      return 'Amex';
    case 'elo':
      return 'Elo';
    case 'hipercard':
      return 'Hipercard';
    case '':
      return 'Cartão';
    default:
      return brand!.charAt(0).toUpperCase() + brand!.slice(1);
  }
}

function brandShort(brand: string | null | undefined): string {
  switch ((brand ?? '').toLowerCase()) {
    case 'mastercard':
      return 'MC';
    case 'amex':
      return 'AMEX';
    case '':
      return '••';
    default:
      return (brand ?? '').slice(0, 4).toUpperCase();
  }
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 79,90" a partir de centavos. */
function formatCents(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, ' ');
}

/** "79,90", "299", "1.599" — sem o "R$" (a grade o desenha menor). */
function formatPlanPrice(value: number, forceCents = false): string {
  const whole = Math.abs(value - Math.round(value)) < 0.005;
  const out = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: whole && !forceCents ? 0 : 2,
    maximumFractionDigits: whole && !forceCents ? 0 : 2,
  }).format(value);
  return forceCents ? `R$ ${out}` : out;
}


@Component({
  selector: 'app-billing',
  imports: [CommonModule, RouterLink, DefaultPageLayout, ConfirmDialog, BottomSheet, AlertBanner, PlanGrid],
  templateUrl: './billing.html',
  styleUrls: ['./billing-kit.css', './billing.css'],
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
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));


  protected readonly plans = this.billingService.plans;
  protected readonly subscription = this.billingService.subscription;
  protected readonly loading = this.billingService.loading;
  protected readonly error = this.billingService.error;

  protected readonly cycle = signal<BillingCycle>('MONTHLY');

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

  protected readonly accountActionBusy = signal(false);

  protected readonly showCancelDialog = signal(false);
  protected readonly downgradeTarget = signal<PlanResponse | null>(null);
  /** Mensal↔Anual target awaiting an explicit, informed confirmation. */
  protected readonly periodSwitchTarget = signal<PlanResponse | null>(null);

  private visibilityListener: (() => void) | null = null;
  private focusListener: (() => void) | null = null;
  private lastRevalidateAt = 0;
  /** Poll handle + hard deadline for the post-gateway "verificando" window. */
  private awaitPollHandle: ReturnType<typeof setInterval> | null = null;
  private awaitDeadline = 0;
  /** Which waiting window is running — they have very different bounds. */
  private awaitMode: AwaitMode = 'returned';

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
   * vehicle (PRO allows 25 after V59; 15 is STARTER) into a reported bug. Plan comes from the plan;
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

  protected readonly scheduledDowngradeCode = computed<string | null>(
    () => this.subscription()?.scheduledDowngradePlanCode ?? null,
  );

  protected readonly scheduledDowngradeAt = computed<string | null>(
    () => this.subscription()?.scheduledDowngradeAt ?? null,
  );

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

  // ---------------------------------------------------------------------------
  // Plan rows
  // ---------------------------------------------------------------------------

  /** Best yearly savings across all plan groups (for the cycle-toggle badge). */
  protected readonly yearlySavingsBadge = computed<number>(() => {
    const gw = ACTIVE_GATEWAY;
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
   * The exact row backing the subscription in force. `null` while the
   * subscription is not ACTIVE.
   */
  protected currentPlan = computed<PlanResponse | null>(() => {
    const code = this.currentPlanCode();
    if (!code) return null;
    return this.plans().find((p) => p.code === code) ?? null;
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {

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
    this.refreshSummary();

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
    this.stopInvoiceWatch();
    this.stopClock();
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
    this.refreshSummary();
    this.now.set(new Date());
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

  /** Monthly-equivalent price for a plan row. Yearly rows return price/12. */
  protected monthlyEquivalent(plan: PlanResponse): number {
    return plan.period === 'MONTHLY' ? plan.price : plan.price / 12;
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

  // ---------------------------------------------------------------------------
  // Plan card presentation
  // ---------------------------------------------------------------------------

  /** True only when the plan is paid, active and in force. */
  protected isCurrent(plan: PlanResponse): boolean {
    return this.currentPlanCode() === plan.code;
  }

  protected isPending(plan: PlanResponse): boolean {
    return this.pendingPlanCode() === plan.code;
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
        return true;
      // EXPIRED é o teste VENCIDO (o backend só grava EXPIRED ao encerrar o
      // trial, V124). O backend responde no-op ao /downgrade dele, como faz com
      // TRIALING: o plano gratuito É o plano de teste, e "voltar" a ele
      // desbloquearia o teste vencido para sempre. Oferecer o botão seria
      // prometer o que o servidor recusa.
      case 'EXPIRED':
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
   * Paid transitions only. Downgrades must never reach this method, and a
   * period switch only reaches it after `confirmPeriodSwitch()`.
   *
   * `resumePending` means "the user is finishing a checkout already started":
   * we deliberately drop the admin gateway override so the request is byte-for-
   * byte the one that created the pending session, letting the backend hand
   * back the SAME session instead of opening a second charge.
   */
  private startCheckout(plan: PlanResponse, opts?: { resumePending: boolean }): void {
    // `resumePending` documenta a intenção no chamador; o backend retoma a
    // sessão aberta do mesmo plano sozinho (`reusePendingCheckout`).
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
    // Sem override de gateway: a ferramenta de admin saiu da página do cliente
    // (decisão D6). Um checkout repetido do mesmo plano é retomado pelo backend
    // (`reusePendingCheckout`), nunca vira uma segunda sessão.
    void opts;
    this.billingService
      .startCheckout(plan.code)
      .pipe(timeout(CHECKOUT_REQUEST_TIMEOUT_MS))
      .subscribe({
        next: (res) => {
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
    this.sheet.set('cancel');
  }

  protected onCancelConfirmed(): void {
    this.showCancelDialog.set(false);
    this.sheet.set(null);
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
        this.refreshSummary();
        this.notifications.success('Cancelamento agendado para o fim do período atual.');
      },
      error: (err: unknown) => {
        this.accountActionBusy.set(false);
        this.accountActionError.set(
          this.apiErrors.messageFor(
            err,
            'Não foi possível cancelar a assinatura. Tente novamente.',
          ),
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
        this.refreshSummary();
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
        this.sheet.set('plans');
      },
    });
  }

  // ===========================================================================
  // Redesign (2026-10-29): resumo, cartão de status, grupos, folhas.
  // A lógica de checkout/troca de plano acima continua sendo a única porta de
  // compra — a grade nova só a chama por `onPlanCta`.
  // ===========================================================================

  private readonly manualCheckoutLink =
    viewChild<ElementRef<HTMLAnchorElement>>('manualCheckoutLink');

  /** Pop-up bloqueado: foco no único link que destrava o checkout. */
  private readonly focusManualCheckoutLink = effect(() => {
    this.manualCheckoutLink()?.nativeElement.focus();
  });

  protected readonly summary = this.billingService.summary;
  protected readonly summaryLoaded = signal(false);
  protected readonly sheet = signal<BillingSheet | null>(null);
  protected readonly payOption = signal<'invoice' | 'card'>('invoice');
  protected readonly cardBusy = signal(false);
  protected readonly sheetError = signal<string | null>(null);
  /** Comprovante da folha "Pagamento confirmado". */
  protected readonly paidReceipt = signal<{
    amount: string;
    method: string;
    at: string;
    planName: string;
    until: string;
    receiptUrl: string | null;
  } | null>(null);
  /** Relógio da contagem regressiva — um tique por minuto basta. */
  protected readonly now = signal(new Date());
  private clockHandle: ReturnType<typeof setInterval> | null = null;
  private invoicePollHandle: ReturnType<typeof setInterval> | null = null;
  private invoiceWatchUntil = 0;
  private wasOwing = false;
  private lastOwingAmountCents: number | null = null;
  private queryIntentHandled = false;

  protected readonly supportUrl = environment.supportWhatsapp
    ? `https://wa.me/${environment.supportWhatsapp}?text=${encodeURIComponent('Olá! Quero falar sobre o plano Enterprise do MyCarsHub.')}`
    : null;

  /** Estado da tela: o do resumo; sem ele, derivado de `/subscription`. */
  protected readonly state = computed<BillingState>(() => {
    const fromSummary = this.summary()?.state;
    if (fromSummary) return fromSummary;
    switch (this.status()) {
      case 'ACTIVE':
        return 'ACTIVE';
      case 'TRIALING':
        return 'TRIALING';
      case 'PAST_DUE':
      case 'UNPAID':
        return 'PAST_DUE';
      case 'CANCELED':
        return 'CANCELED';
      case 'EXPIRED':
        return 'TRIAL_EXPIRED';
      default:
        return 'NONE';
    }
  });

  protected readonly owing = computed(() => this.state() === 'PAST_DUE' || this.state() === 'BLOCKED');

  /** Teste, teste encerrado e sem assinatura: escolher um plano é o trabalho da tela. */
  protected readonly showsInlinePicker = computed(() => {
    const s = this.state();
    return s === 'TRIALING' || s === 'TRIAL_EXPIRED' || s === 'CANCELED' || s === 'NONE';
  });

  protected readonly canManage = computed(() => this.summary()?.canManage ?? true);

  protected readonly planName = computed(() =>
    displayPlanName(this.summary()?.plan?.name ?? this.subscription()?.planName ?? null),
  );

  protected readonly heroTone = computed(() => {
    switch (this.state()) {
      case 'PAST_DUE':
        return 'st-due';
      case 'BLOCKED':
        return 'st-block';
      case 'ACTIVE':
      case 'TRIALING':
        return 'st-ok';
      default:
        return 'st-idle';
    }
  });

  protected readonly heroChip = computed<{ cls: string; label: string }>(() => {
    const sum = this.summary();
    switch (this.state()) {
      case 'ACTIVE':
        if (sum?.cancelAtPeriodEnd || this.subscription()?.cancelAtPeriodEnd) {
          return { cls: 'warn', label: `Termina em ${formatDayMonth(this.periodEnd())}` };
        }
        return { cls: 'ok', label: 'Em dia' };
      case 'TRIALING': {
        const d = this.trialDaysLeft();
        return { cls: 'brand', label: d === 1 ? '1 dia restante' : `${d} dias restantes` };
      }
      case 'PAST_DUE':
        return { cls: 'warn', label: 'Pagamento recusado' };
      case 'BLOCKED':
        return { cls: 'danger', label: 'Acesso pausado' };
      case 'TRIAL_EXPIRED':
        return { cls: 'neutral', label: 'Teste encerrado' };
      case 'CANCELED':
        return { cls: 'neutral', label: 'Assinatura encerrada' };
      default:
        return { cls: 'neutral', label: 'Sem plano' };
    }
  });

  /** Valor grande do cartão: o devido quando há atraso, senão o preço do plano. */
  protected readonly heroAmount = computed<{ reais: string; cents: string } | null>(() => {
    const sum = this.summary();
    let cents: number | null = null;
    if (this.owing() && sum?.amountDueCents != null) cents = sum.amountDueCents;
    else {
      const price = sum?.plan?.price ?? this.currentPlan()?.price ?? null;
      if (price != null && price > 0) cents = Math.round(price * 100);
    }
    if (cents == null) return null;
    const reais = Math.floor(cents / 100);
    return {
      reais: new Intl.NumberFormat('pt-BR').format(reais),
      cents: String(cents % 100).padStart(2, '0'),
    };
  });

  protected readonly heroPer = computed(() => {
    if (this.owing()) return 'em aberto';
    const period = this.summary()?.plan?.period ?? this.currentPlan()?.period;
    return period === 'YEARLY' ? '/ano' : '/mês';
  });

  protected readonly periodEnd = computed(() =>
    parseServerTime(this.summary()?.currentPeriodEnd ?? this.subscription()?.currentPeriodEnd ?? null),
  );
  protected readonly periodEndLabel = computed(() => formatFullDate(this.periodEnd()));

  protected readonly card = computed(() => {
    const pm = this.summary()?.paymentMethod;
    if (!pm || !pm.last4) return null;
    const brand = brandName(pm.brand);
    return {
      label: `${brand} final ${pm.last4}`,
      short: brandShort(pm.brand),
      expiry:
        pm.expMonth && pm.expYear
          ? `Validade ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}`
          : null,
    };
  });

  protected readonly failureAt = computed(() =>
    formatDayMonth(parseServerTime(this.summary()?.lastFailure?.at ?? this.summary()?.pastDueSince ?? null)),
  );

  protected readonly failureLine = computed(() => {
    const failure = this.summary()?.lastFailure;
    const message = (failure?.message ?? 'O banco recusou a cobrança').trim();
    const reason = message.charAt(0).toLowerCase() + message.slice(1);
    const who = this.card()?.label ?? 'Cartão';
    return `${who} recusado em ${this.failureAt()}: ${reason}.`;
  });

  protected readonly graceEnd = computed(() => parseServerTime(this.summary()?.graceEndsAt ?? null));
  protected readonly deadlineLabel = computed(() => remainingLabel(this.graceEnd(), this.now()));
  protected readonly deadlineAt = computed(() => formatDayMonthTime(this.graceEnd()));
  /** Barra que esvazia: tempo que resta da carência. */
  protected readonly deadlinePct = computed(() => {
    const end = this.graceEnd();
    const start = parseServerTime(this.summary()?.pastDueSince ?? null);
    if (!end || !start) return 0;
    const total = end.getTime() - start.getTime();
    const left = end.getTime() - this.now().getTime();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, (left / total) * 100));
  });

  protected readonly usage = computed(() => {
    const sum = this.summary();
    if (!sum) return null;
    const limit = sum.usage.vehicleLimit ?? sum.plan?.vehicleLimit ?? null;
    if (limit == null) return null;
    return {
      vehicles: sum.usage.vehicles,
      limit,
      pct: Math.max(0, Math.min(100, limit > 0 ? (sum.usage.vehicles / limit) * 100 : 0)),
    };
  });

  protected readonly trialEnd = computed(() =>
    parseServerTime(this.summary()?.trialEndsAt ?? this.subscription()?.trialEndsAt ?? null),
  );
  protected readonly trialDaysLeft = computed(() => {
    const end = this.trialEnd();
    if (!end) return 0;
    return Math.max(0, Math.ceil((end.getTime() - this.now().getTime()) / 86_400_000));
  });
  protected readonly trialPct = computed(() => {
    const total = this.trialTotalDays();
    return Math.max(0, Math.min(100, (this.trialDaysLeft() / total) * 100));
  });
  protected readonly trialEndLabel = computed(() => formatFullDate(this.trialEnd()));
  private readonly trialTotalDays = computed(
    () => this.plans().find((p) => p.price <= 0 && p.trialDays > 0)?.trialDays ?? 14,
  );
  protected readonly trialVehicleLimit = computed(
    () => this.summary()?.usage.vehicleLimit ?? PLAN_CAPACITY.TRIAL.vehicles,
  );

  protected readonly cycleLabel = computed(() => {
    const period = this.summary()?.plan?.period ?? this.currentPlan()?.period ?? 'MONTHLY';
    const end = this.periodEnd();
    if (period === 'YEARLY') return end ? `Anual, ${formatDayMonth(end)}` : 'Anual';
    return end ? `Mensal, dia ${formatDayMonth(end).slice(0, 2)}` : 'Mensal';
  });

  protected readonly invoices = computed(() => this.summary()?.invoices ?? []);
  protected readonly recentInvoices = computed(() => this.invoices().slice(0, 3));

  protected readonly payTitle = computed(() => {
    const cents = this.summary()?.amountDueCents;
    return cents != null ? `Pagar ${formatCents(cents)}` : 'Pagar agora';
  });
  protected readonly paySubtitle = computed(() => {
    const created = parseServerTime(this.summary()?.openInvoice?.createdAt ?? null);
    const plan = `Plano ${this.planName()}`;
    return created ? `${plan} · fatura de ${formatFullDate(created)}` : plan;
  });
  protected readonly canPayInvoice = computed(
    () => !!this.summary()?.openInvoice?.payUrl && this.has('PAY_NOW'),
  );

  protected has(action: string): boolean {
    return (this.summary()?.actions ?? []).includes(action as never);
  }

  protected invoiceDate(inv: BillingInvoice): string {
    return formatFullDate(parseServerTime(inv.createdAt));
  }

  protected invoiceAmount(inv: BillingInvoice): string {
    return formatCents(inv.amountCents);
  }

  protected invoiceStatus(inv: BillingInvoice): string {
    switch (inv.status) {
      case 'PAID':
        return inv.cardLast4 ? `Paga · ${brandName(inv.cardBrand)} final ${inv.cardLast4}` : 'Paga';
      case 'OPEN':
        return 'Em aberto';
      case 'VOID':
        return 'Cancelada';
      case 'UNCOLLECTIBLE':
        return 'Não paga';
      default:
        return inv.status;
    }
  }

  protected openInvoice(inv: BillingInvoice): void {
    const url = inv.hostedUrl ?? inv.pdfUrl;
    if (url) this.externalNav.openExternal(url);
  }

  // ------------------------------------------------------------- plan grid

  protected readonly planColumns = computed<PlanColumn[]>(() => {
    const cycle = this.cycle();
    const currentTier = this.isPlanInForce()
      ? planTierOf(this.currentPlan()?.name ?? this.subscription()?.planName ?? null)
      : null;
    const currentPeriod = this.currentPlan()?.period ?? this.subscription()?.billingCycle ?? null;
    return PLAN_TIER_ORDER.map((tier) => {
      const copy = PLAN_COPY[tier];
      const row = this.rowFor(tier, tier === 'TRIAL' ? 'MONTHLY' : cycle);
      const contact = tier === 'ENTERPRISE' || row?.contactOnly === true;
      const isCurrent =
        currentTier === tier && (tier === 'TRIAL' || currentPeriod === null || currentPeriod === cycle);
      const yearly = cycle === 'YEARLY' && tier !== 'TRIAL' && !contact;
      const price = row?.price ?? null;
      const err = row ? this.planCardError(row) : null;
      const cta = this.columnCta(tier, row, contact, currentTier);
      return {
        tier,
        name: copy.name,
        pitch: copy.pitch,
        price: contact ? 'Sob consulta' : tier === 'TRIAL' || !price ? 'Grátis' : formatPlanPrice(price),
        per: contact || tier === 'TRIAL' || !price ? null : yearly ? '/ano' : '/mês',
        sub: contact
          ? 'Preço conforme a frota'
          : tier === 'TRIAL'
            ? `${row?.trialDays || 14} dias, sem cartão`
            : yearly && price
              ? `${formatPlanPrice(price / 12, true)} por mês`
              : 'Cobrado todo mês',
        rows: planRows(tier),
        current: isCurrent,
        recommended: tier === 'PRO',
        ctaLabel: cta.label,
        ctaDisabled: cta.disabled,
        ctaAria: cta.aria ?? `${cta.label} — plano ${copy.name}`,
        // A grade fica limpa (mockups 09/12): o custo de uma troca aparece no
        // diálogo de confirmação. Só a retomada de um pagamento já iniciado
        // ganha nota aqui, porque o rótulo sozinho não diz que não cobra duas vezes.
        note:
          row && !contact && this.planIntent(row) === 'PENDING_PAYMENT' ? this.planCtaNote(row) : null,
        error: err,
        plan: contact ? null : row,
        contact,
      };
    });
  });

  private rowFor(tier: PlanTier, period: PlanPeriod): PlanResponse | null {
    return (
      this.plans().find(
        (p) => p.gateway === ACTIVE_GATEWAY && p.period === period && planTierOf(p.name) === tier,
      ) ?? null
    );
  }

  private columnCta(
    tier: PlanTier,
    row: PlanResponse | null,
    contact: boolean,
    currentTier: PlanTier | null,
  ): { label: string; disabled: boolean; aria?: string } {
    if (contact) return { label: 'Falar com a gente', disabled: false };
    if (!row) return { label: 'Em breve', disabled: true, aria: `Plano ${PLAN_COPY[tier].name} em breve` };
    if (this.busyPlanId() === row.id) return { label: 'Processando…', disabled: true };
    const intent = this.planIntent(row);
    const name = PLAN_COPY[tier].name;
    switch (intent) {
      case 'CURRENT':
        return currentTier === tier
          ? { label: 'Plano atual', disabled: true, aria: `Plano ${name} é o seu plano atual` }
          : { label: 'Já utilizado', disabled: true, aria: `Teste grátis já utilizado` };
      case 'SCHEDULED':
        return { label: 'Mudança agendada', disabled: true };
      case 'PENDING_PAYMENT':
        return { label: 'Concluir pagamento', disabled: this.planCtaDisabled(row) };
      case 'DOWNGRADE':
        // Assinatura paga em dia: o caminho de saída é "Cancelar assinatura"
        // (Conta); a coluna do teste só diz que ele já foi usado (mockups 09/12).
        // Conta encerrada/atrasada mantém a volta ao gratuito como saída.
        return this.isPaidActive()
          ? { label: 'Já utilizado', disabled: true, aria: 'Teste grátis já utilizado' }
          : { label: 'Voltar ao gratuito', disabled: this.planCtaDisabled(row) };
      default:
        break;
    }
    if (row.purchasable === false) {
      return { label: 'Em breve', disabled: true, aria: `Plano ${name} em breve` };
    }
    const disabled = this.planCtaDisabled(row);
    switch (intent) {
      case 'UPGRADE':
        return { label: currentTier === 'TRIAL' || !currentTier ? `Assinar ${name}` : `Subir para ${name}`, disabled };
      case 'PLAN_SWITCH':
        return { label: `Mudar para ${name}`, disabled };
      case 'PERIOD_UPGRADE':
        return { label: `${name} anual`, disabled };
      case 'PERIOD_DOWNGRADE':
        return { label: `${name} mensal`, disabled };
      default:
        return { label: `Assinar ${name}`, disabled };
    }
  }

  protected onColumn(col: PlanColumn): void {
    if (col.contact) {
      this.openSupport();
      return;
    }
    if (!col.plan) return;
    this.onPlanCta(col.plan);
    // As confirmações (troca de período, voltar ao gratuito) são diálogos que
    // ficam ABAIXO da folha: fecha a folha para o diálogo ficar à vista.
    if (this.periodSwitchTarget() || this.downgradeTarget()) this.sheet.set(null);
  }

  protected openSupport(): void {
    if (this.supportUrl) this.externalNav.openExternal(this.supportUrl);
    else void this.router.navigate(['/suporte']);
  }

  // ------------------------------------------------------------- sheets

  protected openPlans(): void {
    this.sheet.set('plans');
  }

  protected openPay(): void {
    this.sheetError.set(null);
    this.payOption.set(this.canPayInvoice() ? 'invoice' : 'card');
    this.sheet.set('pay');
  }

  protected closeSheet(): void {
    this.sheet.set(null);
    this.sheetError.set(null);
  }

  protected confirmPay(): void {
    if (this.payOption() === 'card') {
      this.openCardUpdate();
      return;
    }
    const url = this.summary()?.openInvoice?.payUrl;
    if (!url) return;
    this.externalNav.openExternal(url);
    this.sheet.set(null);
    this.watchInvoicePayment();
  }

  /** "Trocar cartão": Billing Portal do Stripe nesta aba; ele devolve para cá. */
  protected openCardUpdate(): void {
    if (this.cardBusy()) return;
    this.cardBusy.set(true);
    this.sheetError.set(null);
    this.billingService.cardUpdateUrl().subscribe({
      next: (url) => {
        this.cardBusy.set(false);
        if (this.isBrowser && url) this.document.location.assign(url);
      },
      error: (err: unknown) => {
        this.cardBusy.set(false);
        const message = this.apiErrors.messageFor(err, 'Não foi possível abrir a troca de cartão. Tente novamente.');
        if (this.sheet()) this.sheetError.set(message);
        else this.accountActionError.set(message);
      },
    });
  }

  protected viewAllInvoices(): void {
    this.sheet.set('invoices');
  }

  protected closePaid(): void {
    this.sheet.set(null);
    this.paidReceipt.set(null);
  }

  protected openPaidReceipt(): void {
    const url = this.paidReceipt()?.receiptUrl;
    if (url) this.externalNav.openExternal(url);
  }

  // ------------------------------------------------------------- summary

  private refreshSummary(): void {
    if (typeof this.billingService.loadSummary !== 'function') return;
    this.billingService.loadSummary().subscribe({
      next: (sum) => this.onSummary(sum),
      error: (err: unknown) => {
        this.summaryLoaded.set(true);
        this.apiErrors.claim(err);
        this.logger.warn('[billing] loadSummary failed', { error: err });
      },
    });
  }

  private onSummary(sum: BillingSummary | null): void {
    this.summaryLoaded.set(true);
    if (!sum) return;
    const owingNow = sum.state === 'PAST_DUE' || sum.state === 'BLOCKED';
    if (this.wasOwing && sum.state === 'ACTIVE') this.showPaid(sum);
    this.wasOwing = owingNow;
    // A contagem regressiva só existe com fatura em aberto.
    if (owingNow) this.startClock();
    else this.stopClock();
    this.now.set(new Date());
    if (owingNow) this.lastOwingAmountCents = sum.amountDueCents;
    this.handleQueryIntent(sum);
  }

  /** O atraso virou ACTIVE com a página aberta: confirma o pagamento. */
  private showPaid(sum: BillingSummary): void {
    this.stopInvoiceWatch();
    this.access.invalidate();
    this.access.load().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
    const paid = sum.invoices.find((i) => i.status === 'PAID') ?? null;
    const cents = paid?.amountCents ?? this.lastOwingAmountCents;
    this.paidReceipt.set({
      amount: cents != null ? formatCents(cents) : '—',
      method: paid?.cardLast4 ? `${brandName(paid.cardBrand)} final ${paid.cardLast4}` : 'Cartão',
      at: formatDayMonthTime(new Date()),
      planName: displayPlanName(sum.plan?.name ?? null),
      until: formatFullDate(parseServerTime(sum.currentPeriodEnd)),
      receiptUrl: paid?.hostedUrl ?? paid?.pdfUrl ?? null,
    });
    this.sheet.set('paid');
  }

  /** Links dos e-mails: `?pagar=1` abre o pagamento, `?cartao=1` a troca de cartão. */
  private handleQueryIntent(sum: BillingSummary): void {
    if (this.queryIntentHandled) return;
    this.queryIntentHandled = true;
    const params = this.route.snapshot.queryParamMap;
    const owingNow = sum.state === 'PAST_DUE' || sum.state === 'BLOCKED';
    if (params.get('pagar') === '1' && owingNow && sum.canManage) {
      this.openPay();
    } else if (params.get('cartao') === '1' && sum.canManage && sum.actions.includes('UPDATE_CARD')) {
      this.openCardUpdate();
    } else if (params.get('cartao') === 'atualizado' && sum.canManage) {
      this.syncCardAfterPortal(owingNow);
    }
  }

  /**
   * Volta do Billing Portal. O portal grava o cartão só no cliente; aqui a
   * ASSINATURA passa a cobrar o cartão novo. Fatura em aberto continua pelo
   * "Pagar agora" (página da Stripe) — nada é cobrado nesta chamada.
   */
  private syncCardAfterPortal(owingNow: boolean): void {
    this.billingService.syncCardAfterUpdate().subscribe({
      next: () => {
        this.notifications.success(
          owingNow
            ? 'Cartão atualizado. Pague a fatura em aberto para liberar o acesso na hora.'
            : 'Cartão atualizado. As próximas cobranças usam o cartão novo.',
        );
        this.refreshSummary();
      },
      error: (err: unknown) => {
        this.accountActionError.set(
          this.apiErrors.messageFor(
            err,
            'O cartão foi salvo, mas não conseguimos ativá-lo na assinatura. Tente de novo em instantes.',
          ),
        );
      },
    });
  }

  /** Depois de abrir a fatura do Stripe: relê o resumo até o pagamento chegar. */
  private watchInvoicePayment(): void {
    this.stopInvoiceWatch();
    this.invoiceWatchUntil = Date.now() + INVOICE_WATCH_MS;
    this.invoicePollHandle = setInterval(() => {
      if (Date.now() >= this.invoiceWatchUntil) {
        this.stopInvoiceWatch();
        return;
      }
      this.refreshSummary();
    }, INVOICE_POLL_MS);
  }

  private stopInvoiceWatch(): void {
    if (this.invoicePollHandle) {
      clearInterval(this.invoicePollHandle);
      this.invoicePollHandle = null;
    }
  }

  private startClock(): void {
    if (!this.isBrowser || this.clockHandle) return;
    this.clockHandle = setInterval(() => this.now.set(new Date()), 60_000);
  }

  private stopClock(): void {
    if (this.clockHandle) {
      clearInterval(this.clockHandle);
      this.clockHandle = null;
    }
  }

}

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Billing } from './billing';
import { BillingService } from '../../services/billing.service';
import { BillingAccessService } from '../../services/billing-access.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import { BillingSummary, PlanResponse, SubscriptionResponse } from '../../types/billing.types';

const plan = (over: Partial<PlanResponse>): PlanResponse => ({
  id: 'id-free',
  code: 'FREE_MONTHLY_STRIPE',
  name: 'TRIAL',
  period: 'MONTHLY',
  price: 0,
  vehicleLimit: 2,
  trialDays: 7,
  productExternalId: null,
  gateway: 'stripe',
  ...over,
});

const FREE = plan({});
const PRO = plan({ id: 'id-pro', code: 'PRO_MONTHLY_STRIPE', name: 'PRO', price: 199 });
const BUSINESS = plan({
  id: 'id-biz',
  code: 'BUSINESS_MONTHLY_STRIPE',
  name: 'BUSINESS',
  price: 499,
  vehicleLimit: null,
  trialDays: 0,
});

const PRO_YEARLY = plan({
  id: 'id-pro-y',
  code: 'PRO_YEARLY_STRIPE',
  name: 'PRO',
  period: 'YEARLY',
  price: 1990,
});
const BUSINESS_YEARLY = plan({
  id: 'id-biz-y',
  code: 'BUSINESS_YEARLY_STRIPE',
  name: 'BUSINESS',
  period: 'YEARLY',
  price: 4990,
  vehicleLimit: null,
  trialDays: 0,
});

/** Paid, but cheaper than PRO — the paid→paid case the backend 400s on. */
const BASIC = plan({
  id: 'id-basic',
  code: 'BASIC_MONTHLY_STRIPE',
  name: 'BASIC',
  price: 99,
  trialDays: 0,
});

const PLANS = [FREE, BASIC, PRO, BUSINESS, PRO_YEARLY, BUSINESS_YEARLY];

/** Date-independent period bounds — the suite must not rot with the calendar. */
const FUTURE = new Date(Date.now() + 40 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 2 * 86_400_000).toISOString();
/** A YEARLY commitment still deep inside the year already paid for. */
const FAR_FUTURE = new Date(Date.now() + 330 * 86_400_000).toISOString();

const sub = (over: Partial<SubscriptionResponse>): SubscriptionResponse => ({
  id: 'sub-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
  status: 'ACTIVE',
  billingCycle: 'MONTHLY',
  trialEndsAt: null,
  currentPeriodStart: PAST,
  currentPeriodEnd: FUTURE,
  cancelAtPeriodEnd: false,
  externalId: null,
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
  ...over,
});

/** Exposes the component's protected surface to the spec without widening it. */
type Probe = {
  planIntent(p: PlanResponse): string;
  planCtaLabel(p: PlanResponse): string;
  planCtaDisabled(p: PlanResponse): boolean;
  isCurrent(p: PlanResponse): boolean;
  isPending(p: PlanResponse): boolean;
  onPlanCta(p: PlanResponse): void;
  confirmDowngrade(): void;
  reactivate(): void;
  revalidate(): void;
  canReactivate(): boolean;
  canCancel(): boolean;
  downgradeTarget(): PlanResponse | null;
  planCardError(p: PlanResponse): string | null;
  manualCheckout(): { planCode: string; planName: string; url: string } | null;
  onManualCheckoutOpened(): void;
  awaitingPayment(): boolean;
  planCtaNote(p: PlanResponse): string | null;
  periodSwitchTarget(): PlanResponse | null;
  periodSwitchDialogTitle(): string;
  periodSwitchDialogMessage(): string;
  periodSwitchConfirmLabel(): string;
  periodSwitchVariant(): string;
  confirmPeriodSwitch(): void;
  dismissPeriodSwitch(): void;
  isFreeActive(): boolean;
  onCancelConfirmed(): void;
  downgradeDialogTitle(): string;
  downgradeDialogMessage(): string;
  ngOnInit(): void;
  error(): string | null;
  accountActionError(): string | null;
  sheet(): string | null;
  state(): string;
  planColumns(): {
    tier: string;
    ctaLabel: string;
    ctaDisabled: boolean;
    current: boolean;
    contact: boolean;
    price: string;
  }[];
  failureLine(): string;
  deadlineLabel(): string;
  canPayInvoice(): boolean;
  openPay(): void;
  confirmPay(): void;
  payOption: { set(v: 'invoice' | 'card'): void };
  openCardUpdate(): void;
  paidReceipt(): { amount: string; planName: string } | null;
};

/** Servidor manda LocalDateTime em UTC sem zona. */
const serverTime = (msFromNow: number): string =>
  new Date(Date.now() + msFromNow).toISOString().slice(0, 19);

const STARTER_M = plan({
  id: 'id-st',
  code: 'STARTER_MONTHLY_STRIPE',
  name: 'STARTER',
  price: 79.9,
  trialDays: 0,
  vehicleLimit: 15,
  purchasable: true,
});
const PRO_M = plan({
  id: 'id-pro2',
  code: 'PRO_MONTHLY_STRIPE',
  name: 'PRO',
  price: 159.9,
  trialDays: 0,
  vehicleLimit: 25,
  purchasable: false,
});
const SCALE_M = plan({
  id: 'id-sc',
  code: 'SCALE_MONTHLY_STRIPE',
  name: 'SCALE',
  price: 299,
  trialDays: 0,
  vehicleLimit: 75,
  purchasable: false,
});
const ENT_M = plan({
  id: 'id-ent',
  code: 'ENTERPRISE_MONTHLY_STRIPE',
  name: 'ENTERPRISE',
  price: 299,
  trialDays: 0,
  vehicleLimit: 100,
  contactOnly: true,
  purchasable: false,
});
const TRIAL_M = plan({
  id: 'id-tr',
  code: 'TRIAL_MONTHLY_STRIPE',
  name: 'TRIAL',
  price: 0,
  trialDays: 14,
  vehicleLimit: 3,
});
const GRID_PLANS = [TRIAL_M, STARTER_M, PRO_M, SCALE_M, ENT_M];

const pastDueSummary = (over: Partial<BillingSummary> = {}): BillingSummary => ({
  state: 'PAST_DUE',
  canManage: true,
  plan: {
    code: 'STARTER_MONTHLY_STRIPE',
    name: 'STARTER',
    period: 'MONTHLY',
    price: 79.9,
    vehicleLimit: 15,
    contactOnly: false,
  },
  usage: { vehicles: 8, vehicleLimit: 15 },
  trialEndsAt: null,
  currentPeriodEnd: serverTime(30 * 86_400_000),
  cancelAtPeriodEnd: false,
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
  pastDueSince: serverTime(-12 * 3_600_000),
  graceEndsAt: serverTime(2.5 * 86_400_000),
  amountDueCents: 7990,
  openInvoice: {
    ref: 'in_1',
    amountCents: 7990,
    createdAt: serverTime(-86_400_000),
    payUrl: 'https://invoice.stripe.com/i/1',
  },
  paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2027 },
  lastFailure: {
    code: 'insufficient_funds',
    message: 'Saldo insuficiente',
    at: serverTime(-12 * 3_600_000),
  },
  invoices: [],
  actions: ['PAY_NOW', 'UPDATE_CARD'],
  payWith: ['CARD'],
  providerDetailsAvailable: true,
  ...over,
});


describe('Billing', () => {
  let subscriptionSignal: ReturnType<typeof signal<SubscriptionResponse | null>>;
  /**
   * Writable on purpose: `/plans` can fail or land late, and the free-vs-paid
   * classification must be exercised with an EMPTY plan list, not only with the
   * happy-path catalogue.
   */
  let plansSignal: ReturnType<typeof signal<PlanResponse[]>>;
  let errorSignal: ReturnType<typeof signal<string | null>>;
  let summarySignal: ReturnType<typeof signal<BillingSummary | null>>;
  let billing: {
    plans: unknown;
    subscription: unknown;
    loading: unknown;
    error: unknown;
    loadPlans: ReturnType<typeof vi.fn>;
    loadSubscription: ReturnType<typeof vi.fn>;
    startCheckout: ReturnType<typeof vi.fn>;
    downgrade: ReturnType<typeof vi.fn>;
    reactivate: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    clearError: ReturnType<typeof vi.fn>;
    summary: unknown;
    loadSummary: ReturnType<typeof vi.fn>;
    cardUpdateUrl: ReturnType<typeof vi.fn>;
    syncCardAfterUpdate: ReturnType<typeof vi.fn>;
    planChangePreview: ReturnType<typeof vi.fn>;
    upgrade: ReturnType<typeof vi.fn>;
  };
  /**
   * A tab handed out by the stubbed `openPendingTab()`. `snapshot` models the
   * real browser rule the ordering bug hid behind: the new tab receives a COPY
   * of sessionStorage taken at `window.open` time, and later writes in the
   * opener never reach it.
   */
  type FakeTab = {
    blocked: boolean;
    snapshot: Map<string, string>;
    navigate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let externalNav: {
    openExternal: ReturnType<typeof vi.fn>;
    openPendingTab: ReturnType<typeof vi.fn>;
  };
  /** Every tab reserved during the test, in order. */
  let tabs: FakeTab[];
  /** Flip to simulate an aggressive popup blocker. */
  let popupBlocked: boolean;
  const lastTab = (): FakeTab => tabs[tabs.length - 1];
  let access: { invalidate: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> };
  let notifications: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };
  let session: {
    isPlatformAdmin: () => boolean;
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  let queryParams: Record<string, string>;
  /** The tab's sessionStorage, as the component really sees it. */
  let sessionStore: Map<string, string>;

  const build = (): Probe => TestBed.createComponent(Billing).componentInstance as unknown as Probe;

  beforeEach(() => {
    subscriptionSignal = signal<SubscriptionResponse | null>(null);
    plansSignal = signal<PlanResponse[]>([...PLANS]);
    errorSignal = signal<string | null>(null);
    summarySignal = signal<BillingSummary | null>(null);
    queryParams = {};

    billing = {
      plans: plansSignal.asReadonly(),
      subscription: subscriptionSignal.asReadonly(),
      loading: signal(false).asReadonly(),
      error: errorSignal.asReadonly(),
      loadPlans: vi.fn(() => of(PLANS)),
      loadSubscription: vi.fn(() => of(subscriptionSignal())),
      startCheckout: vi.fn(() => of({ redirectUrl: 'https://pay.example/x', externalId: 'e' })),
      downgrade: vi.fn(() =>
        of({
          outcome: 'SCHEDULED',
          currentPlanCode: 'PRO_MONTHLY_STRIPE',
          targetPlanCode: 'FREE_MONTHLY_STRIPE',
          effectiveAt: FUTURE,
          message: null,
        }),
      ),
      reactivate: vi.fn(() =>
        of({
          outcome: 'REACTIVATED',
          currentPlanCode: 'PRO_MONTHLY_STRIPE',
          targetPlanCode: 'PRO_MONTHLY_STRIPE',
          effectiveAt: null,
          message: null,
        }),
      ),
      cancel: vi.fn(() => of(void 0)),
      clearError: vi.fn(() => errorSignal.set(null)),
      summary: summarySignal.asReadonly(),
      loadSummary: vi.fn(() => of(summarySignal())),
      cardUpdateUrl: vi.fn(() => of('https://billing.stripe.com/p/session/x')),
      syncCardAfterUpdate: vi.fn(() => of('UPDATED')),
      // O servidor mandaria para o checkout: estes testes cobrem o fluxo de hoje.
      // O upgrade na mesma assinatura está em billing-upgrade.spec.ts.
      planChangePreview: vi.fn(() => of({ mode: 'CHECKOUT', reasonCode: 'YEARLY_PLAN', message: null })),
      upgrade: vi.fn(),
    };
    tabs = [];
    popupBlocked = false;
    sessionStore = new Map<string, string>();
    externalNav = {
      openExternal: vi.fn(),
      openPendingTab: vi.fn(() => {
        const tab: FakeTab = {
          blocked: popupBlocked,
          snapshot: new Map(sessionStore),
          navigate: vi.fn(),
          close: vi.fn(),
        };
        tabs.push(tab);
        return tab;
      }),
    };
    access = { invalidate: vi.fn(), load: vi.fn(() => of(null)) };
    notifications = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    // Backed by a real store so the spec can observe WHEN a marker exists, not
    // merely that `setItem` was called at some point.
    session = {
      isPlatformAdmin: () => false,
      getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => void sessionStore.set(key, value)),
      removeItem: vi.fn((key: string) => void sessionStore.delete(key)),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: BillingService, useValue: billing },
        { provide: BillingAccessService, useValue: access },
        { provide: ExternalNavigationService, useValue: externalNav },
        { provide: NotificationService, useValue: notifications },
        { provide: SessionService, useValue: session },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    });
  });

  // ---------------------------------------------------------------------------
  // F1 — the plan shown derives from status, not from planCode alone
  // ---------------------------------------------------------------------------

  // PLANO vs STATUS. `TRIALING` is a subscription STATUS; `TRIAL` is a plan
  // NAME. A PRO subscription in its trial window is on PRO, with PRO's limits —
  // reading the status as the plan is what made the owner report a legitimate
  // 4th vehicle (PRO allows 15) as a bug. If these break, that report comes back.
  it('labels a TRIALING PRO subscription with the PLAN, not with the status', () => {
    subscriptionSignal.set(sub({ status: 'TRIALING', trialEndsAt: FUTURE }));
    const c = build();

    expect(c.isCurrent(PRO)).toBe(true);
    // Plano comes from the plan…
    expect(c.planCtaLabel(PRO)).toBe('Plano atual');
    // …and the trial survives as an ADDITIONAL state, never as the plan.
  });

  it('does NOT mark the TRIAL/free plan as current while a PRO trial is running', () => {
    subscriptionSignal.set(sub({ status: 'TRIALING', trialEndsAt: FUTURE }));
    const c = build();

    // The bug: the free card wore "Plano atual" while the account was on PRO.
    expect(c.planIntent(FREE)).not.toBe('CURRENT');
    expect(c.planCtaLabel(FREE)).not.toBe('Plano atual');
    expect(c.isCurrent(FREE)).toBe(false);
  });

  it('keeps the free card non-actionable for a trial that really IS on the free plan', () => {
    subscriptionSignal.set(
      sub({
        status: 'TRIALING',
        planCode: 'FREE_MONTHLY_STRIPE',
        planName: 'TRIAL',
        trialEndsAt: FUTURE,
      }),
    );
    const c = build();

    expect(c.isCurrent(FREE)).toBe(true);
    expect(c.planCtaLabel(FREE)).toBe('Plano atual');
    expect(c.planCtaDisabled(FREE)).toBe(true);
    // The paid card is still a real offer — a trial is not a paid plan.
    expect(c.planIntent(PRO)).toBe('UPGRADE');
  });

  it('never promises a paid period a TRIALING account has not paid for', () => {
    subscriptionSignal.set(sub({ status: 'TRIALING', trialEndsAt: FUTURE }));
    const c = build();

    // `burnsPaidPeriod()` is false during a trial, so the free card must not
    // claim the downgrade "vale a partir do fim do período já pago".
    expect(c.planCtaNote(FREE)).toBe('Sem cobranças. Você volta para o plano gratuito.');
  });

  it('does NOT announce a paid plan while the checkout is unpaid (PENDING)', () => {
    subscriptionSignal.set(sub({ status: 'PENDING' }));
    const c = build();

    expect(c.isCurrent(PRO)).toBe(false);
  });

  it('renders pendingPlanCode as pending, with an enabled "concluir pagamento" CTA', () => {
    subscriptionSignal.set(
      sub({ status: 'TRIALING', planCode: 'FREE_MONTHLY_STRIPE', planName: 'TRIAL', pendingPlanCode: 'PRO_MONTHLY_STRIPE' }),
    );
    const c = build();

    expect(c.isPending(PRO)).toBe(true);
    expect(c.isCurrent(PRO)).toBe(false);
    expect(c.planIntent(PRO)).toBe('PENDING_PAYMENT');
    expect(c.planCtaLabel(PRO)).toBe('Concluir pagamento');
    expect(c.planCtaDisabled(PRO)).toBe(false);
  });

  it('only marks the plan as current when the subscription is ACTIVE', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = build();

    expect(c.isCurrent(PRO)).toBe(true);
    expect(c.planCtaLabel(PRO)).toBe('Plano atual');
    expect(c.planCtaDisabled(PRO)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // F2 — status pill always renders, unknown statuses degrade safely
  // ---------------------------------------------------------------------------



  // ---------------------------------------------------------------------------
  // F3 — CTA branches by intent; downgrade never touches /checkout
  // ---------------------------------------------------------------------------

  it('labels a cheaper plan as a downgrade and a pricier one as an upgrade', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' })); // PRO active
    const c = build();

    expect(c.planIntent(BUSINESS)).toBe('UPGRADE');
    expect(c.planCtaLabel(BUSINESS)).toBe('Fazer upgrade para BUSINESS');
    expect(c.planIntent(FREE)).toBe('DOWNGRADE');
    expect(c.planCtaLabel(FREE)).toBe('Voltar ao plano gratuito');
  });

  it('opens a confirmation dialog for a downgrade and calls /downgrade, never /checkout', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = build();

    c.onPlanCta(FREE);
    expect(c.downgradeTarget()).toEqual(FREE);
    expect(billing.startCheckout).not.toHaveBeenCalled();

    c.confirmDowngrade();
    expect(billing.downgrade).toHaveBeenCalledWith('FREE_MONTHLY_STRIPE');
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('routes upgrades through /checkout into a new tab', () => {
    // No paid days left to burn → nothing to warn about, straight to checkout.
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: PAST }));
    const c = build();

    c.onPlanCta(BUSINESS);

    expect(billing.startCheckout).toHaveBeenCalledWith('BUSINESS_MONTHLY_STRIPE');
    expect(lastTab().navigate).toHaveBeenCalledWith('https://pay.example/x');
    // `openExternal` would be a post-response `window.open` — the blocked path.
    expect(externalNav.openExternal).not.toHaveBeenCalled();
  });

  it('shows the gateway error on the card that was clicked', () => {
    subscriptionSignal.set(null);
    billing.startCheckout = vi.fn(() => {
      // The service writes the banner message before the caller sees the error.
      errorSignal.set('Plano inativo.');
      return throwError(
        () => new HttpErrorResponse({ status: 400, error: { message: 'Plano inativo.' } }),
      );
    });
    const c = build();

    c.onPlanCta(PRO);

    expect(c.planCardError(PRO)).toBe('Plano inativo.');
    expect(c.planCardError(BUSINESS)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // F4 — cancel / reactivate
  // ---------------------------------------------------------------------------

  it('offers reactivate (and hides cancel) when a cancellation is scheduled', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', cancelAtPeriodEnd: true }));
    const c = build();

    expect(c.canReactivate()).toBe(true);
    expect(c.canCancel()).toBe(false);

    c.reactivate();
    expect(billing.reactivate).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('allows cancelling while TRIALING', () => {
    subscriptionSignal.set(sub({ status: 'TRIALING' }));
    const c = build();
    expect(c.canCancel()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // F6 / F7 — cache invalidation + blocked reason
  // ---------------------------------------------------------------------------

  it('invalidates the access cache when the page revalidates after the gateway', () => {
    const c = build();
    access.invalidate.mockClear();

    c.revalidate();

    expect(access.invalidate).toHaveBeenCalledTimes(1);
    expect(access.load).toHaveBeenCalled();
    expect(billing.loadSubscription).toHaveBeenCalled();
  });



  // ---------------------------------------------------------------------------
  // F8 — period switch (Mensal ↔ Anual) is its own intent and is never silent
  // ---------------------------------------------------------------------------

  it('classifies YEARLY → MONTHLY as PERIOD_DOWNGRADE, not as an upgrade', () => {
    subscriptionSignal.set(
      sub({
        status: 'ACTIVE',
        planCode: 'PRO_YEARLY_STRIPE',
        billingCycle: 'YEARLY',
        currentPeriodEnd: FAR_FUTURE,
      }),
    );
    const c = build();

    // Monthly-equivalent comparison used to call this an UPGRADE (199 > 165,83)
    // and send the user straight to /checkout.
    expect(c.planIntent(PRO)).toBe('PERIOD_DOWNGRADE');
    expect(c.planIntent(BUSINESS)).toBe('PERIOD_DOWNGRADE');
    expect(c.planCtaNote(PRO)).toContain('sem reembolso');

    // The free row is MONTHLY: it must stay a DOWNGRADE for a YEARLY
    // subscriber, never a period switch routed into a R$ 0 checkout.
    expect(c.planIntent(FREE)).toBe('DOWNGRADE');
    c.onPlanCta(FREE);
    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.downgradeTarget()).toEqual(FREE);
  });

  it('classifies MONTHLY → YEARLY as PERIOD_UPGRADE and keeps same-period logic intact', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' })); // PRO monthly
    const c = build();

    expect(c.planIntent(PRO_YEARLY)).toBe('PERIOD_UPGRADE');
    expect(c.planIntent(BUSINESS)).toBe('UPGRADE');
    expect(c.planIntent(FREE)).toBe('DOWNGRADE');
  });

  it('never opens a checkout for a period switch without an explicit, quantified warning', () => {
    subscriptionSignal.set(
      sub({
        status: 'ACTIVE',
        planCode: 'PRO_YEARLY_STRIPE',
        billingCycle: 'YEARLY',
        currentPeriodEnd: FAR_FUTURE,
      }),
    );
    const c = build();

    c.onPlanCta(PRO);

    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.periodSwitchTarget()).toEqual(PRO);
    expect(c.periodSwitchVariant()).toBe('danger');
    expect(c.periodSwitchConfirmLabel()).toContain('perder');
    const message = c.periodSwitchDialogMessage();
    expect(message).toContain('cancelada na hora');
    expect(message).toContain('reembolso');
    expect(message).toMatch(/dia\(s\) pagos|período pago/);

    // Backing out must not charge anything.
    c.dismissPeriodSwitch();
    expect(c.periodSwitchTarget()).toBeNull();
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('only reaches /checkout for a period switch after the user confirms', () => {
    subscriptionSignal.set(
      sub({
        status: 'ACTIVE',
        planCode: 'PRO_YEARLY_STRIPE',
        billingCycle: 'YEARLY',
        currentPeriodEnd: FAR_FUTURE,
      }),
    );
    const c = build();

    c.onPlanCta(PRO);
    c.confirmPeriodSwitch();

    expect(c.periodSwitchTarget()).toBeNull();
    expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
  });

  it('warns about the immediate charge on MONTHLY → YEARLY too', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = build();

    c.onPlanCta(PRO_YEARLY);

    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.periodSwitchVariant()).toBe('warning');
    expect(c.periodSwitchDialogMessage()).toContain('crédito');
  });

  // ---------------------------------------------------------------------------
  // F9 — reactivate is only offered when the backend would accept it
  // ---------------------------------------------------------------------------

  it('hides reactivate for a TRIALING subscription that was cancelled', () => {
    subscriptionSignal.set(sub({ status: 'TRIALING', cancelAtPeriodEnd: true }));
    const c = build();

    expect(c.canReactivate()).toBe(false);
  });

  it('hides reactivate for every non-ACTIVE status even with cancelAtPeriodEnd', () => {
    const c = build();
    for (const status of ['PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED', 'SOMETHING_NEW']) {
      subscriptionSignal.set(sub({ status, cancelAtPeriodEnd: true }));
      expect(c.canReactivate()).toBe(false);
    }
    subscriptionSignal.set(sub({ status: 'ACTIVE', cancelAtPeriodEnd: true }));
    expect(c.canReactivate()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // F10 — "Concluir pagamento" resumes the pending charge, never opens a new one
  // ---------------------------------------------------------------------------

  it('resumes the pending checkout with the same plan code and no gateway override', () => {
    TestBed.overrideProvider(SessionService, {
      useValue: {
        isPlatformAdmin: () => true,
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    subscriptionSignal.set(
      sub({
        status: 'TRIALING',
        planCode: 'FREE_MONTHLY_STRIPE',
        planName: 'TRIAL',
        pendingPlanCode: 'PRO_MONTHLY_STRIPE',
      }),
    );
    const c = build();

    c.onPlanCta(PRO);

    // No override → the request is identical to the one that created the
    // pending session, so the backend can hand the SAME session back.
    expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
  });

  it('tells the user the pending CTA is the same charge, not a second one', () => {
    subscriptionSignal.set(
      sub({
        status: 'TRIALING',
        planCode: 'FREE_MONTHLY_STRIPE',
        planName: 'TRIAL',
        pendingPlanCode: 'PRO_MONTHLY_STRIPE',
      }),
    );
    const c = build();

    expect(c.planCtaNote(PRO)).toContain('mesma cobrança');
    expect(c.planCtaNote(PRO)).toContain('nada é cobrado duas vezes');
  });

  // ---------------------------------------------------------------------------
  // C1 — `/downgrade` only accepts the FREE plan; a paid target is a checkout
  // ---------------------------------------------------------------------------

  it('classifies a cheaper PAID plan as a checkout, never as a downgrade', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' })); // PRO monthly, R$ 199
    const c = build();

    // BASIC (R$ 99) is cheaper than PRO but still paid: `/downgrade` answers
    // 400 for it, so it must not be classified as DOWNGRADE.
    expect(c.planIntent(BASIC)).toBe('PLAN_SWITCH');
    expect(c.planCtaLabel(BASIC)).toBe('Mudar para BASIC');
    expect(c.planIntent(FREE)).toBe('DOWNGRADE');
  });

  it('never sends a paid plan to /downgrade — it asks for consent, then checks out', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = build();

    c.onPlanCta(BASIC);

    // Consent first: the change is charged immediately and burns the paid month.
    expect(billing.downgrade).not.toHaveBeenCalled();
    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.downgradeTarget()).toBeNull();
    expect(c.periodSwitchTarget()).toEqual(BASIC);
    expect(c.periodSwitchVariant()).toBe('danger');
    const message = c.periodSwitchDialogMessage();
    expect(message).toContain('cobrados agora');
    expect(message).toContain('reembolso');

    c.confirmPeriodSwitch();

    expect(billing.startCheckout).toHaveBeenCalledWith('BASIC_MONTHLY_STRIPE');
    expect(billing.downgrade).not.toHaveBeenCalled();
  });

  it('only ever offers the free plan through the downgrade dialog', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = build();

    c.onPlanCta(FREE);

    expect(c.downgradeTarget()).toEqual(FREE);
    expect(c.downgradeDialogTitle()).toBe('Voltar ao plano gratuito');
    expect(c.downgradeDialogMessage()).toContain('plano gratuito');

    c.confirmDowngrade();
    expect(billing.downgrade).toHaveBeenCalledWith('FREE_MONTHLY_STRIPE');
  });

  // ---------------------------------------------------------------------------
  // C3 — ACTIVE on the FREE plan is not a paid subscription in force
  // ---------------------------------------------------------------------------

  const freeActive = () =>
    sub({
      status: 'ACTIVE',
      planCode: 'FREE_MONTHLY_STRIPE',
      planName: 'TRIAL',
      currentPeriodEnd: null,
      currentPeriodStart: null,
    });

  it('renders an ACTIVE free plan as free, not as a paid subscription', () => {
    subscriptionSignal.set(freeActive());
    const c = build();

    expect(c.isFreeActive()).toBe(true);
    // The pill stays visible and honest — the subscription really is active.
    // The free plan IS the plan in force.
    expect(c.isCurrent(FREE)).toBe(true);
    expect(c.planCtaLabel(FREE)).toBe('Plano atual');
  });

  it('offers neither cancel nor reactivate on an ACTIVE free plan', () => {
    subscriptionSignal.set(freeActive());
    const c = build();

    expect(c.canCancel()).toBe(false);
    expect(c.canReactivate()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // C3b — a MISSING plan row is "unknown", never proof of a free plan
  // ---------------------------------------------------------------------------

  it('keeps "Cancelar assinatura" for a paid subscription when /plans never loaded', () => {
    // The exact shape that used to hide the button from a paying customer:
    // `/plans` empty (failed or still in flight) + a null period end. Reading
    // that null as "gratuito" made `canCancel()` false for a PRO subscriber.
    plansSignal.set([]);
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: null }));
    const c = build();

    expect(c.isFreeActive()).toBe(false);
    expect(c.canCancel()).toBe(true);
  });

  it('keeps "Cancelar assinatura" when /plans fails outright', () => {
    plansSignal.set([]);
    billing.loadPlans = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: null }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => void 0);
    const c = build();

    // The failure must not take the page down with it…
    c.ngOnInit();
    // …it must leave a trace instead of vanishing…
    expect(logged).toHaveBeenCalled();
    // …and it must not demote a paying customer to the free plan.
    expect(c.isFreeActive()).toBe(false);
    expect(c.canCancel()).toBe(true);
    logged.mockRestore();
  });

  it('agrees with canReactivate about what a NULL period end means', () => {
    plansSignal.set([]);
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: null }),
    );
    const c = build();

    // Both rules read the same null as "we do not know", not as evidence
    // against the customer — so the escape hatch stays reachable.
    expect(c.isFreeActive()).toBe(false);
    expect(c.canReactivate()).toBe(true);
  });

  it('still classifies the real free plan as free once its row is known', () => {
    // Positive evidence: the row exists and costs zero. Nothing changes here.
    subscriptionSignal.set(freeActive());
    const c = build();

    expect(c.isFreeActive()).toBe(true);
    expect(c.canCancel()).toBe(false);
    expect(c.canReactivate()).toBe(false);
  });

  it('treats every paid plan as a plain checkout from an ACTIVE free plan', () => {
    subscriptionSignal.set(freeActive());
    const c = build();

    expect(c.planIntent(PRO)).toBe('UPGRADE');
    expect(c.planIntent(BASIC)).toBe('UPGRADE');
    // No paid period exists, so a yearly row is NOT a period switch with a
    // commitment to burn — it is just a first paid checkout.
    expect(c.planIntent(PRO_YEARLY)).toBe('UPGRADE');

    c.onPlanCta(PRO_YEARLY);
    expect(c.periodSwitchTarget()).toBeNull();
    expect(billing.startCheckout).toHaveBeenCalledWith('PRO_YEARLY_STRIPE');
  });

  // ---------------------------------------------------------------------------
  // C4 — /cancel clears the pending checkout
  // ---------------------------------------------------------------------------

  it('drops the pending checkout from the UI after cancelling', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', pendingPlanCode: 'BUSINESS_MONTHLY_STRIPE' }));
    const c = build();

    expect(c.planIntent(BUSINESS)).toBe('PENDING_PAYMENT');

    // The backend clears `pendingPlanCode` as part of /cancel.
    billing.cancel = vi.fn(() => {
      subscriptionSignal.set(
        sub({ status: 'ACTIVE', cancelAtPeriodEnd: true, pendingPlanCode: null }),
      );
      return of(void 0);
    });

    c.onCancelConfirmed();

    expect(c.planIntent(BUSINESS)).toBe('UPGRADE');
    // The same-tab "voltando do gateway" marker must not survive the cancel.
    expect(session.removeItem).toHaveBeenCalledWith('billingCheckoutPending');
  });

  // ---------------------------------------------------------------------------
  // C2 — the gateway may hand back the SAME checkout session
  // ---------------------------------------------------------------------------

  it('handles a reused checkout session (same externalId) without breaking', () => {
    billing.startCheckout = vi.fn(() =>
      of({ redirectUrl: 'https://pay.example/sess_1', externalId: 'sess_1' }),
    );
    subscriptionSignal.set(
      sub({
        status: 'TRIALING',
        planCode: 'FREE_MONTHLY_STRIPE',
        planName: 'TRIAL',
        pendingPlanCode: 'PRO_MONTHLY_STRIPE',
        externalId: 'sess_1',
      }),
    );
    const c = build();

    c.onPlanCta(PRO);

    // Nothing keys off a NEW externalId: the same session id is the expected
    // answer when a pending checkout is resumed.
    expect(lastTab().navigate).toHaveBeenCalledWith('https://pay.example/sess_1');
    expect(c.planCardError(PRO)).toBeNull();
    expect(c.planCtaNote(PRO)).toContain('mesma cobrança');
  });

  it('does not fire a second checkout while one is already in flight', () => {
    subscriptionSignal.set(
      sub({
        status: 'TRIALING',
        planCode: 'FREE_MONTHLY_STRIPE',
        planName: 'TRIAL',
        pendingPlanCode: 'PRO_MONTHLY_STRIPE',
      }),
    );
    const c = build();

    c.onPlanCta(PRO);
    c.onPlanCta(PRO);

    expect(billing.startCheckout).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // H2 — the FREE row is never a checkout. This is the DEFAULT state of every
  // brand new user, whose subscription is null.
  // ---------------------------------------------------------------------------

  it('never offers the free plan as a purchase to a user with no subscription', () => {
    subscriptionSignal.set(null);
    const c = build();

    expect(c.planIntent(FREE)).toBe('CURRENT');
    expect(c.planCtaLabel(FREE)).toBe('Plano atual');
    expect(c.planCtaDisabled(FREE)).toBe(true);

    c.onPlanCta(FREE);

    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(billing.downgrade).not.toHaveBeenCalled();
    expect(c.downgradeTarget()).toBeNull();
    expect(c.periodSwitchTarget()).toBeNull();
    // The paid rows are still perfectly buyable from here.
    expect(c.planIntent(PRO)).toBe('SUBSCRIBE');
  });

  it('never acts blindly on an unknown status — free stays non-actionable', () => {
    const c = build();
    subscriptionSignal.set(sub({ status: 'SOMETHING_NEW' }));

    expect(c.planIntent(FREE)).toBe('CURRENT');
    expect(c.planCtaDisabled(FREE)).toBe(true);
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('treats free as a real destination for a trial running on a PAID plan', () => {
    const c = build();
    // `TRIALING` on PRO is NOT "already on the free plan": the account is on
    // PRO. Calling it CURRENT was the plano-vs-status collision.
    subscriptionSignal.set(sub({ status: 'TRIALING' }));

    expect(c.planIntent(FREE)).toBe('DOWNGRADE');
    expect(c.planCtaLabel(FREE)).toBe('Voltar ao plano gratuito');
    // Still never a checkout — a R$ 0,00 plan has nothing to charge.
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('does NOT flip the free card into an action when /plans has not landed', () => {
    const c = build();
    // No `/plans` row means no positive evidence that PRO costs money, so the
    // trial must not be classified as "trial on a paid plan".
    plansSignal.set([]);
    subscriptionSignal.set(sub({ status: 'TRIALING' }));

    expect(c.planIntent(FREE)).toBe('CURRENT');
    expect(c.planCtaDisabled(FREE)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // R4/H3 — a BLOCKED account must keep a way back to the free plan
  // ---------------------------------------------------------------------------

  it('offers the way back to the free plan on PAST_DUE / CANCELED', () => {
    const c = build();

    for (const status of ['PAST_DUE', 'UNPAID', 'PAUSED', 'CANCELED']) {
      subscriptionSignal.set(sub({ status, currentPeriodEnd: PAST }));

      // Telling a BLOCKED user the free plan is already theirs, with the button
      // disabled, left paying again as the only exit.
      expect(c.planIntent(FREE)).toBe('DOWNGRADE');
      expect(c.planCtaLabel(FREE)).toBe('Voltar ao plano gratuito');
      expect(c.planCtaDisabled(FREE)).toBe(false);
    }
  });

  // V124 (backend) — EXPIRED passou a existir e significa SÓ "teste vencido".
  // O plano gratuito é o próprio plano de teste: "voltar" a ele desbloquearia o
  // teste vencido para sempre, e o backend responde no-op. Sem botão.
  it('does NOT offer the way back to the free plan to an EXPIRED (ended) trial', () => {
    const c = build();
    subscriptionSignal.set(sub({ status: 'EXPIRED', currentPeriodEnd: PAST }));

    expect(c.planIntent(FREE)).not.toBe('DOWNGRADE');
    expect(c.planCtaLabel(FREE)).not.toBe('Voltar ao plano gratuito');
  });

  it('routes the blocked account to /downgrade and never to /checkout', () => {
    subscriptionSignal.set(sub({ status: 'CANCELED', currentPeriodEnd: PAST }));
    const c = build();

    c.onPlanCta(FREE);
    expect(c.downgradeTarget()).toEqual(FREE);
    // No paid period survives here, so the dialog must NOT promise paid access.
    const message = c.downgradeDialogMessage();
    expect(message).toContain('plano gratuito');
    expect(message).not.toContain('acesso pago até');

    c.confirmDowngrade();
    expect(billing.downgrade).toHaveBeenCalledWith('FREE_MONTHLY_STRIPE');
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('handles an APPLIED downgrade without inventing a future date', () => {
    subscriptionSignal.set(sub({ status: 'CANCELED', currentPeriodEnd: PAST }));
    // Backend contract: CANCELED applies on the spot.
    billing.downgrade = vi.fn(() => {
      subscriptionSignal.set(
        sub({
          status: 'ACTIVE',
          planCode: 'FREE_MONTHLY_STRIPE',
          planName: 'TRIAL',
          currentPeriodEnd: null,
          currentPeriodStart: null,
        }),
      );
      return of({
        outcome: 'APPLIED',
        currentPlanCode: 'FREE_MONTHLY_STRIPE',
        targetPlanCode: 'FREE_MONTHLY_STRIPE',
        effectiveAt: null,
        message: null,
      });
    });
    const c = build();

    // The dialog must not promise access it cannot prove.
    c.onPlanCta(FREE);
    const dialog = c.downgradeDialogMessage();
    expect(dialog).toContain('agora no plano gratuito');
    expect(dialog).not.toContain('acesso pago até');

    access.invalidate.mockClear();
    access.load.mockClear();
    billing.loadSubscription.mockClear();
    c.confirmDowngrade();

    // No fabricated "entra em vigor em …": effectiveAt came back null.
    const shown = notifications.success.mock.calls.at(-1)?.[0] as string;
    expect(shown).toContain('liberada');
    expect(shown).not.toMatch(/\d{4}/);

    // The account is unblocked NOW — both sources must be re-read, no F5.
    expect(access.invalidate).toHaveBeenCalled();
    expect(access.load).toHaveBeenCalled();
    expect(billing.loadSubscription).toHaveBeenCalled();
    // …and the page settles on the free plan in force.
    expect(c.isFreeActive()).toBe(true);
    expect(c.planIntent(FREE)).toBe('CURRENT');
  });

  it('prefers the backend pt-BR message for an APPLIED downgrade', () => {
    subscriptionSignal.set(sub({ status: 'CANCELED', currentPeriodEnd: PAST }));
    billing.downgrade = vi.fn(() =>
      of({
        outcome: 'APPLIED',
        currentPlanCode: 'FREE_MONTHLY_STRIPE',
        targetPlanCode: 'FREE_MONTHLY_STRIPE',
        effectiveAt: null,
        message: 'Sua conta foi liberada no plano gratuito.',
      }),
    );
    const c = build();

    c.onPlanCta(FREE);
    c.confirmDowngrade();

    expect(notifications.success).toHaveBeenCalledWith('Sua conta foi liberada no plano gratuito.');
  });

  it('explains the refusal if the backend still rejects the downgrade', () => {
    subscriptionSignal.set(sub({ status: 'CANCELED', currentPeriodEnd: PAST }));
    billing.downgrade = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 400, error: {} })),
    );
    const c = build();

    c.onPlanCta(FREE);
    c.confirmDowngrade();

    const shown = c.planCardError(FREE);
    expect(shown).not.toBeNull();
    // No blind "tente novamente" on a request that will fail the same way.
    expect(shown).toContain('Escolha um plano');
  });

  it('refuses a zero-price checkout even if a caller reaches startCheckout', () => {
    // Guard of last resort: a R$ 0,00 plan is a guaranteed 400 on /checkout.
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: FUTURE }));
    const c = build();

    // FREE from a PAID plan is a DOWNGRADE → dialog → /downgrade, never checkout.
    c.onPlanCta(FREE);
    c.confirmDowngrade();

    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(billing.downgrade).toHaveBeenCalledWith('FREE_MONTHLY_STRIPE');
  });

  // ---------------------------------------------------------------------------
  // H3 — an UPGRADE burns the paid period exactly like the cheaper direction
  // ---------------------------------------------------------------------------

  it('asks for consent before an upgrade that throws away a paid period', () => {
    subscriptionSignal.set(
      sub({
        status: 'ACTIVE',
        planCode: 'PRO_YEARLY_STRIPE',
        billingCycle: 'YEARLY',
        currentPeriodEnd: FUTURE,
      }),
    );
    const c = build();

    // Same period (yearly → yearly), pricier: still an immediate charge that
    // cancels the year already paid for.
    expect(c.planIntent(BUSINESS_YEARLY)).toBe('UPGRADE');
    expect(c.planCtaNote(BUSINESS_YEARLY)).toContain('não vira crédito');

    c.onPlanCta(BUSINESS_YEARLY);

    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.periodSwitchTarget()).toEqual(BUSINESS_YEARLY);
    expect(c.periodSwitchVariant()).toBe('danger');
    const message = c.periodSwitchDialogMessage();
    expect(message).toContain('cobrados agora');
    expect(message).toContain('reembolso');

    c.confirmPeriodSwitch();
    expect(billing.startCheckout).toHaveBeenCalledWith('BUSINESS_YEARLY_STRIPE');
  });

  it('skips the dialog for an upgrade with no paid period left to burn', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: PAST }));
    const c = build();

    c.onPlanCta(BUSINESS);

    expect(c.periodSwitchTarget()).toBeNull();
    expect(billing.startCheckout).toHaveBeenCalledWith('BUSINESS_MONTHLY_STRIPE');
  });

  // ---------------------------------------------------------------------------
  // H4 — a missing redirect URL is an ERROR, not a silent dead end
  // ---------------------------------------------------------------------------

  it('surfaces an error (and allows a retry) when the gateway returns no URL', () => {
    subscriptionSignal.set(null);
    billing.startCheckout = vi.fn(() => of({ redirectUrl: '   ', externalId: 'e' }));
    const c = build();

    c.onPlanCta(PRO);

    expect(lastTab().navigate).not.toHaveBeenCalled();
    // …and the blank tab we reserved is not left orphaned on screen.
    expect(lastTab().close).toHaveBeenCalledTimes(1);
    expect(c.planCardError(PRO)).not.toBeNull();
    // Not stuck: the CTA is enabled again and a second click really retries.
    expect(c.planCtaDisabled(PRO)).toBe(false);
    expect(c.planCtaLabel(PRO)).toBe('Assinar PRO');

    c.onPlanCta(PRO);
    expect(billing.startCheckout).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // R4/M — the retry must RESUME the session the first POST already created
  // ---------------------------------------------------------------------------

  it('retries an empty-redirect checkout as a resume, never as a second session', () => {
    TestBed.overrideProvider(SessionService, {
      useValue: {
        // PLATFORM_ADMIN: the override is what would make the retry look like a
        // different request to the backend and mint a SECOND Stripe session.
        isPlatformAdmin: () => true,
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    subscriptionSignal.set(null);
    billing.startCheckout = vi.fn(() => of({ redirectUrl: '', externalId: 'sess_1' }));
    const c = build();

    c.onPlanCta(PRO);
    // The first POST carries no override — the admin gateway tool left this page (D6)…
    expect(billing.startCheckout).toHaveBeenNthCalledWith(1, 'PRO_MONTHLY_STRIPE');
    // …and the user is told the retry costs nothing extra.
    expect(c.planCardError(PRO)).toContain('nada é cobrado duas vezes');

    c.onPlanCta(PRO);
    // …so the retry is the identical request and the backend hands back sess_1.
    expect(billing.startCheckout).toHaveBeenNthCalledWith(2, 'PRO_MONTHLY_STRIPE');
  });

  it('does not mark a checkout as resumable when no session was created', () => {
    subscriptionSignal.set(null);
    billing.startCheckout = vi.fn(() => of({ redirectUrl: '', externalId: '' }));
    const c = build();

    c.onPlanCta(PRO);

    // No externalId → no session exists → the copy must not promise a resume.
    expect(c.planCardError(PRO)).not.toContain('duas vezes');
  });

  // ---------------------------------------------------------------------------
  // M3 — reactivate needs a paid period still running
  // ---------------------------------------------------------------------------

  it('hides reactivate when the paid period already ended', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: PAST }));
    const c = build();

    expect(c.canReactivate()).toBe(false);

    subscriptionSignal.set(
      sub({ status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: FUTURE }),
    );
    expect(c.canReactivate()).toBe(true);
  });

  it('treats a NULL period end as unknown, not as expired', () => {
    // A paid subscription momentarily missing its period end must not lose the
    // only button that undoes a scheduled cancellation.
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: null }),
    );
    const c = build();

    expect(c.isFreeActive()).toBe(false);
    expect(c.canReactivate()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // M5 — a stale page-level error must not outlive the next action
  // ---------------------------------------------------------------------------

  it('clears the page-level error banner when a new plan action starts', () => {
    subscriptionSignal.set(null);
    errorSignal.set('Falha anterior.');
    const c = build();

    c.onPlanCta(PRO);

    expect(billing.clearError).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // N1 — the checkout ALWAYS opens a new tab, and never as a post-response
  //      `window.open` (which is what mobile blocks as a pop-up)
  // ---------------------------------------------------------------------------

  it('reserves the checkout tab synchronously, before the request answers', () => {
    subscriptionSignal.set(null);
    const pending = new Subject<{ redirectUrl: string; externalId: string }>();
    billing.startCheckout = vi.fn(() => pending.asObservable());
    const c = build();

    c.onPlanCta(PRO);

    // Still inside the click gesture: the tab already exists, nothing navigated.
    expect(externalNav.openPendingTab).toHaveBeenCalledTimes(1);
    expect(lastTab().navigate).not.toHaveBeenCalled();

    pending.next({ redirectUrl: 'https://pay.example/x', externalId: 'e' });
    pending.complete();

    expect(lastTab().navigate).toHaveBeenCalledWith('https://pay.example/x');
    // Exactly one tab: no second `window.open` after the response.
    expect(externalNav.openPendingTab).toHaveBeenCalledTimes(1);
  });

  it('does not reserve a tab for a request that never happens', () => {
    subscriptionSignal.set(null);
    const c = build();

    // Free plan → no checkout at all, so no orphan blank tab.
    c.onPlanCta(FREE);

    expect(externalNav.openPendingTab).not.toHaveBeenCalled();
  });

  it('closes the reserved tab and offers a retry when the request fails', () => {
    subscriptionSignal.set(null);
    billing.startCheckout = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    const c = build();

    c.onPlanCta(PRO);

    expect(lastTab().close).toHaveBeenCalledTimes(1);
    expect(c.planCardError(PRO)).not.toBeNull();
    expect(c.manualCheckout()).toBeNull();
    // Markers written before the tab was reserved must not outlive the failure.
    expect(sessionStore.has('billingCheckoutPending')).toBe(false);
    expect(sessionStore.has('billingCheckoutPlanCode')).toBe(false);
    // Not stuck: the CTA is live again and a second click really retries.
    expect(c.planCtaDisabled(PRO)).toBe(false);
    c.onPlanCta(PRO);
    expect(billing.startCheckout).toHaveBeenCalledTimes(2);
  });

  it('recovers when the checkout request hangs without answering', () => {
    vi.useFakeTimers();
    try {
      subscriptionSignal.set(null);
      // No HTTP timeout interceptor exists in the app: without the operator the
      // reserved tab stayed blank forever and the CTA never left "Processando…".
      billing.startCheckout = vi.fn(() =>
        new Subject<{ redirectUrl: string; externalId: string }>().asObservable(),
      );
      const c = build();

      c.onPlanCta(PRO);
      expect(c.planCtaLabel(PRO)).toBe('Processando…');

      vi.advanceTimersByTime(20001);

      expect(lastTab().close).toHaveBeenCalledTimes(1);
      expect(c.planCardError(PRO)).not.toBeNull();
      expect(c.planCtaDisabled(PRO)).toBe(false);
      expect(sessionStore.has('billingCheckoutPending')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('degrades to a clickable link when the popup blocker refuses the tab', () => {
    subscriptionSignal.set(null);
    popupBlocked = true;
    const c = build();

    c.onPlanCta(PRO);

    const manual = c.manualCheckout();
    expect(manual?.url).toBe('https://pay.example/x');
    expect(manual?.planName).toBe('PRO');
    expect(c.planCardError(PRO)).toContain('bloqueou');
    // Nothing is claimed to be in progress until the user actually clicks — a
    // reload here must not wait for a checkout that was never opened.
    expect(c.awaitingPayment()).toBe(false);
    expect(sessionStore.has('billingCheckoutPending')).toBe(false);
    expect(c.planCtaDisabled(PRO)).toBe(false);

    // The user's own click on the link IS a gesture no blocker refuses.
    c.onManualCheckoutOpened();

    expect(c.awaitingPayment()).toBe(true);
    expect(sessionStore.get('billingCheckoutPending')).toBe('true');
    expect(sessionStore.get('billingCheckoutPlanCode')).toBe('PRO_MONTHLY_STRIPE');
  });

  it('drops a stale manual-checkout link when another plan is clicked', () => {
    subscriptionSignal.set(null);
    popupBlocked = true;
    const c = build();

    c.onPlanCta(PRO);
    expect(c.manualCheckout()?.planCode).toBe('PRO_MONTHLY_STRIPE');

    popupBlocked = false;
    c.onPlanCta(BUSINESS);

    expect(c.manualCheckout()).toBeNull();
  });

  it('gives the checkout tab a sessionStorage snapshot that ALREADY has the plan code', () => {
    subscriptionSignal.set(null);
    const c = build();

    c.onPlanCta(PRO);

    // The bug this pins: writing the marker after the POST resolved produced a
    // snapshot without it, silently demoting `/billing/success` to a heuristic
    // that can congratulate an abandoned checkout.
    expect(lastTab().snapshot.get('billingCheckoutPlanCode')).toBe('PRO_MONTHLY_STRIPE');
    expect(lastTab().snapshot.get('billingCheckoutPending')).toBe('true');
  });

  it('waits for confirmation in the ORIGINAL tab once the checkout tab opens', () => {
    subscriptionSignal.set(null);
    const c = build();

    c.onPlanCta(PRO);

    // The gateway runs elsewhere: this tab keeps a bounded waiting window and
    // records the plan so the return page can recognise the payment.
    expect(c.awaitingPayment()).toBe(true);
    expect(sessionStore.get('billingCheckoutPlanCode')).toBe('PRO_MONTHLY_STRIPE');

    // …and the wait ends by itself once the paid plan is in force.
    subscriptionSignal.set(sub({ status: 'ACTIVE', planCode: 'PRO_MONTHLY_STRIPE' }));
    c.revalidate();

    expect(c.awaitingPayment()).toBe(false);
    expect(sessionStore.has('billingCheckoutPending')).toBe(false);
  });

  it('does not keep the CTAs disabled once the user is back on this tab', () => {
    vi.useFakeTimers();
    try {
      subscriptionSignal.set(
        sub({ status: 'TRIALING', planCode: 'FREE_MONTHLY_STRIPE', planName: 'TRIAL' }),
      );
      const c = build();

      c.onPlanCta(PRO);
      expect(c.awaitingPayment()).toBe(true);

      // Coming back to this tab means the long "still paying elsewhere" window
      // no longer applies — an abandoned checkout must not disable every CTA
      // for the full fifteen minutes.
      vi.advanceTimersByTime(3000);
      c.revalidate();
      vi.advanceTimersByTime(31000);

      expect(c.awaitingPayment()).toBe(false);
      expect(c.planCtaDisabled(PRO)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------------------------------------------------------------------------
  // P — feedback standard (phase 3): billing was the worst offender in the app,
  //     showing the SAME failure four times (plan card + page banner + its own
  //     toast + the interceptor safety net). Each failure must now appear ONCE.
  // ---------------------------------------------------------------------------

  /** Drives the safety net the way `errorInterceptor` does for an unclaimed 4xx. */
  const runSafetyNet = (err: HttpErrorResponse): void => {
    TestBed.inject(ApiErrorService).scheduleSafetyNet(err);
    vi.runAllTimers();
  };

  it('shows a failed plan CTA only on the card — no page banner, no toast', () => {
    vi.useFakeTimers();
    try {
      subscriptionSignal.set(null);
      const err = new HttpErrorResponse({
        status: 400,
        error: { message: 'Plano indisponível no momento.' },
      });
      billing.startCheckout = vi.fn(() => {
        // The service writes its banner copy before the caller sees the error.
        errorSignal.set('Plano indisponível no momento.');
        return throwError(() => err);
      });
      const c = build();

      c.onPlanCta(PRO);

      // 1st surface — the card the user actually clicked. The only one.
      expect(c.planCardError(PRO)).toBe('Plano indisponível no momento.');
      // 2nd surface gone: the page-level banner was cleared by the action.
      expect(c.error()).toBeNull();
      // 3rd + 4th surfaces gone: no toast from the screen, none from the net.
      runSafetyNet(err);
      expect(notifications.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a failed cancel inline next to the button instead of a toast', () => {
    vi.useFakeTimers();
    try {
      subscriptionSignal.set(sub({ status: 'ACTIVE' }));
      const err = new HttpErrorResponse({
        status: 409,
        error: { message: 'Assinatura já cancelada.' },
      });
      billing.cancel = vi.fn(() => {
        errorSignal.set('Assinatura já cancelada.');
        return throwError(() => err);
      });
      const c = build();

      c.onCancelConfirmed();

      expect(c.accountActionError()).toBe('Assinatura já cancelada.');
      expect(c.error()).toBeNull();
      runSafetyNet(err);
      expect(notifications.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a failed reactivate inline, and still sends the user to the plans', () => {
    vi.useFakeTimers();
    try {
      subscriptionSignal.set(sub({ status: 'ACTIVE', cancelAtPeriodEnd: true }));
      const err = new HttpErrorResponse({
        status: 400,
        error: { message: 'O período pago já terminou.' },
      });
      billing.reactivate = vi.fn(() => {
        errorSignal.set('O período pago já terminou.');
        return throwError(() => err);
      });
      const c = build();

      c.reactivate();

      // The backend sentence wins over our fallback, and it is shown once.
      expect(c.accountActionError()).toBe('O período pago já terminou.');
      expect(c.error()).toBeNull();
      runSafetyNet(err);
      expect(notifications.error).not.toHaveBeenCalled();
      // The recovery intent: the plans sheet opens (it used to scroll to the grid).
      expect(c.sheet()).toBe('plans');
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------------------------------------------------------------------------
  // Redesign 2026-10-29 — resumo, grade de 5 colunas, pagar agora, sucesso
  // ---------------------------------------------------------------------------

  it('lays out the five-column grid: em breve without a Stripe price, contact for Enterprise', () => {
    plansSignal.set([...GRID_PLANS]);
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'STARTER_MONTHLY_STRIPE', planName: 'STARTER' }),
    );
    const cols = build().planColumns();

    expect(cols.map((c) => c.tier)).toEqual(['TRIAL', 'STARTER', 'PRO', 'SCALE', 'ENTERPRISE']);
    const by = (t: string) => cols.find((c) => c.tier === t)!;
    expect(by('STARTER')).toMatchObject({
      current: true,
      ctaLabel: 'Plano atual',
      ctaDisabled: true,
      price: '79,90',
    });
    expect(by('PRO')).toMatchObject({ ctaLabel: 'Em breve', ctaDisabled: true, price: '159,90' });
    expect(by('SCALE')).toMatchObject({ ctaLabel: 'Em breve', ctaDisabled: true, price: '299' });
    expect(by('ENTERPRISE')).toMatchObject({
      contact: true,
      ctaLabel: 'Falar com a gente',
      price: 'Sob consulta',
    });
    expect(by('TRIAL').ctaLabel).toBe('Já utilizado');
  });

  it('a purchasable higher plan reads "Subir para"', () => {
    plansSignal.set([
      ...GRID_PLANS.filter((p) => p.name !== 'PRO'),
      { ...PRO_M, purchasable: true },
    ]);
    subscriptionSignal.set(
      sub({
        status: 'ACTIVE',
        planCode: 'STARTER_MONTHLY_STRIPE',
        planName: 'STARTER',
        currentPeriodEnd: PAST,
      }),
    );
    const cols = build().planColumns();
    expect(cols.find((c) => c.tier === 'PRO')!.ctaLabel).toBe('Subir para Pro');
  });

  it('past due: plain reason, countdown and pay-now from the summary', () => {
    summarySignal.set(pastDueSummary());
    subscriptionSignal.set(
      sub({ status: 'PAST_DUE', planCode: 'STARTER_MONTHLY_STRIPE', planName: 'STARTER' }),
    );
    const c = build();

    expect(c.state()).toBe('PAST_DUE');
    expect(c.failureLine()).toMatch(
      /^Visa final 4242 recusado em \d{2}\/\d{2}: saldo insuficiente\.$/,
    );
    expect(c.deadlineLabel()).toBe('Faltam 2 dias');
    expect(c.canPayInvoice()).toBe(true);
  });

  it('"Pagar agora" opens the Stripe hosted invoice, never a checkout', () => {
    summarySignal.set(pastDueSummary());
    const c = build();
    c.openPay();
    c.confirmPay();

    expect(externalNav.openExternal).toHaveBeenCalledWith('https://invoice.stripe.com/i/1');
    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.sheet()).toBeNull();
  });

  it('"Outro cartão" goes to the Stripe billing portal', () => {
    summarySignal.set(pastDueSummary());
    const c = build();
    c.openPay();
    c.payOption.set('card');
    c.confirmPay();

    expect(billing.cardUpdateUrl).toHaveBeenCalledTimes(1);
  });

  it('a failed card update shows the error where the action is', () => {
    summarySignal.set(pastDueSummary());
    billing.cardUpdateUrl = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Sem cartão.' } })),
    );
    const c = build();
    c.openCardUpdate();

    expect(c.accountActionError()).toBe('Sem cartão.');
  });

  it('opens the pay sheet from the e-mail deep link (?pagar=1)', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ pagar: '1' }) } },
    });
    summarySignal.set(pastDueSummary());
    const c = build();
    c.ngOnInit();

    expect(c.sheet()).toBe('pay');
  });

  it('back from the billing portal, the subscription is switched to the new card once', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ cartao: 'atualizado' }) } },
    });
    summarySignal.set(pastDueSummary());
    const c = build();
    c.ngOnInit();
    c.revalidate();

    expect(billing.syncCardAfterUpdate).toHaveBeenCalledTimes(1);
    expect(notifications.success).toHaveBeenCalled();
    // Paying the open invoice is still the hosted-invoice path, never this call.
    expect(externalNav.openExternal).not.toHaveBeenCalled();
  });

  it('confirms the payment when the summary turns from past due to active', () => {
    summarySignal.set(pastDueSummary());
    const c = build();
    c.ngOnInit();
    expect(c.sheet()).toBeNull();

    summarySignal.set(
      pastDueSummary({
        state: 'ACTIVE',
        amountDueCents: null,
        openInvoice: null,
        lastFailure: null,
        actions: ['UPDATE_CARD', 'CHANGE_PLAN', 'CANCEL'],
      }),
    );
    c.revalidate();

    expect(c.sheet()).toBe('paid');
    expect(c.paidReceipt()).toMatchObject({ amount: 'R$ 79,90', planName: 'Starter' });
    expect(access.invalidate).toHaveBeenCalled();
  });

  it('keeps the load banner as the single surface when /plans fails', () => {
    vi.useFakeTimers();
    try {
      const err = new HttpErrorResponse({ status: 422, error: { message: 'Catálogo indisponível.' } });
      billing.loadPlans = vi.fn(() => {
        errorSignal.set('Catálogo indisponível.');
        return throwError(() => err);
      });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => void 0);
      const c = build();
      c.ngOnInit();

      // A LOAD failure legitimately belongs in the page banner — and nowhere else.
      expect(c.error()).toBe('Catálogo indisponível.');
      runSafetyNet(err);
      expect(notifications.error).not.toHaveBeenCalled();
      logged.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });



  // ---------------------------------------------------------------------------
  // Assinatura v2 — somente leitura, faturas (tabela + lista) e Pix
  // ---------------------------------------------------------------------------

  type V2Probe = {
    canManage(): boolean;
    canCancel(): boolean;
    readOnly(): boolean;
    hero(): { tone: string; chip: { label: string }; ring: { value: string | null; icon: string | null } } | null;
    pixAvailable(): boolean;
    openPix(): void;
    closePix(): void;
    closeSheet(): void;
    createPix(): void;
    copyPix(): Promise<void>;
    checkPixNow(): void;
    pixPhase(): string;
    pixCopied(): boolean;
    pixToast(): boolean;
    pixCountdown(): string;
    pixUrgent(): boolean;
    sheet(): string | null;
    paidReceipt(): { method: string; viaPix: boolean } | null;
    ngOnInit(): void;
    ngOnDestroy(): void;
  };
  const buildV2 = (): V2Probe => build() as unknown as V2Probe;

  const PIX = {
    attemptId: 'att-1',
    status: 'PENDING' as const,
    payload: '00020101021226870014br.gov.bcb.pix2565qrpix.stripe.com/x6304B1F2',
    qrCodeBase64: 'iVBORw0KGgo=',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    amountCents: 7990,
    hostedInstructionsUrl: 'https://payments.stripe.com/pix/x',
  };
  const pixStatus = (status: string, accessReleased = false) => ({
    attemptId: 'att-1',
    status,
    expiresAt: PIX.expiresAt,
    amountCents: 7990,
    accessReleased,
  });
  const pixSummary = (over: Partial<BillingSummary> = {}): BillingSummary =>
    pastDueSummary({ payWith: ['CARD', 'PIX'], ...over });
  const withPixApi = (statuses: ReturnType<typeof pixStatus>[] = [pixStatus('PENDING')]) => {
    const queue = [...statuses];
    const api = {
      createInvoicePix: vi.fn(() => of({ ...PIX })),
      invoicePixStatus: vi.fn(() => of(queue.length > 1 ? queue.shift()! : queue[0])),
    };
    Object.assign(billing, api);
    return api;
  };

  const OPEN_INVOICE = {
    ref: 'in_3',
    number: 'A-3',
    createdAt: serverTime(-86_400_000),
    amountCents: 7990,
    status: 'OPEN' as const,
    cardBrand: null,
    cardLast4: null,
    pdfUrl: null,
    hostedUrl: 'https://invoice.stripe.com/i/3',
  };

  /** Renderiza a página v2 com o resumo atual e devolve o componente e o DOM. */
  const renderV2 = (status: SubscriptionResponse['status'] = 'PAST_DUE') => {
    subscriptionSignal.set(sub({ status, planCode: 'STARTER_MONTHLY_STRIPE', planName: 'STARTER' }));
    const fixture = TestBed.createComponent(Billing);
    const c = fixture.componentInstance as unknown as V2Probe & {
      payNow(): void;
      payByCard(): void;
    };
    c.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector<HTMLButtonElement>(`[data-testid=${id}]`);
    return { fixture, c, el, q };
  };

  it('read-only (support session): the SAME two buttons, disabled, and one line saying why', () => {
    summarySignal.set(pixSummary({ canManage: false, actions: [] }));
    const { c, el, q } = renderV2();

    expect(c.canManage()).toBe(false);
    expect(c.canCancel()).toBe(false);
    expect(c.pixAvailable()).toBe(false);
    expect(q('row-cancel')).toBeNull();
    expect(q('inv-pay')).toBeNull();
    expect(q('hero-pix')).toBeNull();
    expect(q('hero-pay')?.textContent?.trim()).toBe('Pagar R$ 79,90');
    expect(q('hero-pay')?.disabled).toBe(true);
    expect(q('hero-card')?.textContent?.trim()).toBe('Trocar cartão');
    expect(q('hero-card')?.disabled).toBe(true);
    expect(q('billing-readonly')?.textContent?.trim()).toBe('Só o dono da empresa pode pagar.');
    expect(el.textContent).not.toContain('Você está vendo como suporte');

    // Mesmo chamado à força, nada abre.
    c.payNow();
    expect(c.sheet()).toBeNull();
    expect(externalNav.openExternal).not.toHaveBeenCalled();
  });

  it('read-only: an open invoice row has no "Pagar", even if the server lists the actions', () => {
    summarySignal.set(pixSummary({ canManage: false, invoices: [OPEN_INVOICE] }));
    const { el, q } = renderV2();

    expect(el.querySelector('[data-testid=invoices-table]')?.textContent).toContain('Em aberto');
    expect(q('inv-pay')).toBeNull();
    expect(q('hero-pay')?.disabled).toBe(true);
    expect(q('hero-card')?.disabled).toBe(true);
  });

  it('read-only on a blocked account shows the same disabled pair', () => {
    summarySignal.set(pastDueSummary({ state: 'BLOCKED', graceEndsAt: serverTime(-3_600_000), canManage: false, actions: [] }));
    const { q } = renderV2('PAST_DUE');

    expect(q('hero-pay')?.disabled).toBe(true);
    expect(q('hero-card')?.disabled).toBe(true);
    expect(q('billing-readonly')).not.toBeNull();
  });

  it('atrasada without Pix: ONE "Pagar R$ 79,90" goes straight to the Stripe hosted invoice', () => {
    summarySignal.set(pastDueSummary());
    const { c, el, q } = renderV2();

    expect(q('hero-pay')?.textContent?.trim()).toBe('Pagar R$ 79,90');
    expect(q('hero-pay')?.classList.contains('primary')).toBe(true);
    expect(q('hero-card')?.textContent?.trim()).toBe('Trocar cartão');
    expect(q('hero-card')?.classList.contains('tonal')).toBe(true);
    expect(q('hero-pix')).toBeNull();
    expect(el.querySelector('[data-testid=billing-hero]')?.textContent).not.toContain('Pix confirma na hora');
    expect(q('billing-readonly')).toBeNull();

    q('hero-pay')!.click();
    expect(externalNav.openExternal).toHaveBeenCalledWith('https://invoice.stripe.com/i/1');
    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(c.sheet()).toBeNull();
  });

  it('"Trocar cartão" on the hero opens the billing portal', () => {
    summarySignal.set(pastDueSummary());
    const { q } = renderV2();
    q('hero-card')!.click();
    expect(billing.cardUpdateUrl).toHaveBeenCalledTimes(1);
  });

  it('atrasada with Pix: "Pagar" opens a short Pix/cartão choice; each option acts at once', () => {
    summarySignal.set(pixSummary());
    const api = withPixApi();
    const { c, fixture, q } = renderV2();

    q('hero-pay')!.click();
    fixture.detectChanges();
    expect(c.sheet()).toBe('choose');
    const choice = document.querySelector('[data-testid=pay-choice]');
    expect(choice?.textContent).toContain('Confirma na hora');
    expect(choice?.textContent).toContain('Cartão');

    (document.querySelector('[data-testid=choose-pix]') as HTMLButtonElement).click();
    expect(c.sheet()).toBe('pix');
    expect(api.createInvoicePix).toHaveBeenCalledTimes(1);
    c.closePix();

    c.payNow();
    c.payByCard();
    expect(externalNav.openExternal).toHaveBeenCalledWith('https://invoice.stripe.com/i/1');
    expect(c.sheet()).toBeNull();
  });

  it('bloqueada as owner: the same "Pagar" + "Trocar cartão" pair', () => {
    summarySignal.set(pastDueSummary({ state: 'BLOCKED', graceEndsAt: serverTime(-3_600_000) }));
    const { q } = renderV2('PAST_DUE');

    expect(q('hero-pay')?.textContent?.trim()).toBe('Pagar R$ 79,90');
    expect(q('hero-pay')?.disabled).toBe(false);
    expect(q('hero-card')?.disabled).toBe(false);
  });

  it('payment group: no Pix row, with or without Pix; paying lives in the "Pagar" buttons', () => {
    summarySignal.set(pastDueSummary({ invoices: [OPEN_INVOICE] }));
    let r = renderV2();
    expect(r.q('row-pix')).toBeNull();
    expect(r.q('row-pix-off')).toBeNull();
    expect(r.el.textContent).not.toContain('Em breve');
    expect(r.q('inv-pay')?.textContent?.trim()).toBe('Pagar');
    expect(r.q('row-card')?.textContent).toContain('Trocar');
    r.fixture.destroy();

    summarySignal.set(pixSummary());
    r = renderV2();
    expect(r.q('row-pix')).toBeNull();
    expect(r.q('row-pix-off')).toBeNull();
    expect(r.q('hero-pay')).not.toBeNull();
    expect(r.el.textContent).not.toContain('Em breve');
  });

  it('the open invoice "Pagar" does exactly what the hero "Pagar" does', () => {
    summarySignal.set(pixSummary({ invoices: [OPEN_INVOICE] }));
    withPixApi();
    const { c, fixture, q } = renderV2();

    q('inv-pay')!.click();
    fixture.detectChanges();
    expect(c.sheet()).toBe('choose');
    c.closeSheet();
    fixture.destroy();

    summarySignal.set(pastDueSummary({ invoices: [OPEN_INVOICE] }));
    const noPix = renderV2();
    noPix.q('inv-pay')!.click();
    expect(noPix.c.sheet()).toBeNull();
    expect(externalNav.openExternal).toHaveBeenCalledWith('https://invoice.stripe.com/i/1');
  });

  it('cancel follows canManage, not only the subscription status', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    summarySignal.set(pastDueSummary({ state: 'ACTIVE', canManage: true, actions: ['CANCEL'] }));
    expect(buildV2().canCancel()).toBe(true);
    summarySignal.set(pastDueSummary({ state: 'ACTIVE', canManage: false, actions: [] }));
    expect(buildV2().canCancel()).toBe(false);
  });

  it('does not presume "can manage" before the summary arrives in a support session', () => {
    sessionStore.set('impersonation', '{"sessionId":"s1"}');
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = buildV2();
    expect(c.canManage()).toBe(false);
    expect(c.canCancel()).toBe(false);
  });

  for (const width of [375, 1440]) {
    it(`renders the invoices as a table AND as a list at ${width}px (the CSS shows one)`, () => {
      const prev = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.dispatchEvent(new Event('resize'));
      try {
        summarySignal.set(
          pixSummary({
            invoices: [
              { ref: 'in_3', number: 'A-3', createdAt: serverTime(-86_400_000), amountCents: 7990, status: 'OPEN', cardBrand: null, cardLast4: null, pdfUrl: null, hostedUrl: 'https://invoice.stripe.com/i/3' },
              { ref: 'in_2', number: 'A-2', createdAt: serverTime(-31 * 86_400_000), amountCents: 7990, status: 'PAID', cardBrand: 'visa', cardLast4: '4242', pdfUrl: 'https://pay.stripe.com/2.pdf', hostedUrl: null },
            ],
          }),
        );
        const fixture = TestBed.createComponent(Billing);
        (fixture.componentInstance as unknown as V2Probe).ngOnInit();
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;

        const table = el.querySelector('[data-testid=invoices-table]');
        const list = el.querySelector('[data-testid=invoices-list]');
        expect(table?.querySelectorAll('tbody tr').length).toBe(2);
        expect(list?.querySelectorAll('button.row').length).toBe(2);
        // Só a linha EM ABERTO tem "Pagar"; a paga tem o download.
        expect(table?.querySelectorAll('[data-testid=inv-pay]').length).toBe(1);
        expect(table?.querySelector('tr.open [data-testid=inv-pay]')).not.toBeNull();
        expect(table?.textContent).toContain('Em aberto');
        expect(table?.textContent).toContain('Plano Starter · mensal');
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: prev });
      }
    });
  }

  it('hero tones: em dia green, atrasada orange ring with days, bloqueada lock', () => {
    summarySignal.set(pastDueSummary({ state: 'ACTIVE', amountDueCents: null, openInvoice: null, lastFailure: null }));
    expect(buildV2().hero()).toMatchObject({ tone: 'ok', chip: { label: 'Em dia' } });

    summarySignal.set(pastDueSummary());
    expect(buildV2().hero()).toMatchObject({ tone: 'owe', ring: { value: '2', icon: null } });

    summarySignal.set(pastDueSummary({ state: 'BLOCKED', graceEndsAt: serverTime(-3_600_000) }));
    expect(buildV2().hero()).toMatchObject({ tone: 'blk', chip: { label: 'Acesso pausado' }, ring: { icon: 'lock' } });
  });

  it('offers Pix only when the server lists it, the account owes and the viewer can pay', () => {
    summarySignal.set(pastDueSummary());
    expect(buildV2().pixAvailable()).toBe(false);
    summarySignal.set(pixSummary());
    expect(buildV2().pixAvailable()).toBe(true);
    summarySignal.set(pixSummary({ state: 'ACTIVE' }));
    expect(buildV2().pixAvailable()).toBe(false);
  });

  it('Pix: opens the QR, copies it and polls every 3 s while the sheet is open', async () => {
    vi.useFakeTimers();
    try {
      summarySignal.set(pixSummary());
      const api = withPixApi();
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      const c = buildV2();
      c.openPix();

      expect(c.sheet()).toBe('pix');
      expect(api.createInvoicePix).toHaveBeenCalledTimes(1);
      expect(c.pixPhase()).toBe('qr');
      expect(c.pixCountdown()).toMatch(/^(29|30):\d{2}$/);

      await c.copyPix();
      expect(writeText).toHaveBeenCalledWith(PIX.payload);
      expect(c.pixCopied()).toBe(true);
      expect(c.pixToast()).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(api.invoicePixStatus).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(6000);
      expect(api.invoicePixStatus).toHaveBeenCalledTimes(3);

      // Fechou a folha: a consulta para.
      c.closePix();
      vi.advanceTimersByTime(30_000);
      expect(api.invoicePixStatus).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pix: never claims "copiado" when the clipboard is unavailable', async () => {
    summarySignal.set(pixSummary());
    withPixApi();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const c = buildV2();
    c.openPix();
    await c.copyPix();
    expect(c.pixCopied()).toBe(false);
  });

  it('Pix: SETTLED with access released → confirmed screen, polling stops, hero turns "pago"', () => {
    vi.useFakeTimers();
    try {
      summarySignal.set(pixSummary());
      const api = withPixApi([pixStatus('SETTLED', true)]);
      const c = buildV2();
      c.ngOnInit();
      c.openPix();

      // O resumo seguinte já vem em dia — é o que a confirmação dispara.
      summarySignal.set(pixSummary({ state: 'ACTIVE', amountDueCents: null, openInvoice: null, lastFailure: null }));
      vi.advanceTimersByTime(3000);

      expect(c.pixPhase()).toBe('paid');
      expect(c.sheet()).toBe('pix');
      expect(c.paidReceipt()).toMatchObject({ method: 'Pix', viaPix: true });
      expect(c.hero()?.tone).toBe('paid');
      const calls = api.invoicePixStatus.mock.calls.length;
      vi.advanceTimersByTime(30_000);
      expect(api.invoicePixStatus.mock.calls.length).toBe(calls);
      c.ngOnDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pix: the summary turns ACTIVE before the Pix poll (owner back from the bank app) — the receipt still says Pix', () => {
    summarySignal.set(pixSummary());
    const api = withPixApi([pixStatus('SETTLED', true)]);
    const c = build() as unknown as V2Probe & { revalidate(): void };
    c.ngOnInit();
    c.openPix();
    summarySignal.set(pixSummary({ state: 'ACTIVE', amountDueCents: null, openInvoice: null, lastFailure: null }));
    c.revalidate();

    expect(api.invoicePixStatus).toHaveBeenCalled();
    expect(c.pixPhase()).toBe('paid');
    expect(c.sheet()).toBe('pix');
    expect(c.paidReceipt()).toMatchObject({ method: 'Pix', viaPix: true });
    c.ngOnDestroy();
  });

  it('Pix: SETTLED but access not back yet keeps polling ("liberando o acesso")', () => {
    vi.useFakeTimers();
    try {
      summarySignal.set(pixSummary());
      const api = withPixApi([pixStatus('SETTLED', false)]);
      const c = buildV2();
      c.openPix();
      vi.advanceTimersByTime(3000);
      expect(c.pixPhase()).toBe('releasing');
      vi.advanceTimersByTime(6000);
      expect(api.invoicePixStatus).toHaveBeenCalledTimes(3);
      c.closePix();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pix: REFUNDED (invoice paid elsewhere) shows the refund, never a confirmation', () => {
    vi.useFakeTimers();
    try {
      summarySignal.set(pixSummary());
      const api = withPixApi([pixStatus('REFUNDED')]);
      const c = buildV2();
      c.openPix();
      vi.advanceTimersByTime(3000);
      expect(c.pixPhase()).toBe('refunded');
      vi.advanceTimersByTime(30_000);
      expect(api.invoicePixStatus).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pix: local expiry → "Código expirado", polling stops, "Gerar novo código" asks again', () => {
    vi.useFakeTimers();
    try {
      summarySignal.set(pixSummary());
      const api = withPixApi();
      api.createInvoicePix.mockReturnValueOnce(
        of({ ...PIX, expiresAt: new Date(Date.now() + 4_000).toISOString() }),
      );
      const c = buildV2();
      c.openPix();
      expect(c.pixUrgent()).toBe(true);
      vi.advanceTimersByTime(5_000);
      expect(c.pixPhase()).toBe('expired');
      const calls = api.invoicePixStatus.mock.calls.length;
      vi.advanceTimersByTime(30_000);
      expect(api.invoicePixStatus.mock.calls.length).toBe(calls);

      c.createPix();
      expect(api.createInvoicePix).toHaveBeenCalledTimes(2);
      expect(c.pixPhase()).toBe('qr');
      c.closePix();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pix: EXPIRED from the server also stops and offers a new code', () => {
    vi.useFakeTimers();
    try {
      summarySignal.set(pixSummary());
      withPixApi([pixStatus('EXPIRED')]);
      const c = buildV2();
      c.openPix();
      vi.advanceTimersByTime(3000);
      expect(c.pixPhase()).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pix: "Já paguei" asks the server right away', () => {
    summarySignal.set(pixSummary());
    const api = withPixApi();
    const c = buildV2();
    c.openPix();
    c.checkPixNow();
    expect(api.invoicePixStatus).toHaveBeenCalledWith('att-1');
    c.closePix();
  });

  it('Pix: a refused creation (409) shows the server message and stays retryable', () => {
    summarySignal.set(pixSummary());
    const api = withPixApi();
    api.createInvoicePix.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Não há fatura em aberto.' } })),
    );
    const c = buildV2() as V2Probe & { pixError(): string | null };
    c.openPix();
    expect(c.pixPhase()).toBe('error');
    expect(c.pixError()).toBe('Não há fatura em aberto.');
    c.createPix();
    expect(c.pixPhase()).toBe('qr');
    c.closePix();
  });

  it('Pix: a read-only viewer cannot open the sheet even by calling it', () => {
    summarySignal.set(pixSummary({ canManage: false, actions: [] }));
    const api = withPixApi();
    const c = buildV2();
    c.openPix();
    expect(c.sheet()).toBeNull();
    expect(api.createInvoicePix).not.toHaveBeenCalled();
  });

  for (const state of ['TRIAL_EXPIRED', 'TRIALING', 'PAST_DUE'] as const) {
    it(`help is one centred WhatsApp line, never an orphan "Precisa de ajuda?" section (${state})`, async () => {
      summarySignal.set(pastDueSummary({ state, trialEndsAt: serverTime(5 * 86_400_000) }));
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const fixture = TestBed.createComponent(Billing);
      (fixture.componentInstance as unknown as V2Probe).ngOnInit();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      expect(el.textContent).not.toContain('Precisa de ajuda?');
      expect(el.textContent).not.toContain('WhatsApp do suporte');
      const help = el.querySelectorAll('[data-testid=billing-help]');
      expect(help.length).toBe(1);
      expect(help[0].textContent).toContain('Dúvidas sobre os planos?');

      (el.querySelector('[data-testid=billing-help-wa]') as HTMLButtonElement).click();
      const opened = externalNav.openExternal.mock.calls.length > 0;
      if (opened) {
        expect(externalNav.openExternal.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
      } else {
        expect(navigate).toHaveBeenCalledWith(['/suporte']);
      }
    });
  }

});

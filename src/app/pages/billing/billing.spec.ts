import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
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
import { PlanResponse, SubscriptionResponse } from '../../types/billing.types';
import { PLAN_CAPACITY } from '../../utils/plan-limits';

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
  statusLabel(s: string): string;
  statusPillClass(s: string): string;
  statusDotClass(s: string): string;
  heroEyebrow(): string;
  heroPlanTitle(): string;
  heroNotice(): string | null;
  pendingPlanName(): string | null;
  blockedMessage(): string | null;
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
  formatLimit(value: number | null, planName: string): string;
  planFeatures(p: PlanResponse): readonly string[];
  hasPrioritySupport(p: PlanResponse): boolean;
  prioritySupportLabel: string;
  toggleCompare(): void;
  toggleExpanded(planId: string): void;
  cycleOptions(): readonly {
    value: string;
    activeBackground?: string;
    badge?: string;
  }[];
};

/**
 * Os DOIS únicos preenchimentos medidos para carregar texto branco
 * (`styles.css`). A string é comparada inteira de propósito: um `var(--typo)`
 * não resolve para nada, o pill ativo fica branco sobre o trilho neutro
 * (1,09:1) e nenhuma asserção de "contém linear-gradient" pegaria isso.
 */
const BRAND_DEEP_TOKEN = 'var(--brand-gradient-deep)';
const SUCCESS_DEEP_TOKEN = 'var(--success-gradient-deep)';

describe('Billing', () => {
  let subscriptionSignal: ReturnType<typeof signal<SubscriptionResponse | null>>;
  /**
   * Writable on purpose: `/plans` can fail or land late, and the free-vs-paid
   * classification must be exercised with an EMPTY plan list, not only with the
   * happy-path catalogue.
   */
  let plansSignal: ReturnType<typeof signal<PlanResponse[]>>;
  let errorSignal: ReturnType<typeof signal<string | null>>;
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
    expect(c.heroEyebrow()).toBe('Plano atual');
    expect(c.heroPlanTitle()).toBe('PRO');
    expect(c.planCtaLabel(PRO)).toBe('Plano atual');
    // …and the trial survives as an ADDITIONAL state, never as the plan.
    expect(c.statusLabel('TRIALING')).toBe('Período de teste');
    expect(c.heroNotice()).toContain('período de teste');
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

    expect(c.heroEyebrow()).toBe('Assinatura');
    expect(c.heroPlanTitle()).toBe('Nenhum plano ativo');
    expect(c.isCurrent(PRO)).toBe(false);
    expect(c.heroNotice()).toContain('pagamento');
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
    expect(c.pendingPlanName()).toBe('PRO');
  });

  it('only marks the plan as current when the subscription is ACTIVE', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));
    const c = build();

    expect(c.isCurrent(PRO)).toBe(true);
    expect(c.heroEyebrow()).toBe('Plano atual');
    expect(c.planCtaLabel(PRO)).toBe('Plano atual');
    expect(c.planCtaDisabled(PRO)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // F2 — status pill always renders, unknown statuses degrade safely
  // ---------------------------------------------------------------------------

  it('never returns an empty label/colour for an unknown status', () => {
    subscriptionSignal.set(sub({ status: 'SOMETHING_NEW' }));
    const c = build();

    expect(c.statusLabel('SOMETHING_NEW')).toBe('Status desconhecido');
    expect(c.statusPillClass('SOMETHING_NEW')).not.toBe('');
    expect(c.statusDotClass('SOMETHING_NEW')).not.toBe('');
    expect(c.heroNotice()).not.toBeNull();
  });

  it('labels TRIALING explicitly instead of hiding it', () => {
    const c = build();
    expect(c.statusLabel('TRIALING')).toBe('Período de teste');
  });

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

    expect(billing.startCheckout).toHaveBeenCalledWith('BUSINESS_MONTHLY_STRIPE', undefined);
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

  it('explains why the user was redirected here via ?reason=', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ reason: 'TRIAL_EXPIRED' }) } },
    });
    const c = build();
    c.ngOnInit();

    expect(c.blockedMessage()).toContain('período de teste terminou');
  });

  it('falls back to a generic explanation for an unknown reason', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ reason: 'WAT' }) } },
    });
    const c = build();
    c.ngOnInit();

    expect(c.blockedMessage()).not.toBeNull();
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
    expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE', undefined);
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
    expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE', undefined);
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

    expect(billing.startCheckout).toHaveBeenCalledWith('BASIC_MONTHLY_STRIPE', undefined);
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
    expect(c.heroEyebrow()).toBe('Plano gratuito');
    expect(c.heroPlanTitle()).toBe('TRIAL');
    // The pill stays visible and honest — the subscription really is active.
    expect(c.statusLabel('ACTIVE')).toBe('Ativa');
    expect(c.heroNotice()).toContain('gratuito');
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
    expect(c.heroEyebrow()).toBe('Plano atual');
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
    expect(c.heroEyebrow()).toBe('Plano gratuito');
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
    expect(billing.startCheckout).toHaveBeenCalledWith('PRO_YEARLY_STRIPE', undefined);
  });

  // ---------------------------------------------------------------------------
  // C4 — /cancel clears the pending checkout
  // ---------------------------------------------------------------------------

  it('drops the pending checkout from the UI after cancelling', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', pendingPlanCode: 'BUSINESS_MONTHLY_STRIPE' }));
    const c = build();

    expect(c.pendingPlanName()).toBe('BUSINESS');
    expect(c.planIntent(BUSINESS)).toBe('PENDING_PAYMENT');

    // The backend clears `pendingPlanCode` as part of /cancel.
    billing.cancel = vi.fn(() => {
      subscriptionSignal.set(
        sub({ status: 'ACTIVE', cancelAtPeriodEnd: true, pendingPlanCode: null }),
      );
      return of(void 0);
    });

    c.onCancelConfirmed();

    expect(c.pendingPlanName()).toBeNull();
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

  it('offers the way back to the free plan on PAST_DUE / CANCELED / EXPIRED', () => {
    const c = build();

    for (const status of ['PAST_DUE', 'UNPAID', 'PAUSED', 'CANCELED', 'EXPIRED']) {
      subscriptionSignal.set(sub({ status, currentPeriodEnd: PAST }));

      // Telling a BLOCKED user the free plan is already theirs, with the button
      // disabled, left paying again as the only exit.
      expect(c.planIntent(FREE)).toBe('DOWNGRADE');
      expect(c.planCtaLabel(FREE)).toBe('Voltar ao plano gratuito');
      expect(c.planCtaDisabled(FREE)).toBe(false);
    }
  });

  it('routes the blocked account to /downgrade and never to /checkout', () => {
    subscriptionSignal.set(sub({ status: 'EXPIRED', currentPeriodEnd: PAST }));
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
    subscriptionSignal.set(sub({ status: 'EXPIRED', currentPeriodEnd: PAST }));
    // Backend contract: CANCELED / EXPIRED apply on the spot.
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
    expect(billing.startCheckout).toHaveBeenCalledWith('BUSINESS_YEARLY_STRIPE', undefined);
  });

  it('skips the dialog for an upgrade with no paid period left to burn', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: PAST }));
    const c = build();

    c.onPlanCta(BUSINESS);

    expect(c.periodSwitchTarget()).toBeNull();
    expect(billing.startCheckout).toHaveBeenCalledWith('BUSINESS_MONTHLY_STRIPE', undefined);
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
    // The first POST is a normal admin-overridden checkout…
    expect(billing.startCheckout).toHaveBeenNthCalledWith(1, 'PRO_MONTHLY_STRIPE', 'stripe');
    // …and the user is told the retry costs nothing extra.
    expect(c.planCardError(PRO)).toContain('nada é cobrado duas vezes');

    c.onPlanCta(PRO);
    // …the retry drops the override so the backend can hand back sess_1.
    expect(billing.startCheckout).toHaveBeenNthCalledWith(2, 'PRO_MONTHLY_STRIPE', undefined);
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
    // jsdom implements no layout, so `scrollIntoView` is simply absent from the
    // prototype. Stub it so the failure path can be observed rather than crash.
    const scrollIntoView = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = scrollIntoView;
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
      // The recovery intent is unchanged by the feedback migration.
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      proto.scrollIntoView = original;
      vi.useRealTimers();
    }
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

  /**
   * Tabela comparativa de planos. A API devolve teto real em TODOS os planos —
   * inclusive no ENTERPRISE, que mesmo assim é apresentado como ilimitado
   * (decisão de produto, `utils/plan-limits.ts`).
   *
   * O fixture carrega os tetos da GERAÇÃO ATUAL, e é isso que dá valor às
   * asserções negativas daqui. Ele ficou parado em 500/1000 (V44) depois que a
   * V59 passou o ENTERPRISE para 100/300: a guarda continuava verde procurando
   * dois números que o backend não devolve mais, então a maquiagem podia
   * quebrar e vazar "100"/"300" na tela sem derrubar teste nenhum. Se a V60
   * mexer nos tetos, este par tem de andar junto com `PLAN_CAPACITY`.
   */
  describe('limites na tabela de planos', () => {
    const ENTERPRISE = plan({
      id: 'id-ent',
      code: 'ENTERPRISE_MONTHLY_STRIPE',
      name: 'ENTERPRISE',
      price: 299,
      vehicleLimit: PLAN_CAPACITY.ENTERPRISE.vehicles,
      trialDays: 0,
    });
    const PRO_V44 = plan({
      id: 'id-pro-v44',
      code: 'PRO_MONTHLY_STRIPE',
      name: 'PRO',
      price: 79.9,
      vehicleLimit: 20,
      trialDays: 0,
    });
    const TRIAL_V44 = plan({ vehicleLimit: 3 });

    it('esconde o teto real do ENTERPRISE nas células da tabela', () => {
      const c = build();

      expect(c.formatLimit(ENTERPRISE.vehicleLimit, ENTERPRISE.name)).toBe('∞');
    });

    /**
     * CONTROLE POSITIVO das asserções negativas deste bloco.
     *
     * Sem ele, "o número não aparece" é ambíguo: pode ser a maquiagem fazendo o
     * trabalho, ou pode ser que aquele número nunca fosse aparecer de qualquer
     * jeito — que é exatamente o que acontecia quando o fixture procurava os
     * tetos da V44. Aqui os MESMOS 100/300 são impressos crus assim que o nome
     * deixa de ser ENTERPRISE, o que prova que quem os suprime é a maquiagem e
     * não a ausência do dado.
     */
    it('imprime os mesmos números quando o plano não tem maquiagem', () => {
      const c = build();

      expect(c.formatLimit(PLAN_CAPACITY.ENTERPRISE.vehicles, 'PRO')).toBe(
        String(PLAN_CAPACITY.ENTERPRISE.vehicles),
      );
    });

    it('mostra os números reais de TRIAL e PRO', () => {
      const c = build();

      expect(c.formatLimit(TRIAL_V44.vehicleLimit, TRIAL_V44.name)).toBe('3');
      expect(c.formatLimit(PRO_V44.vehicleLimit, PRO_V44.name)).toBe('20');
    });

    // Sentinela da coluna: segue significando ilimitado para qualquer plano.
    it('mantém o ramo de limite nulo', () => {
      const c = build();

      expect(c.formatLimit(null, 'PRO')).toBe('∞');
    });

    it('não vaza o teto real do ENTERPRISE nos bullets do card', () => {
      const c = build();
      const features = c.planFeatures(ENTERPRISE).join(' | ');

      expect(features).toContain('veículos ilimitados');
      expect(features).not.toContain(String(PLAN_CAPACITY.ENTERPRISE.vehicles));
      // FEAT-0070: capacidade de motorista não aparece em bullet nenhum.
      expect(features).not.toContain('motorista');
    });

    /**
     * Os bullets de CAPACIDADE do PRO saem em número; a maquiagem é só do
     * ENTERPRISE. Os limites vêm da linha da API (o fixture), nunca de
     * `PLAN_CAPACITY` — esta tela é autenticada e recebe os tetos reais, e o
     * card não pode contradizer o plano que o backend vende.
     *
     * A asserção negativa é sobre as frases de FROTA, não sobre a palavra
     * "ilimitados" solta: `PLAN_FEATURES` traz "Usuários e papéis ilimitados",
     * que vale para os quatro tiers e não fala de teto de frota. Procurar a
     * palavra crua reprovava um bullet correto.
     */
    it('anuncia os tetos reais nos bullets do card PRO', () => {
      const c = build();
      const features = c.planFeatures(PRO_V44).join(' | ');

      expect(features).toContain('Até 20 veículos');
      expect(features).not.toContain('veículos ilimitados');
      // FEAT-0070: nem número nem "ilimitados" de motorista.
      expect(features).not.toContain('motorista');
    });

    /**
     * O `∞` é decisão visual e não tem leitura útil: o leitor de tela ou diz
     * "infinity" em inglês ou pula o caractere e deixa a célula muda. Cada
     * ocorrência do glifo — tabela desktop e acordeão mobile — precisa vir com
     * o glifo `aria-hidden` e um `sr-only` em português no lugar dele.
     */
    it('dá nome acessível em português a todo `∞` renderizado', () => {
      plansSignal.set([ENTERPRISE, PRO_V44]);
      const fixture = TestBed.createComponent(Billing);
      const c = fixture.componentInstance as unknown as Probe;
      fixture.detectChanges();

      // Abre a comparação (desktop + mobile) e expande o card do ENTERPRISE,
      // que é onde o acordeão materializa as células.
      c.toggleCompare();
      c.toggleExpanded(ENTERPRISE.id);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const glyphs = Array.from(host.querySelectorAll('[aria-hidden="true"]')).filter(
        (el) => el.textContent?.trim() === '∞',
      );

      // 1 na tabela desktop (veículos) e 1 no acordeão mobile. Eram 4 antes do
      // FEAT-0070, quando existia a linha de motoristas nas duas superfícies.
      expect(glyphs.length).toBe(2);
      for (const glyph of glyphs) {
        const label = glyph.nextElementSibling;
        expect(label?.classList.contains('sr-only')).toBe(true);
        expect(label?.textContent?.trim()).toBe('Ilimitado');
      }

      // O texto acessível é exclusivo do glifo: plano com teto real segue
      // anunciando o número, sem "Ilimitado" pendurado.
      const srTexts = Array.from(host.querySelectorAll('.sr-only')).map((el) =>
        el.textContent?.trim(),
      );
      expect(srTexts.filter((t) => t === 'Ilimitado').length).toBe(2);
      // O teto real de VEÍCULOS do PRO segue impresso…
      expect(host.textContent).toContain('20');
      // …e o eixo de motorista não existe mais na tela. Assertar a ausência do
      // RÓTULO, não do número: o antigo `not.toContain('40')` virou decorativo
      // quando `driverLimit` saiu do fixture, e como é substring crua sobre a
      // página inteira qualquer preço com "40" o reprovaria por acidente.
      expect(host.textContent).not.toMatch(/motorista/i);
    });
  });

  /**
   * A tabela comparativa e os CARDS ficam na mesma tela, a um scroll um do
   * outro, e chegaram a discordar: o card do ENTERPRISE prometia atendimento
   * prioritário enquanto a coluna do ENTERPRISE marcava travessão na linha de
   * suporte, porque a tabela decidia isso com `isRecommended()` (só o PRO). A
   * linha "Relatórios avançados" era pior — capacidade de software que o
   * backend não gateia em lugar nenhum.
   */
  describe('linhas qualitativas da tabela comparativa', () => {
    /**
     * Rende a tela com a comparação aberta e um plano expandido no acordeão.
     *
     * O catálogo é parametrizável porque a guarda de maquiagem lá embaixo
     * precisa de um plano com TETO REAL, e o `BUSINESS` do fixture padrão tem
     * `vehicleLimit` nulo — nele o `∞` sai do sentinela de
     * coluna, não da maquiagem.
     */
    const renderCompare = (expandPlanId: string, plans: readonly PlanResponse[] = [
      FREE,
      BASIC,
      PRO,
      BUSINESS,
    ]) => {
      plansSignal.set([...plans]);
      const fixture = TestBed.createComponent(Billing);
      const c = fixture.componentInstance as unknown as Probe;
      fixture.detectChanges();
      c.toggleCompare();
      c.toggleExpanded(expandPlanId);
      fixture.detectChanges();
      return { fixture, c, host: fixture.nativeElement as HTMLElement };
    };

    /**
     * O predicado que a tabela consulta. `BUSINESS` é o nome legado da linha
     * que hoje se chama ENTERPRISE e precisa cair no mesmo tier — era
     * exatamente o plano que levava travessão.
     */
    it('concede prioridade ao PRO e ao ENTERPRISE, e a mais ninguém', () => {
      const c = build();

      expect(c.hasPrioritySupport(PRO)).toBe(true);
      expect(c.hasPrioritySupport(BUSINESS)).toBe(true);
      expect(c.hasPrioritySupport(FREE)).toBe(false);
      expect(c.hasPrioritySupport(BASIC)).toBe(false);
    });

    /**
     * O rótulo da linha é a MESMA frase do bullet do card. Se as duas grafias
     * voltarem a divergir ("Suporte prioritário" na tabela, "Atendimento
     * prioritário no WhatsApp" no card), a tela volta a nomear a mesma entrega
     * de dois jeitos — e um deles não cita o canal.
     *
     * O card do ENTERPRISE não repete mais a frase, e isso é o desenho novo, não
     * uma regressão: os bullets passaram a mostrar só o DELTA de cada degrau, e
     * a prioridade ESTREIA no PRO. Quem a entrega ao ENTERPRISE é a linha de
     * herança. A tabela, que precisa de ✓ por coluna e não de uma lista, segue
     * marcando os dois — via `hasPrioritySupport()`, conferido logo acima.
     */
    it('rotula a linha com a mesma frase que o card imprime', () => {
      const c = build();

      expect(c.prioritySupportLabel).toBe('Atendimento prioritário no WhatsApp');
      expect(c.planFeatures(PRO)).toContain(c.prioritySupportLabel);
      expect(c.planFeatures(FREE)).not.toContain(c.prioritySupportLabel);

      // O ENTERPRISE herda em vez de reanunciar — e é a herança que a coluna ✓
      // dele está cobrindo.
      //
      // A REDAÇÃO segue o arranjo em que a grade está desenhada, não o tier. O
      // jsdom não casa com media query nenhuma, então esta suíte observa o
      // arranjo de TELEFONE, onde a escada desce e a frase aponta para baixo —
      // é o mesmo signal que inverte a ordem dos cards que escolhe a frase, de
      // propósito, para as duas não poderem divergir.
      expect(c.planFeatures(BUSINESS)).not.toContain(c.prioritySupportLabel);
      expect(c.planFeatures(BUSINESS)[0]).toBe('Tudo o que os planos abaixo têm');
      expect(c.hasPrioritySupport(BUSINESS)).toBe(true);
    });

    /**
     * A prova no DOM: coluna a coluna, na ordem em que a tabela as desenha.
     * `hasPrioritySupport()` poderia estar certo e o template continuar amarrado
     * ao gate antigo — foi assim que o bug existiu.
     */
    it('marca ✓ nas colunas do PRO e do ENTERPRISE na tabela desktop', () => {
      const { host, c } = renderCompare(BUSINESS.id);

      const rows = Array.from(host.querySelectorAll('tbody tr'));
      const row = rows.find(
        (tr) => tr.querySelector('td')?.textContent?.trim() === c.prioritySupportLabel,
      );
      expect(row, 'a linha de atendimento prioritário sumiu da tabela').toBeTruthy();

      // Uma célula por plano visível, na ORDEM DO CATÁLOGO, que a tela agora
      // impõe em vez de herdar de `GET /v1/billing/plans`:
      //
      //   [FREE→TRIAL, PRO, BUSINESS→ENTERPRISE, BASIC]
      //
      // `BASIC` fecha a fila porque não é nome do catálogo (a V59 tem TRIAL,
      // STARTER, PRO, ENTERPRISE) e `planTierOf('BASIC')` devolve `null` — é o
      // plano pago-mais-barato sintético deste fixture. Um nome que a UI não
      // reconhece vai para o fim em vez de embaralhar a escada, e continua sem
      // prioridade, que é o que se paga para ter.
      const marks = Array.from(row!.querySelectorAll('td'))
        .slice(1)
        .map((td) => td.querySelector('.sr-only')?.textContent?.trim());

      expect(marks).toEqual(['Não incluído', 'Incluído', 'Incluído', 'Não incluído']);
    });

    /**
     * Mesma asserção na superfície do telefone, que é onde a maioria dos donos
     * de frota abre esta tela. O acordeão carregava uma cópia das mesmas duas
     * linhas, com o mesmo gate errado.
     */
    it('marca ✓ no acordeão mobile do ENTERPRISE e travessão no do TRIAL', () => {
      for (const [plan, expected] of [
        [BUSINESS, 'Incluído'],
        [FREE, 'Não incluído'],
      ] as const) {
        const { host, c } = renderCompare(plan.id);

        const item = Array.from(host.querySelectorAll('li')).find(
          (li) => li.querySelector('span')?.textContent?.trim() === c.prioritySupportLabel,
        );
        expect(item, `linha de prioridade ausente no acordeão de ${plan.name}`).toBeTruthy();
        expect(item!.querySelector('.sr-only')?.textContent?.trim()).toBe(expected);
      }
    });

    /**
     * A linha que saiu de vez. Ela não pode voltar por nenhuma das duas
     * superfícies: é função de software anunciada por tier, e o backend só
     * aplica `vehicle_limit` e `driver_limit`.
     */
    it('não renderiza nenhuma linha de "Relatórios avançados"', () => {
      const { host } = renderCompare(BUSINESS.id);

      expect(host.textContent).not.toContain('Relatórios avançados');
      expect(host.textContent).not.toContain('Suporte prioritário');
    });

    /**
     * O ENTERPRISE continua sem número de teto — a maquiagem vale para a tabela
     * inteira, e mexer nas linhas qualitativas não pode ter reaberto o teto real
     * nas células de capacidade.
     *
     * Duas coisas estavam erradas nesta guarda e as duas a deixavam VAZIA:
     * ela procurava 500/1000 (tetos da V44, que a V59 substituiu por 100/300),
     * e renderizava o `BUSINESS`, cujos limites são nulos — ou seja, um plano
     * que nem passa pela maquiagem e cujo `∞` vem do sentinela de coluna. Duas
     * razões independentes para nunca falhar. Agora o catálogo traz um plano
     * com o NOME que a maquiagem reconhece (`UNLIMITED_FACADE_PLANS`) e o TETO
     * que o backend devolve hoje, lidos de `PLAN_CAPACITY`.
     */
    it('mantém o ENTERPRISE sem número de teto na comparação', () => {
      const ENTERPRISE_REAL = plan({
        id: 'id-ent-real',
        code: 'ENTERPRISE_MONTHLY_STRIPE',
        name: 'ENTERPRISE',
        price: 499,
        vehicleLimit: PLAN_CAPACITY.ENTERPRISE.vehicles,
        trialDays: 0,
      });
      const { host } = renderCompare(ENTERPRISE_REAL.id, [FREE, BASIC, PRO, ENTERPRISE_REAL]);

      expect(host.textContent).not.toContain(String(PLAN_CAPACITY.ENTERPRISE.vehicles));
      expect(host.textContent).toContain('∞');
    });

    /**
     * FEAT-0070 — a comparação não tem eixo de MOTORISTA: nem linha na tabela
     * desktop, nem item no acordeão mobile, nem número em lugar nenhum. O teto
     * virou guarda-corpo interno e o backend removeu `driverLimit` das
     * respostas; esta guarda é o que impede a linha de voltar por descuido.
     */
    it('não exibe capacidade de motoristas em nenhuma superfície da comparação', () => {
      const { host } = renderCompare(PRO.id, [FREE, BASIC, PRO]);

      const linhas = Array.from(host.querySelectorAll('tr')).map((tr) => tr.textContent ?? '');
      expect(linhas.some((linha) => linha.includes('Veículos'))).toBe(true);
      expect(linhas.some((linha) => linha.includes('Motoristas'))).toBe(false);
      // Acordeão mobile: mesma ausência, mesmo template. O controle POSITIVO
      // é obrigatório aqui — sem ele, um acordeão que não materializasse
      // nenhum `li` faria a asserção de ausência passar vacuamente.
      const itens = Array.from(host.querySelectorAll('li')).map((li) => li.textContent ?? '');
      expect(itens.some((item) => item.includes('Veículos'))).toBe(true);
      expect(itens.some((item) => item.includes('Motoristas'))).toBe(false);
    });
  });

  describe('acento do toggle de ciclo', () => {
    // O `SegmentedToggle` só ecoa o acento que recebe, então a suíte DELE não
    // consegue distinguir `var(--brand-gradient-deep)` de `var(--typo)`. Aqui,
    // no consumidor, o nome do token é comparado por inteiro: se ele for
    // renomeado em `styles.css` ou digitado errado aqui, o `var()` não resolve,
    // o pill ativo fica branco sobre o trilho neutro (1,09:1) e este teste cai.
    it('pinta os pills com os tokens de gradiente medidos, e não com hex solto', () => {
      const options = build().cycleOptions();

      expect(options.map((o) => o.value)).toEqual(['MONTHLY', 'YEARLY']);
      expect(options[0].activeBackground).toBe(BRAND_DEEP_TOKEN);
      expect(options[1].activeBackground).toBe(SUCCESS_DEEP_TOKEN);

      // Nenhum hex literal: o laranja de fora do sistema (#FF5722/#EB3F00)
      // voltar por aqui é exatamente o que esta asserção impede.
      for (const option of options) {
        expect(option.activeBackground).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    });
  });
});

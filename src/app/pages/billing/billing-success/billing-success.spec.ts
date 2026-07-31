import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingSuccess } from './billing-success';
import { BillingService } from '../../../services/billing.service';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { SubscriptionResponse } from '../../../types/billing.types';

const sub = (over: Partial<SubscriptionResponse>): SubscriptionResponse => ({
  id: 'sub-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
  status: 'ACTIVE',
  billingCycle: 'MONTHLY',
  trialEndsAt: null,
  currentPeriodStart: '2026-07-01T00:00:00Z',
  currentPeriodEnd: '2026-08-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  externalId: null,
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
  ...over,
});

/** Exposes the component's protected surface without widening it. */
type Probe = {
  state(): string;
  checkAgain(): void;
  ngOnInit(): void;
  ngOnDestroy(): void;
};

describe('BillingSuccess', () => {
  let store: Record<string, string>;
  let subscriptionSignal: ReturnType<typeof signal<SubscriptionResponse | null>>;
  let billing: { subscription: unknown; loadSubscription: ReturnType<typeof vi.fn> };
  let access: {
    invalidate: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    isBlocked: () => boolean;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  /** Mutable per test — read lazily by the ActivatedRoute stub below. */
  let queryParams: Record<string, string>;

  const build = (): Probe =>
    TestBed.createComponent(BillingSuccess).componentInstance as unknown as Probe;

  beforeEach(() => {
    vi.useFakeTimers();
    store = {};
    queryParams = {};
    subscriptionSignal = signal<SubscriptionResponse | null>(null);
    billing = {
      subscription: subscriptionSignal.asReadonly(),
      loadSubscription: vi.fn(() => of(subscriptionSignal())),
    };
    access = { invalidate: vi.fn(), refresh: vi.fn(() => of(null)), isBlocked: () => false };
    // `events` / `createUrlTree` / `serializeUrl` are what `routerLink` in the
    // success template needs when the view actually renders.
    router = {
      navigate: vi.fn(),
      events: NEVER,
      createUrlTree: vi.fn(() => ({})),
      serializeUrl: vi.fn(() => '/dashboard'),
    } as unknown as { navigate: ReturnType<typeof vi.fn> };

    TestBed.configureTestingModule({
      providers: [
        { provide: BillingService, useValue: billing },
        { provide: BillingAccessService, useValue: access },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(queryParams);
              },
            },
          },
        },
        {
          provide: SessionService,
          useValue: {
            getItem: vi.fn((k: string) => store[k] ?? null),
            setItem: vi.fn((k: string, v: string) => void (store[k] = v)),
            removeItem: vi.fn((k: string) => void delete store[k]),
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // H1 — Stripe returns to THIS url for success AND for cancel
  // ---------------------------------------------------------------------------

  it('never declares success for a checkout the user did not complete', () => {
    // Already ACTIVE on PRO, opened a BUSINESS checkout, never completed it.
    store['billingCheckoutPending'] = 'true';
    store['billingCheckoutPlanCode'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(sub({ status: 'ACTIVE', planCode: 'PRO_MONTHLY_STRIPE' }));

    const c = build();
    c.ngOnInit();

    expect(c.state()).not.toBe('active');
    expect(router.navigate).not.toHaveBeenCalled();

    // Money is involved: a verdict at ~4s would have been reached while a real
    // Stripe payment was still settling.
    vi.advanceTimersByTime(6000);
    expect(c.state()).toBe('polling');

    vi.advanceTimersByTime(10000);
    expect(c.state()).toBe('unconfirmed');

    c.ngOnDestroy();
  });

  it('keeps the unconfirmed verdict recoverable — the marker survives', () => {
    store['billingCheckoutPending'] = 'true';
    store['billingCheckoutPlanCode'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(sub({ status: 'ACTIVE', planCode: 'PRO_MONTHLY_STRIPE' }));

    const c = build();
    c.ngOnInit();
    vi.advanceTimersByTime(16000);
    expect(c.state()).toBe('unconfirmed');

    // The plan code must NOT have been thrown away: a late webhook has to be
    // recognisable on "verificar novamente" and on a plain reload.
    expect(store['billingCheckoutPlanCode']).toBe('BUSINESS_MONTHLY_STRIPE');

    // Payment lands late → checking again turns the page into a success.
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'BUSINESS_MONTHLY_STRIPE', planName: 'BUSINESS' }),
    );
    c.checkAgain();

    expect(c.state()).toBe('active');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);

    c.ngOnDestroy();
  });

  it('recovers from the timeout state through the same escape hatch', () => {
    store['billingCheckoutPlanCode'] = 'BUSINESS_MONTHLY_STRIPE';
    // Nothing ACTIVE yet: neither confirmed nor "unconfirmed" — just slow.
    subscriptionSignal.set(sub({ status: 'PENDING', planCode: 'BUSINESS_MONTHLY_STRIPE' }));

    const c = build();
    c.ngOnInit();
    vi.advanceTimersByTime(31000);
    expect(c.state()).toBe('timeout');

    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'BUSINESS_MONTHLY_STRIPE', planName: 'BUSINESS' }),
    );
    c.checkAgain();
    expect(c.state()).toBe('active');

    c.ngOnDestroy();
  });

  // ---------------------------------------------------------------------------
  // R4/H2 — sessionStorage is PER TAB, and mobile Stripe often returns in
  // another tab / an external browser. `?plan=` is what reaches that cohort.
  // ---------------------------------------------------------------------------

  it('uses ?plan= as the primary proof-of-target, with no sessionStorage at all', () => {
    queryParams['plan'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'BUSINESS_MONTHLY_STRIPE', planName: 'BUSINESS' }),
    );

    const c = build();
    c.ngOnInit();

    expect(c.state()).toBe('active');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);

    c.ngOnDestroy();
  });

  it('prefers ?plan= over a stale per-tab marker', () => {
    // A previous, abandoned checkout left PRO behind; this round-trip is for
    // BUSINESS. The query string is the newer, authoritative hint.
    store['billingCheckoutPlanCode'] = 'PRO_MONTHLY_STRIPE';
    queryParams['plan'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(sub({ status: 'ACTIVE', planCode: 'PRO_MONTHLY_STRIPE' }));

    const c = build();
    c.ngOnInit();

    // Would have been a false "active" had the stale marker won.
    expect(c.state()).not.toBe('active');
    expect(router.navigate).not.toHaveBeenCalled();

    c.ngOnDestroy();
  });

  it('falls back to the sessionStorage marker when ?plan= is absent', () => {
    // Checkout started before the backend appended the parameter.
    store['billingCheckoutPlanCode'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'BUSINESS_MONTHLY_STRIPE', planName: 'BUSINESS' }),
    );

    const c = build();
    c.ngOnInit();

    expect(c.state()).toBe('active');

    c.ngOnDestroy();
  });

  it('says "unknown" — not success, not cancel — with neither ?plan= nor marker', () => {
    subscriptionSignal.set(sub({ status: 'ACTIVE', planCode: 'PRO_MONTHLY_STRIPE' }));

    const c = build();
    c.ngOnInit();

    expect(c.state()).toBe('unknown');
    expect(router.navigate).not.toHaveBeenCalled();
    // No point spinning: it never hardens into a claim about the money either.
    vi.advanceTimersByTime(31000);
    expect(c.state()).toBe('unknown');

    c.ngOnDestroy();
  });

  it('does NOT congratulate a recent renewer who abandoned an upgrade', () => {
    // THE case the 15-minute `currentPeriodStart` heuristic got wrong: renewed
    // moments ago on PRO, opened a BUSINESS checkout, backed out. Stripe's
    // cancel_url returns HERE, without `?plan=`.
    subscriptionSignal.set(
      sub({
        status: 'ACTIVE',
        planCode: 'PRO_MONTHLY_STRIPE',
        planName: 'PRO',
        currentPeriodStart: new Date().toISOString(),
      }),
    );

    const c = build();
    c.ngOnInit();

    expect(c.state()).toBe('unknown');
    expect(c.state()).not.toBe('active');
    expect(router.navigate).not.toHaveBeenCalled();

    c.ngOnDestroy();
  });

  it('never claims success from ?plan= alone when the plan in force differs', () => {
    // `?plan=` is client-supplied and forgeable — it selects what to COMPARE,
    // it never grants anything.
    queryParams['plan'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'FREE_STRIPE', planName: 'FREE' }),
    );

    const c = build();
    c.ngOnInit();

    expect(c.state()).not.toBe('active');
    vi.advanceTimersByTime(16000);
    expect(c.state()).toBe('unconfirmed');

    c.ngOnDestroy();
  });

  it('declares success only when the checkout plan is the plan in force', () => {
    store['billingCheckoutPending'] = 'true';
    store['billingCheckoutPlanCode'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'BUSINESS_MONTHLY_STRIPE', planName: 'BUSINESS' }),
    );

    const c = build();
    c.ngOnInit();

    expect(c.state()).toBe('active');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);

    c.ngOnDestroy();
  });

  it('keeps waiting while the backend still reports a pending checkout', () => {
    store['billingCheckoutPending'] = 'true';
    store['billingCheckoutPlanCode'] = 'BUSINESS_MONTHLY_STRIPE';
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', pendingPlanCode: 'BUSINESS_MONTHLY_STRIPE' }),
    );

    const c = build();
    c.ngOnInit();

    vi.advanceTimersByTime(6000);
    expect(c.state()).toBe('polling');

    // Webhook lands mid-flight → success, without a page reload.
    subscriptionSignal.set(
      sub({ status: 'ACTIVE', planCode: 'BUSINESS_MONTHLY_STRIPE', pendingPlanCode: null }),
    );
    vi.advanceTimersByTime(2000);
    expect(c.state()).toBe('active');

    c.ngOnDestroy();
  });

  // ---------------------------------------------------------------------------
  // M1 — the gateway always returns here, so the marker dies here
  // ---------------------------------------------------------------------------

  it('clears the same-tab checkout marker on entry', () => {
    store['billingCheckoutPending'] = 'true';
    store['billingCheckoutPlanCode'] = 'PRO_MONTHLY_STRIPE';
    subscriptionSignal.set(sub({ status: 'ACTIVE' }));

    const c = build();
    c.ngOnInit();

    expect(store['billingCheckoutPending']).toBeUndefined();

    c.ngOnDestroy();
  });
});

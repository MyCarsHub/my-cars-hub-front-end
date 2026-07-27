import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Profile } from './profile';
import { AuthService } from '../../services/auth.service';
import { BillingService } from '../../services/billing.service';
import { SessionService } from '../../services/session.service';
import { PlanResponse, SubscriptionResponse } from '../../types/billing.types';

const plan = (over: Partial<PlanResponse>): PlanResponse => ({
  id: 'id-free',
  code: 'FREE_MONTHLY_STRIPE',
  name: 'TRIAL',
  period: 'MONTHLY',
  price: 0,
  vehicleLimit: 2,
  driverLimit: 3,
  trialDays: 7,
  productExternalId: null,
  gateway: 'stripe',
  ...over,
});

const FREE = plan({});
const PRO = plan({ id: 'id-pro', code: 'PRO_MONTHLY_STRIPE', name: 'PRO', price: 199 });

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

/** Exposes the component's protected surface without widening the component. */
type Probe = {
  isFreeActive(): boolean;
  planEyebrow(): string;
  billingStatusTone(s: SubscriptionResponse): 'healthy' | 'neutral' | 'problem';
};

describe('Profile — free vs paid classification', () => {
  let plansSignal: ReturnType<typeof signal<PlanResponse[]>>;
  let subscriptionSignal: ReturnType<typeof signal<SubscriptionResponse | null>>;

  const build = (): Probe =>
    TestBed.createComponent(Profile).componentInstance as unknown as Probe;

  beforeEach(() => {
    plansSignal = signal<PlanResponse[]>([FREE, PRO]);
    subscriptionSignal = signal<SubscriptionResponse | null>(null);

    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: vi.fn(() => of({ document: null })) } },
        {
          provide: BillingService,
          useValue: {
            plans: plansSignal.asReadonly(),
            subscription: subscriptionSignal.asReadonly(),
            loadPlans: vi.fn(() => of([FREE, PRO])),
            loadSubscription: vi.fn(() => of(subscriptionSignal())),
          },
        },
        {
          provide: SessionService,
          useValue: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
        },
        { provide: AuthService, useValue: { logout: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      ],
    });
  });

  it('does NOT label a paid subscription as free when /plans never loaded', () => {
    // Same gap as `/billing`: no plan row + a null period end. Guessing "free"
    // here told a paying customer "Plano gratuito / Sem cobrança".
    plansSignal.set([]);
    subscriptionSignal.set(sub({ status: 'ACTIVE', currentPeriodEnd: null }));
    const c = build();

    expect(c.isFreeActive()).toBe(false);
    expect(c.planEyebrow()).toBe('Plano atual');
  });

  it('labels the real free plan as free once its zero-priced row is known', () => {
    const free = sub({
      status: 'ACTIVE',
      planCode: 'FREE_MONTHLY_STRIPE',
      planName: 'TRIAL',
      currentPeriodEnd: null,
      currentPeriodStart: null,
    });
    subscriptionSignal.set(free);
    const c = build();

    expect(c.isFreeActive()).toBe(true);
    expect(c.planEyebrow()).toBe('Plano gratuito');
    // Free is not a problem, but it is not a paid subscription in force either.
    expect(c.billingStatusTone(free)).toBe('neutral');
  });

  it('keeps a paid ACTIVE plan green and paid when the catalogue is loaded', () => {
    const paid = sub({ status: 'ACTIVE' });
    subscriptionSignal.set(paid);
    const c = build();

    expect(c.isFreeActive()).toBe(false);
    expect(c.planEyebrow()).toBe('Plano atual');
    expect(c.billingStatusTone(paid)).toBe('healthy');
  });
});

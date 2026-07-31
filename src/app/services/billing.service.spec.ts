import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService, isFreePlanInForce } from './billing.service';
import { BillingAccessService } from './billing-access.service';
import {
  PlanResponse,
  SubscriptionChangeResponse,
  SubscriptionResponse,
} from '../types/billing.types';

const subscription: SubscriptionResponse = {
  id: 'sub-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
  status: 'ACTIVE',
  billingCycle: 'MONTHLY',
  trialEndsAt: null,
  currentPeriodStart: '2026-07-01T00:00:00Z',
  currentPeriodEnd: '2026-08-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  externalId: 'ext-1',
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
};

const change: SubscriptionChangeResponse = {
  outcome: 'SCHEDULED',
  currentPlanCode: 'PRO_MONTHLY_STRIPE',
  targetPlanCode: 'TRIAL_MONTHLY_STRIPE',
  effectiveAt: '2026-08-01T00:00:00Z',
  message: 'Mudança agendada.',
};

const planRow = (over: Partial<PlanResponse>): PlanResponse => ({
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

const FREE_ROW = planRow({});
const PRO_ROW = planRow({ id: 'id-pro', code: 'PRO_MONTHLY_STRIPE', name: 'PRO', price: 199 });

/**
 * The rule that decides whether a customer sees "Cancelar assinatura". Only a
 * plan row that EXISTS and costs zero may classify a subscription as free —
 * absence of data must always resolve to PAID.
 */
describe('isFreePlanInForce', () => {
  it('classifies as free only with a zero-priced row (positive evidence)', () => {
    const freeSub = { ...subscription, planCode: 'FREE_MONTHLY_STRIPE', planName: 'TRIAL' };
    expect(isFreePlanInForce(freeSub, [FREE_ROW, PRO_ROW])).toBe(true);
    expect(isFreePlanInForce(subscription, [FREE_ROW, PRO_ROW])).toBe(false);
  });

  it('never infers "free" from a missing plan row, whatever the period end', () => {
    // `/plans` empty or still in flight. Both period-end shapes must resolve to
    // PAID: a null one is what used to hide the cancel button.
    expect(isFreePlanInForce({ ...subscription, currentPeriodEnd: null }, [])).toBe(false);
    expect(isFreePlanInForce(subscription, [])).toBe(false);
    // Even the free plan CODE is not enough without its row — the price is.
    const freeSub = { ...subscription, planCode: 'FREE_MONTHLY_STRIPE', currentPeriodEnd: null };
    expect(isFreePlanInForce(freeSub, [])).toBe(false);
  });

  it('is false for anything that is not ACTIVE', () => {
    const trialing: SubscriptionResponse = { ...subscription, status: 'TRIALING' };
    expect(isFreePlanInForce(trialing, [FREE_ROW, PRO_ROW])).toBe(false);
    expect(isFreePlanInForce(null, [FREE_ROW])).toBe(false);
  });
});

describe('BillingService', () => {
  let httpPost: ReturnType<typeof vi.fn>;
  let httpGet: ReturnType<typeof vi.fn>;
  let invalidate: ReturnType<typeof vi.fn>;
  let service: BillingService;

  beforeEach(() => {
    httpPost = vi.fn();
    httpGet = vi.fn(() => of(subscription));
    invalidate = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        BillingService,
        { provide: HttpClient, useValue: { post: httpPost, get: httpGet } },
        { provide: BillingAccessService, useValue: { invalidate } },
      ],
    });
    service = TestBed.inject(BillingService);
  });

  const postedUrls = (): string[] => httpPost.mock.calls.map((c) => String(c[0]));

  describe('downgrade', () => {
    it('posts to /downgrade and NEVER to /checkout', () => {
      httpPost.mockReturnValue(of(change));

      service.downgrade('TRIAL_MONTHLY_STRIPE').subscribe();

      expect(postedUrls().some((u) => u.endsWith('/billing/downgrade'))).toBe(true);
      expect(postedUrls().some((u) => u.includes('/checkout'))).toBe(false);
      expect(httpPost.mock.calls[0][1]).toEqual({ planCode: 'TRIAL_MONTHLY_STRIPE' });
    });

    it('sends an empty body when no plan code is given (back to free)', () => {
      httpPost.mockReturnValue(of(change));
      service.downgrade().subscribe();
      expect(httpPost.mock.calls[0][1]).toEqual({});
    });

    it('invalidates the access cache and re-reads the subscription', () => {
      httpPost.mockReturnValue(of(change));

      service.downgrade('TRIAL_MONTHLY_STRIPE').subscribe();

      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(httpGet).toHaveBeenCalledTimes(1);
      expect(service.subscription()).toEqual(subscription);
    });

    it('surfaces the backend {message} on 400', () => {
      httpPost.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'Use o checkout para fazer upgrade.' },
            }),
        ),
      );

      service.downgrade('PRO_MONTHLY_STRIPE').subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Use o checkout para fazer upgrade.');
    });
  });

  describe('reactivate', () => {
    it('posts to /reactivate with no body and invalidates the cache', () => {
      httpPost.mockReturnValue(of({ ...change, outcome: 'REACTIVATED' }));

      service.reactivate().subscribe();

      expect(postedUrls().some((u) => u.endsWith('/billing/reactivate'))).toBe(true);
      expect(postedUrls().some((u) => u.includes('/checkout'))).toBe(false);
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('surfaces the backend message when the period already expired', () => {
      httpPost.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { message: 'Período já vencido.' } }),
        ),
      );

      service.reactivate().subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Período já vencido.');
    });
  });

  describe('cancel', () => {
    it('does NOT write cancelAtPeriodEnd optimistically', () => {
      httpPost.mockReturnValue(of(''));
      // Seed the signal through a normal load.
      service.loadSubscription().subscribe();
      expect(service.subscription()?.cancelAtPeriodEnd).toBe(false);

      service.cancel().subscribe();

      // Still false: only a re-read from the backend may flip it.
      expect(service.subscription()?.cancelAtPeriodEnd).toBe(false);
      expect(invalidate).toHaveBeenCalled();
    });
  });

  describe('startCheckout', () => {
    it('invalidates the access cache when a checkout is started', () => {
      httpPost.mockReturnValue(of({ redirectUrl: 'https://pay.example', externalId: 'x' }));
      service.startCheckout('PRO_MONTHLY_STRIPE').subscribe();
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });
});

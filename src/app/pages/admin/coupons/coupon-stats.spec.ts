import { describe, expect, it } from 'vitest';
import { AdminCoupon } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { computeCouponStats, monthlyPriceByPlan } from './coupon-stats';

const NOW = new Date('2026-11-04T12:00:00Z');

const BASE: AdminCoupon = {
  couponId: 'c',
  mode: 'PROMOTION_CODE',
  status: 'ACTIVE',
  companyId: 'co',
  planCode: 'PRO_MONTHLY_STRIPE',
  amountOffCents: 5000,
  percentOff: null,
  durationMonths: 1,
  timesRedeemed: 0,
  promotionCode: 'MCH-1',
  expiresAt: '2099-01-01T00:00:00',
  createdAt: '2026-10-01T00:00:00',
};

const PRICES = { PRO_MONTHLY_STRIPE: 15000 };

describe('computeCouponStats', () => {
  it('sem cupons, tudo zero', () => {
    expect(computeCouponStats([], NOW, PRICES)).toEqual({
      total: 0,
      live: 0,
      activeCodes: 0,
      expiringSoon: 0,
      exhausted: 0,
      uses: 0,
      discountCents: 0,
      monthsGranted: 0,
      skippedNoPrice: 0,
    });
  });

  it('desconto de um mês só: valor x usos', () => {
    const s = computeCouponStats(
      [{ ...BASE, mode: 'OPEN_CODE', timesRedeemed: 3, maxRedemptions: 10, companyId: null }],
      NOW,
      PRICES,
    );
    expect(s.uses).toBe(3);
    expect(s.discountCents).toBe(15000);
    expect(s.monthsGranted).toBe(3);
  });

  it('vários meses multiplicam: valor x meses x usos', () => {
    const s = computeCouponStats(
      [{ ...BASE, mode: 'OPEN_CODE', durationMonths: 3, timesRedeemed: 2, maxRedemptions: 5, companyId: null }],
      NOW,
      PRICES,
    );
    expect(s.discountCents).toBe(30000);
    expect(s.monthsGranted).toBe(6);
  });

  it('porcentagem usa o preço mensal do plano', () => {
    const s = computeCouponStats(
      [{ ...BASE, amountOffCents: null, percentOff: 20, durationMonths: 2, mode: 'APPLIED_TO_SUBSCRIPTION', promotionCode: null }],
      NOW,
      PRICES,
    );
    expect(s.uses).toBe(1);
    expect(s.discountCents).toBe(6000);
  });

  it('porcentagem sem preço do plano fica fora da estimativa e é contada', () => {
    const s = computeCouponStats(
      [{ ...BASE, amountOffCents: null, percentOff: 20, timesRedeemed: 1, planCode: 'X_MONTHLY_STRIPE' }],
      NOW,
      PRICES,
    );
    expect(s.discountCents).toBe(0);
    expect(s.skippedNoPrice).toBe(1);
    expect(s.uses).toBe(1);
  });

  it('código sem uso não precisa de preço e não conta como pulado', () => {
    const s = computeCouponStats([{ ...BASE, amountOffCents: null, percentOff: 20, planCode: null }], NOW, {});
    expect(s.skippedNoPrice).toBe(0);
    expect(s.uses).toBe(0);
  });

  it('desconto direto desativado não conta uso', () => {
    const s = computeCouponStats(
      [{ ...BASE, mode: 'APPLIED_TO_SUBSCRIPTION', promotionCode: null, status: 'DEACTIVATED' }],
      NOW,
      PRICES,
    );
    expect(s.uses).toBe(0);
    expect(s.discountCents).toBe(0);
  });

  it('códigos ativos, a vencer em 7 dias e esgotados', () => {
    const s = computeCouponStats(
      [
        BASE,
        { ...BASE, couponId: 'b', expiresAt: '2026-11-08T00:00:00' },
        { ...BASE, couponId: 'c2', timesRedeemed: 1 },
        { ...BASE, couponId: 'd', status: 'DEACTIVATED' },
      ],
      NOW,
      PRICES,
    );
    expect(s.total).toBe(4);
    expect(s.activeCodes).toBe(2);
    expect(s.expiringSoon).toBe(1);
    expect(s.exhausted).toBe(1);
  });
});

describe('monthlyPriceByPlan', () => {
  it('anual vira 1/12 e plano sem preço sai', () => {
    const plans = [
      { code: 'A', price: 100, period: 'MONTHLY' },
      { code: 'B', price: 1200, period: 'YEARLY' },
      { code: 'C', price: 0, period: 'MONTHLY' },
    ] as unknown as PlanResponse[];
    expect(monthlyPriceByPlan(plans)).toEqual({ A: 10000, B: 10000 });
  });
});

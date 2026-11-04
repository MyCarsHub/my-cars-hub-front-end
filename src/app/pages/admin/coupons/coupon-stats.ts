import { AdminCoupon } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { parseServerTime } from '../../../utils/server-time';
import { couponStatus } from './coupon-copy';

const DAY_MS = 86_400_000;

/** Janela do aviso "vencem em breve". */
export const EXPIRING_DAYS = 7;

export interface CouponStats {
  total: number;
  /** Cupons de qualquer tipo que ainda funcionam. */
  live: number;
  /** Códigos (qualquer pessoa ou de empresa) que ainda podem ser usados. */
  activeCodes: number;
  /** Códigos ativos que vencem dentro de `EXPIRING_DAYS`. */
  expiringSoon: number;
  /** Códigos esgotados ou já usados. */
  exhausted: number;
  /** Códigos resgatados + descontos aplicados direto na assinatura. */
  uses: number;
  /** ESTIMATIVA em centavos: valor por mês x meses contratados x usos. Nunca é um total exato. */
  discountCents: number;
  /** Soma de meses de desconto contratados (duração x usos). */
  monthsGranted: number;
  /** Cupons por porcentagem que tiveram uso, mas cujo plano não tem preço conhecido: ficaram fora da estimativa. */
  skippedNoPrice: number;
}

/** Preço mensal em centavos por código de plano; plano anual conta 1/12 do preço. */
export function monthlyPriceByPlan(plans: readonly PlanResponse[]): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const plan of plans) {
    if (!plan.code || !(plan.price > 0)) continue;
    const months = plan.period === 'YEARLY' ? 12 : 1;
    prices[plan.code] = Math.round((plan.price * 100) / months);
  }
  return prices;
}

/**
 * Números do topo da página, calculados só do que a lista já traz. O desconto é uma
 * ESTIMATIVA: o servidor não diz quanto cada resgate descontou de fato.
 */
export function computeCouponStats(
  coupons: readonly AdminCoupon[],
  now: Date,
  monthlyPrices: Readonly<Record<string, number>>,
): CouponStats {
  const stats: CouponStats = {
    total: coupons.length,
    live: 0,
    activeCodes: 0,
    expiringSoon: 0,
    exhausted: 0,
    uses: 0,
    discountCents: 0,
    monthsGranted: 0,
    skippedNoPrice: 0,
  };
  for (const coupon of coupons) {
    const status = couponStatus(coupon, now);
    const isCode = coupon.mode !== 'APPLIED_TO_SUBSCRIPTION';
    if (status.live) stats.live++;
    if (isCode && status.live) {
      stats.activeCodes++;
      const expires = parseServerTime(coupon.expiresAt);
      if (expires && expires.getTime() - now.getTime() <= EXPIRING_DAYS * DAY_MS) stats.expiringSoon++;
    }
    if (isCode && (status.label === 'Esgotado' || status.label === 'Usado')) stats.exhausted++;

    const uses = isCode ? Math.max(coupon.timesRedeemed ?? 0, 0) : coupon.status === 'ACTIVE' ? 1 : 0;
    stats.uses += uses;
    if (uses === 0) continue;

    const months = Math.max(coupon.durationMonths ?? 1, 1) * uses;
    let perMonth: number | null = null;
    if (coupon.amountOffCents !== null) {
      perMonth = coupon.amountOffCents;
    } else if (coupon.percentOff !== null) {
      const price = coupon.planCode ? monthlyPrices[coupon.planCode] : undefined;
      perMonth = price ? Math.round((price * coupon.percentOff) / 100) : null;
    }
    if (perMonth === null) {
      stats.skippedNoPrice++;
      continue;
    }
    stats.discountCents += perMonth * months;
    stats.monthsGranted += months;
  }
  return stats;
}

import { AdminCoupon } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { formatBRL } from '../../../types/dashboard.types';
import { planTierOf } from '../../../utils/plan-features';
import { PLAN_COPY } from '../../../utils/plan-grid-copy';
import { ALL_PLANS_TIERS, isAllPlans } from './coupon-copy';

/** Um preço de um plano num período, com e sem o cupom. */
export interface PlanPrice {
  planCode: string;
  planName: string;
  period: string;
  listCents: number;
  discountedCents: number;
}

export interface PriceCell {
  /** "R$ 63,92" */
  price: string;
  /** "era R$ 79,90" */
  was: string;
}

/** Uma linha de "Quanto cada plano paga": o plano, o mensal e o anual. */
export interface PlanPriceRow {
  name: string;
  monthly: PriceCell | null;
  yearly: PriceCell | null;
}

const brl = (cents: number): string => formatBRL(Math.round(cents)).replace(/\u00A0/g, ' ');

/** "Pro", a partir do nome ou do código do plano. */
function tierName(planName: string, planCode: string): string {
  const tier = planTierOf(planName) ?? planTierOf(planCode.split('_')[0]);
  return tier ? PLAN_COPY[tier].name : planName;
}

/** Agrupa por plano, na ordem em que chegam (do mais barato), com o mensal e o anual lado a lado. */
export function planPriceRows(prices: readonly PlanPrice[]): PlanPriceRow[] {
  const rows = new Map<string, PlanPriceRow>();
  for (const item of prices) {
    const name = tierName(item.planName, item.planCode);
    const row = rows.get(name) ?? { name, monthly: null, yearly: null };
    const cell = { price: brl(item.discountedCents), was: `era ${brl(item.listCents)}` };
    if (item.period === 'YEARLY') row.yearly = cell;
    else row.monthly = cell;
    rows.set(name, row);
  }
  return [...rows.values()];
}

/** O preço com o cupom: percentual sobre o preço, valor fixo descontado, nunca abaixo de zero. */
export function discountedCents(listCents: number, coupon: Pick<AdminCoupon, 'amountOffCents' | 'percentOff'>): number {
  if (coupon.percentOff !== null) return Math.round((listCents * (100 - coupon.percentOff)) / 100);
  if (coupon.amountOffCents !== null) return Math.max(listCents - coupon.amountOffCents, 0);
  return listCents;
}

/**
 * Os planos que o cupom cobre, lidos da tabela de planos. Usa `planCodes` quando o
 * servidor manda; num cupom antigo de todos os planos, os planos pagos STARTER, PRO e SCALE.
 */
export function coveredPlans(
  coupon: Pick<AdminCoupon, 'planCode'> & Partial<Pick<AdminCoupon, 'allPlans' | 'planCodes'>>,
  plans: readonly PlanResponse[],
): PlanResponse[] {
  const codes = coupon.planCodes?.length ? coupon.planCodes : null;
  const all = isAllPlans(coupon);
  return plans
    .filter((plan) => plan.price > 0)
    .filter((plan) =>
      codes
        ? codes.includes(plan.code)
        : all
          ? (ALL_PLANS_TIERS as readonly string[]).includes(planTierOf(plan.name) ?? '') && plan.gateway === 'stripe'
          : plan.code === coupon.planCode,
    )
    .sort((a, b) => a.price - b.price);
}

/** "Quanto cada plano paga com o cupom", calculado da tabela de planos (o detalhe não tem prévia). */
export function couponPriceRows(
  coupon: Pick<AdminCoupon, 'planCode' | 'amountOffCents' | 'percentOff'> &
    Partial<Pick<AdminCoupon, 'allPlans' | 'planCodes'>>,
  plans: readonly PlanResponse[],
): PlanPriceRow[] {
  return planPriceRows(
    coveredPlans(coupon, plans).map((plan) => {
      const listCents = Math.round(plan.price * 100);
      return {
        planCode: plan.code,
        planName: plan.name,
        period: plan.period,
        listCents,
        discountedCents: discountedCents(listCents, coupon),
      };
    }),
  );
}

/**
 * "Starter R$ 15,98 · Pro R$ 29,98 · Scale R$ 59,80": quanto cada plano economiza por mês
 * com um cupom percentual de todos os planos. Valor fixo é igual em todos: não tem linha.
 */
export function monthlySavingsLine(
  coupon: Pick<AdminCoupon, 'planCode' | 'amountOffCents' | 'percentOff'> &
    Partial<Pick<AdminCoupon, 'allPlans' | 'planCodes'>>,
  plans: readonly PlanResponse[],
): string | null {
  if (!isAllPlans(coupon) || coupon.percentOff === null) return null;
  const monthly = coveredPlans(coupon, plans).filter((plan) => plan.period !== 'YEARLY');
  if (monthly.length === 0) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const plan of monthly) {
    const name = tierName(plan.name, plan.code);
    if (seen.has(name)) continue;
    seen.add(name);
    const listCents = Math.round(plan.price * 100);
    parts.push(`${name} ${brl(listCents - discountedCents(listCents, coupon))}`);
  }
  return parts.join(' · ');
}

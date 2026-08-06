/**
 * Single source of truth for the prices the landing ADVERTISES.
 *
 * Extracted from `landing-pricing.component.ts` so the JSON-LD `Product`/`Offer` blocks
 * cannot drift from the cards the visitor actually reads — a price that disagrees with
 * the page is a Google structured-data violation, not just a cosmetic bug.
 *
 * These are NOT derived from the API on purpose: `GET /v1/billing/plans` requires
 * authentication and the landing is public (see the note in `landing-pricing.component.ts`).
 */
export const PLAN_PRICES = {
  /** Free trial, no card. Duration is advertised in the card as "14 dias". */
  trialDays: 14,
  proMonthly: 79.9,
  /** PRO yearly TOTAL. Matches the billing spec target R$ 795,80/ano (~17% off). */
  proYearlyTotal: 795.8,
  enterpriseMonthly: 299,
} as const;

/** ENTERPRISE yearly total = 12 × monthly × (1 − 0.15) = 3049.80 (15% off). */
export const ENTERPRISE_YEARLY_TOTAL = PLAN_PRICES.enterpriseMonthly * 12 * 0.85;

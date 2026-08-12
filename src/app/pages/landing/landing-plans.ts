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
  /** V59 `PRO_MONTHLY_*` — 149.90. */
  proMonthly: 149.9,
  /** PRO yearly TOTAL. V59 `PRO_YEARLY_*` — 1499.00 (~17% off 12× monthly). */
  proYearlyTotal: 1499.0,
  /** V59 `ENTERPRISE_MONTHLY_*` — 299.00. */
  enterpriseMonthly: 299,
} as const;

/**
 * ENTERPRISE yearly TOTAL. V59 `ENTERPRISE_YEARLY_*` — 2990.00 (~17% off 12× monthly).
 *
 * A literal, NOT `monthly × 12 × discount`: V59 prices each (name, period) row
 * independently, so a derived figure silently advertised 3049,80 while the API charged
 * 2990,00. The number is the source of truth; the discount is a consequence of it.
 */
export const ENTERPRISE_YEARLY_TOTAL = 2990.0;

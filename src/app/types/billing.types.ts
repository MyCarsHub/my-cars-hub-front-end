/**
 * Statuses the frontend knows how to render. Anything else is still accepted
 * at runtime (see `SubscriptionStatus`) so a new backend status degrades to a
 * neutral pill instead of blanking the UI.
 *
 * `PENDING` / `INCOMPLETE` are NOT producible by the current backend — the
 * CHECK constraint of migration V8 allows only TRIALING / ACTIVE / PAST_DUE /
 * CANCELED / EXPIRED. They are kept deliberately as forward-compat: Stripe's
 * own subscription lifecycle has `incomplete`, so the day the webhook mapper
 * stops collapsing it, the UI already labels and colours it instead of falling
 * into "Status desconhecido". Cost is two dead `case` branches; the benefit is
 * never shipping an unlabelled status to a paying customer.
 */
export type KnownSubscriptionStatus =
  | 'PENDING'
  | 'INCOMPLETE'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'PAUSED'
  | 'CANCELED'
  | 'EXPIRED';

/**
 * Open union: keeps autocomplete for the known set while forcing every
 * `switch` over a status to carry a `default` branch.
 */
export type SubscriptionStatus = KnownSubscriptionStatus | (string & {});

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export type PlanPeriod = 'MONTHLY' | 'YEARLY';

export type PlanGateway = 'stripe' | 'abacate';

/**
 * Flat plan row from the backend — one row per (name, period, gateway) triple.
 * `code` is the fully qualified variant identifier (e.g. `PRO_MONTHLY_STRIPE`).
 */
export interface PlanResponse {
  id: string;
  code: string;
  name: string;
  period: PlanPeriod;
  price: number;
  vehicleLimit: number | null;
  driverLimit: number | null;
  trialDays: number;
  productExternalId: string | null;
  gateway: PlanGateway;
}

export interface SubscriptionResponse {
  id: string;
  planCode: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  externalId: string | null;
  /**
   * Checkout started but NOT paid. Must never be presented as the plan in
   * force — render it as "aguardando confirmação do pagamento" instead.
   * Optional: older backends omit it.
   */
  pendingPlanCode?: string | null;
  /** Plan the subscription drops to at the end of the paid period. */
  scheduledDowngradePlanCode?: string | null;
  /** ISO datetime when the scheduled downgrade takes effect. */
  scheduledDowngradeAt?: string | null;
}

export type GatewayOverride = PlanGateway;

export interface CheckoutRequest {
  planCode: string;
  gatewayOverride?: GatewayOverride;
}

export interface CheckoutResponse {
  redirectUrl: string;
  externalId: string;
}

/** Body of `POST /billing/downgrade`. Omit `planCode` to fall back to free. */
export interface DowngradeRequest {
  planCode?: string;
}

/**
 * `SCHEDULED` — takes effect at `effectiveAt` (end of the paid period).
 * `APPLIED`   — took effect NOW, `effectiveAt` is `null`. Only reachable from
 *               CANCELED / EXPIRED, where there is no paid period left to wait
 *               out: the account is put back on the free plan as ACTIVE
 *               immediately, which also unblocks access.
 */
export type SubscriptionChangeOutcome = 'SCHEDULED' | 'APPLIED' | 'NO_OP' | 'REACTIVATED';

/** Shared 200 shape of `POST /billing/downgrade` and `/billing/reactivate`. */
export interface SubscriptionChangeResponse {
  outcome: SubscriptionChangeOutcome;
  currentPlanCode: string | null;
  targetPlanCode: string | null;
  effectiveAt: string | null;
  message: string | null;
}

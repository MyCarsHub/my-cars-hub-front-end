export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED';

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

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED';

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface PlanResponse {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  vehicleLimit: number;
  driverLimit: number;
  trialDays: number;
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

export type GatewayOverride = 'abacate' | 'stripe';

export interface CheckoutRequest {
  planCode: string;
  billingCycle: BillingCycle;
  gatewayOverride?: GatewayOverride;
}

export interface CheckoutResponse {
  redirectUrl: string;
  externalId: string;
}

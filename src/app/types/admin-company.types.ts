/**
 * DTO shapes for the /admin/companies endpoints.
 *
 * Backend serializes Java records verbatim, so keys are exact copies of the
 * record component names on the server side. Don't invent new keys — see
 * `paged-response-shape.md`.
 */

export type AdminCompanyStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export type AdminCompanySubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED';

export interface AdminCompanyListItem {
  id: string;
  name: string;
  documentMasked: string | null;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: AdminCompanySubscriptionStatus | null;
  billingCycle: string | null;
  status: AdminCompanyStatus;
  active: boolean;
  memberCount: number;
  createdAt: string | null;
}

export interface AdminCompanySubscriptionSnapshot {
  id: string;
  planCode: string | null;
  planName: string | null;
  status: AdminCompanySubscriptionStatus | null;
  billingCycle: string | null;
  gateway: string | null;
  externalIdMasked: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean | null;
}

export interface AdminCompanyMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface AdminCompanyChargeIntegrationSnapshot {
  connected: boolean;
  provider: string | null;
  environment: string | null;
  webhookAutoConfigured: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface AdminCompanyDetail {
  id: string;
  name: string;
  documentMasked: string | null;
  status: AdminCompanyStatus;
  active: boolean;
  createdAt: string | null;
  modifiedAt: string | null;
  subscription: AdminCompanySubscriptionSnapshot | null;
  members: AdminCompanyMember[];
  chargeIntegration: AdminCompanyChargeIntegrationSnapshot | null;
}

/**
 * Contract of the NEW invite flow (backend `develop`, not yet in production):
 * `POST /v1/invites/validate|accept|accept-as-member` and `/v1/invite-onboarding/**`.
 *
 * Distinct from `invite.types.ts`, which describes the OLD `/v1/invites/validate/{token}` +
 * `/v1/invites/accept/{token}` endpoints that stay in production until this ships.
 */

/**
 * Terms version the manager accepts at onboarding step 2.
 *
 * PLACEHOLDER: no endpoint exposes the accepted version yet. The backend compares what we
 * send with its `app.invite.terms-version` property and answers `TERMS_VERSION_MISMATCH` on
 * a difference, so the two must be changed together until an endpoint publishes it.
 */
export const INVITE_TERMS_VERSION = 'v1';

export type InviteValidateState = 'PENDING' | 'EXPIRED' | 'REVOKED' | 'USED';
export type InviteAccountKind = 'NEW' | 'EXISTING';
export type InviteNext = 'MANAGER_ONBOARDING' | 'DRIVER_ONBOARDING' | 'COMPANY_HOME';

export interface InviteValidateResponse {
  state: InviteValidateState;
  companyName: string;
  roleLabel: string;
  inviteeFirstName?: string;
  /** Only present when `state` is PENDING. */
  accountKind?: InviteAccountKind;
  /** Not in the contract today; the "Convidado por" row renders only when it shows up. */
  inviterName?: string;
}

export interface InviteAcceptResponse {
  onboardingToken: string;
  role: string;
  roleLabel: string;
  companyName: string;
  next: InviteNext;
}

export interface InviteAcceptAsMemberResponse {
  accessToken: string;
  role: string;
  roleLabel: string;
  companyName: string;
  next: 'COMPANY_HOME';
}

export interface InviteOnboardingContext {
  role: string;
  roleLabel: string;
  companyName: string;
  prefill: { name: string; phoneMasked: string };
  identityEditable: boolean;
}

export interface ManagerOnboardingRequest {
  name: string;
  phone: string;
  acceptedTermsVersion: string;
}

export interface ManagerOnboardingResponse {
  accessToken: string;
}

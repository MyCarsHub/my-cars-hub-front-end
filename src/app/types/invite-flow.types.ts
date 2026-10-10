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
  /**
   * The e-mail the invite was sent to, shown in the summary so the invitee sees WHICH account
   * the invite is for. Not in the backend contract today (the anonymous route is a closed key
   * list without PII); the row renders only when it shows up, and the "this tab is already
   * signed in as the invitee" shortcut needs it.
   */
  email?: string;
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

/**
 * `POST /v1/invites/accept-as-member` answers one of two shapes, told apart by `next`:
 * - `COMPANY_HOME`: the membership is ACTIVE and `accessToken` is the company-scoped session;
 * - `DRIVER_ONBOARDING`: a DRIVER whose registration is still pending got an ONBOARDING
 *   membership and `onboardingToken` (never an access token) to finish CNH and address.
 */
export interface InviteAcceptAsMemberResponse {
  accessToken?: string;
  onboardingToken?: string;
  role: string;
  roleLabel: string;
  companyName: string;
  next: Extract<InviteNext, 'COMPANY_HOME' | 'DRIVER_ONBOARDING'>;
}

export interface InviteOnboardingContext {
  role: string;
  roleLabel: string;
  companyName: string;
  prefill: { name: string; phoneMasked: string };
  identityEditable: boolean;
  /**
   * DRIVER only: the registration is still PENDING_ONBOARDING, so the screen asks for CNH and
   * address. `false` (company completed it meanwhile) or absent on an older backend for a
   * MANAGER. Treated as "does not need" only when the backend says `false` for a DRIVER.
   */
  needsLicense?: boolean;
}

export interface ManagerOnboardingRequest {
  name: string;
  phone: string;
  acceptedTermsVersion: string;
}

export interface ManagerOnboardingResponse {
  accessToken: string;
}

export type DriverLicenseCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'AB' | 'AC' | 'AD' | 'AE';

/** Same shape as the driver form's address (the backend reuses `AddressDto`). */
export interface DriverOnboardingAddress {
  street: string;
  number: string | null;
  complement: string | null;
  district: string;
  cep: string;
  city: string;
  uf: string;
}

/** `POST /v1/invite-onboarding/driver`. Every field is optional only for a registration the company already completed. */
export interface DriverOnboardingRequest {
  licenseNumber?: string;
  licenseCategory?: DriverLicenseCategory;
  licenseExpiry?: string;
  address?: DriverOnboardingAddress;
  rg?: string;
}

export interface DriverOnboardingResponse {
  accessToken: string;
}

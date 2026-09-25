/**
 * Contract of `/v1/invites` (backend `develop @ 6d3bdb4`).
 *
 * Two properties of this contract are load-bearing and easy to get wrong:
 *
 * 1. The creation timestamp is `createDate`, **not** `createdDate` — every other
 *    resource in this app uses `createdDate`, so this one is the exception.
 * 2. `GET /v1/invites` deliberately never returns the raw token. The token exists
 *    only inside the invitation e-mail; the list screen can resend but can never
 *    rebuild the link.
 */

/** Roles an invite may grant. `OWNER` is rejected by the backend with a 400. */
import { LicenseCategory } from './driver.types';

export type InviteRole = 'MANAGER' | 'DRIVER';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';

/**
 * Body of `POST /v1/invites`. The backend lowercases `email` before storing it.
 *
 * FEAT-0167 — `name`, `cpf` and `phone` are REQUIRED when `role` is MANAGER and IGNORED
 * when DRIVER, so they are optional here and the caller decides by role. CPF and phone may
 * go masked: the backend normalizes both.
 */
export interface CreateInviteRequest {
  email: string;
  role: InviteRole;
  name?: string;
  cpf?: string;
  phone?: string;
}

/** Item of `GET /v1/invites` and body of `POST /v1/invites` (201). */
export interface InviteResponse {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  expiresAt: string;
  /** Yes, `createDate` — the backend field has no `d`. Do not "fix" this. */
  createDate: string;
}

/**
 * Body of `GET /v1/invites/validate/{rawToken}` — the only PUBLIC invite endpoint.
 * It works anonymously and tolerates a stale `Authorization` header, which is what
 * lets the accept screen render before the invitee has logged in.
 */
export interface ValidateInviteResponse {
  email: string;
  role: InviteRole;
  companyName: string;
  /** `true` when the invited e-mail already has a MyCarsHub account. */
  userExists: boolean;

  /**
   * FEAT-0167 — pre-fill for the invitee onboarding. OPTIONAL on purpose: a backend that
   * has not shipped these yet simply omits them, and the screen has to keep working.
   *
   * >>> THE CPF IS NOT HERE, AND THAT IS DELIBERATE. <<< This route is ANONYMOUS: whoever
   * holds the link reads the response. The invitee TYPES the CPF and the backend compares
   * it against the vault, so this screen cannot pre-fill it — there is nothing to pre-fill
   * from. Do not "add the missing field": its absence is the decision.
   */
  name?: string;
  phoneNumber?: string;
  /** `true` asks for the manager onboarding form before the accept call. */
  requiresManagerOnboarding?: boolean;
}

/**
 * Body of `POST /v1/invites/accept/{rawToken}` — FEAT-0167.
 *
 * Required for MANAGER; a DRIVER accept still posts NO body at all. CPF and phone may go
 * masked, the backend normalizes; `cpf` is what the backend checks against the vault, and
 * a mismatch comes back as `INVITE_CPF_MISMATCH`.
 */
export interface AcceptInviteRequest {
  name: string;
  cpf: string;
  phone: string;
}

/** Endereço do motorista no aceite — mesmos campos do cadastro manual. */
export interface InviteAddressRequest {
  street: string;
  number: string;
  complement: string;
  district: string;
  cep: string;
  city: string;
  uf: string;
}

/**
 * Corpo do aceite quando o convidado é MOTORISTA e ainda NÃO tem cadastro.
 *
 * Quem já tem cadastro continua postando SEM corpo nenhum — mandar um corpo nesse caso
 * pediria dados que o sistema já conhece.
 */
export interface DriverAcceptInviteRequest extends AcceptInviteRequest {
  licenseNumber: string;
  licenseCategory: LicenseCategory;
  licenseExpiry: string;
  address: InviteAddressRequest;
}

/**
 * Body of `POST /v1/invites/accept/{rawToken}`.
 *
 * `token` is a full ACCESS token already scoped to `companyId` — storing it is what
 * lets the invitee land straight inside the company, with no `/auth/select-company`
 * and no `/auth/me` round trip.
 */
export interface AcceptInviteResponse {
  message: string;
  token: string;
  companyId: string;
  companyName: string;
  role: InviteRole;
}

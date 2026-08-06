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
export type InviteRole = 'MANAGER' | 'DRIVER';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';

/** Body of `POST /v1/invites`. The backend lowercases `email` before storing it. */
export interface CreateInviteRequest {
  email: string;
  role: InviteRole;
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

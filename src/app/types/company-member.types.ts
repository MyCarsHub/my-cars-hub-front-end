/**
 * Contract of `/v1/companies/{companyId}/members` (backend `origin/main @ 7d59feb`).
 *
 * Two properties of this contract are deliberate and easy to "fix" wrongly:
 *
 * 1. **There is no `status` field, and that is the backend's decision.** The roster
 *    returns ACTIVE memberships only, so a status column would print the same word on
 *    every row. Whoever is still INVITED shows up in the INVITES screen, which is a
 *    different surface with a different guard. Do not add a situation column here — there
 *    is nothing to put in it.
 * 2. **There is no role-change endpoint.** The controller exposes exactly `GET` (list) and
 *    `DELETE /{userId}`. Promoting or demoting a member is not possible against this API;
 *    see `FEAT-0266` notes. Do not build a role selector that has nowhere to POST.
 */

/** Roles a membership row may carry. Same vocabulary as the token claim and the invites. */
export type CompanyMemberRole = 'OWNER' | 'MANAGER' | 'DRIVER';

/**
 * One row of `GET /v1/companies/{companyId}/members`.
 *
 * `memberSince` is `user_company_role.created_date` and survives a reactivation — the
 * re-invite upsert touches `modify_date`, never `created_date`. So it measures "since when
 * the link exists", not "since when it is active this time". The difference shows up on
 * someone who left and came back.
 */
export interface CompanyMemberResponse {
  userId: string;
  name: string;
  email: string;
  role: CompanyMemberRole;
  memberSince: string;
}

export interface CompanyOwner {
  name: string;
  email: string;
  joinedAt: string;
}

/**
 * `pendingInvites` used to live here as a hardcoded placeholder. It now comes from
 * `InvitesService.pendingCount()`, which is derived from `GET /v1/invites`.
 */
export interface CompanyStats {
  activeUsers: number;
}

/**
 * Payload of `PUT /v1/companies/me`.
 *
 * The company comes from the access token — there is deliberately no `id` here.
 *
 * `documentValue` is a CPF or a CNPJ (alphanumeric since July 2026), masked or raw, and
 * may change in any direction. Send it only when the user typed something; `null` means
 * "keep the current document". Never echo the value returned by the API back into it:
 * the response masks the document, so a round-trip would be a lie about user intent.
 */
export interface UpdateCompanyRequest {
  name: string;
  documentValue: string | null;
}

/**
 * Central source-of-truth for the PT-BR labels of **CompanyRole** — the role a
 * user holds inside a rental company (`types/user-companies.ts`).
 *
 * Every screen that renders a company role MUST read from here, so adding a
 * role means editing THIS map and nothing else. Before FIX-0395 the same rule
 * lived in six places and had already drifted: OWNER read "Dono" in the
 * sidebar and "Proprietário" in invites/profile, and the admin pages still
 * said "Gerente" for MANAGER.
 *
 * Translation is presentation ONLY: the enum, the token claim and every API
 * payload stay in English (OWNER | MANAGER | DRIVER).
 *
 * NOT the same axis as **SystemRole** (`USER | PLATFORM_ADMIN`, see
 * `types/me-response.type.ts`), which drives `admin.guard`. The two are both
 * called "role" and mean different things — do not merge them here.
 * `admin-users.ts:roleLabel()` is SystemRole-only and deliberately does not
 * consume this map.
 *
 * An unknown or empty role falls back to the RAW value instead of vanishing
 * from the screen, so a divergence with the backend stays visible.
 */
export const COMPANY_ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: 'Dono',
  MANAGER: 'Gerenciador',
  DRIVER: 'Motorista',
};

/** Label for a company role, falling back to the raw value when unknown. */
export function companyRoleLabel(role: string): string {
  return COMPANY_ROLE_LABELS[role] ?? role;
}

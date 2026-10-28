export type AdminUserSystemRole = 'USER' | 'PLATFORM_ADMIN';
export type AdminUserStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
export type AdminUserRoleFilter = 'ALL' | AdminUserSystemRole;
/** V122 — presenca: todos ou so quem esta online agora. */
export type AdminUserPresenceFilter = 'ALL' | 'ONLINE';

export interface AdminUserListItem {
  id: string;
  name: string | null;
  email: string;
  systemRole: AdminUserSystemRole;
  active: boolean;
  createdDate: string | null;
  lastCompanyName: string | null;
  /** Presenca (nao login): requisicao autenticada dentro de UserPresence.ONLINE_WINDOW no backend. */
  online?: boolean;
  /** Ultima requisicao autenticada (ISO); null = nunca visto. */
  lastSeenAt?: string | null;
  /** Admin v2 (D1) — telefone SO mascarado pelo servidor; nulo = sem telefone. */
  phoneMasked?: string | null;
}

export interface AdminUserCompanyLink {
  companyId: string;
  companyName: string;
  role: string;
  status: string;
  joinedAt: string | null;
}

export interface AdminUserDetail {
  id: string;
  name: string | null;
  email: string;
  systemRole: AdminUserSystemRole;
  active: boolean;
  createdDate: string | null;
  lastLoginAt: string | null;
  companies: AdminUserCompanyLink[];
  /** V122 — ultima requisicao autenticada (ISO); null = nunca visto desde a V122. */
  lastSeenAt?: string | null;
  /** Admin v2 (D1) — so mascarado; o numero inteiro vem da revelacao auditada (VIEW). */
  phoneMasked?: string | null;
}

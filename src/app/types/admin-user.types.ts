export type AdminUserSystemRole = 'USER' | 'PLATFORM_ADMIN';
export type AdminUserStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
export type AdminUserRoleFilter = 'ALL' | AdminUserSystemRole;

export interface AdminUserListItem {
  id: string;
  name: string | null;
  email: string;
  systemRole: AdminUserSystemRole;
  active: boolean;
  createdDate: string | null;
  lastCompanyName: string | null;
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
}

import { UserCompanies } from './user-companies';

/** One company the signed-in person belongs to, as `GET /auth/memberships` reports it. */
export interface Membership {
  companyId: string;
  companyName: string;
  role: UserCompanies['role'];
  roleLabel: string;
  /** ONBOARDING = accepted the invite but has not finished the registration yet. */
  status: 'ACTIVE' | 'ONBOARDING';
  lastSelectedAt: string | null;
  needsOnboarding: boolean;
}

/** An invite waiting for the person. Carries no token and no handle on purpose. */
export interface PendingInvite {
  companyName: string;
  roleLabel: string;
}

export interface MembershipsResponse {
  memberships: Membership[];
  pendingInvites: PendingInvite[];
  defaultCompanyId: string | null;
}

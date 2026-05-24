export interface CompanyOwner {
  name: string;
  email: string;
  joinedAt: string;
}

export interface BillingInfo {
  plan: 'TRIAL' | 'PRO' | 'ENTERPRISE';
  billingCycle: 'Monthly' | 'Yearly';
  nextBillingDate: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
}

export interface CompanyStats {
  activeUsers: number;
  pendingInvites: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface UsersMetrics {
  total: number;
  newLast30Days: number;
  newByDay: DailyCount[];
}

export interface CompaniesMetrics {
  total: number;
  newLast30Days: number;
}

export interface SubscriptionsMetrics {
  total: number;
  active: number;
  trialing: number;
  byStatus: Record<string, number>;
  mrrCents: number;
}

export interface FeedbackMetrics {
  total: number;
  pending: number;
  byStatus: Record<string, number>;
}

export interface AdminOverviewResponse {
  users: UsersMetrics;
  companies: CompaniesMetrics;
  subscriptions: SubscriptionsMetrics;
  feedback: FeedbackMetrics;
}

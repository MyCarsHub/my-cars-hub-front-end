export interface DailyCount {
  date: string;
  count: number;
}

export interface UsersMetrics {
  total: number;
  activeTotal: number;
  newLast30Days: number;
  newByDay: DailyCount[];
}

export interface CompaniesMetrics {
  total: number;
  activeTotal: number;
  newLast30Days: number;
}

export interface VehiclesMetrics {
  total: number;
  activeTotal: number;
}

export interface SubscriptionsMetrics {
  total: number;
  active: number;
  trialing: number;
  byStatus: Record<string, number>;
  mrrCents: number;
  mrrActiveOnlyCents: number;
}

export interface FeedbackMetrics {
  total: number;
  pending: number;
  byStatus: Record<string, number>;
}

export interface AdminOverviewResponse {
  users: UsersMetrics;
  companies: CompaniesMetrics;
  vehicles: VehiclesMetrics;
  subscriptions: SubscriptionsMetrics;
  feedback: FeedbackMetrics;
}

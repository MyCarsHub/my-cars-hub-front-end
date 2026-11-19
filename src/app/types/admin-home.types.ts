/**
 * Visão geral do admin v2 — o contrato do backend em
 * `Claude outputs/2026-11-17_CONTRACT_admin-home.md`.
 *
 * Regras que atravessam tudo: dinheiro em CENTAVOS inteiros; `null` NUNCA é zero (é "sem dado",
 * e `nullReason` diz por quê); dia `YYYY-MM-DD` e mês `YYYY-MM` em São Paulo; instante ISO UTC;
 * razão é fração 0..1.
 */

export type AdminHomePeriod = '30d' | '90d' | '12m' | 'all';
/** `meta.period` of a response: a pill key, or `custom` when the request sent `from`/`to`. */
export type AdminHomeMetaPeriod = AdminHomePeriod | 'custom';
export type AdminHomeScope = 'clients' | 'all';

/**
 * The window the screen asks for (contract `changed:` 18/11): `YYYY-MM-DD` São Paulo days,
 * inclusive, `to` never after today, at most `ADMIN_RANGE_MAX_DAYS` days.
 */
export interface AdminHomeRange {
  from: string;
  to: string;
}

/** `HomePeriod.MAX_SPAN_DAYS` on the server: a longer range is a 400. */
export const ADMIN_RANGE_MAX_DAYS = 1827;
export type AdminHomeGranularity = 'DAY' | 'WEEK' | 'MONTH';

export type KpiUnit = 'CENTS' | 'COUNT' | 'RATIO';

export type KpiNullReason =
  | 'NO_COSTS'
  | 'NO_ACQUISITION_COST'
  | 'NO_NEW_PAYING'
  | 'NO_DATA_YET'
  | 'NO_PAYING'
  | 'ZERO_CHURN'
  | 'NO_SNAPSHOT';

export interface HomeKpi {
  value: number | null;
  previous: number | null;
  previousAsOf: string | null;
  since: string | null;
  availableFrom: string | null;
  unit: KpiUnit;
  definition: string;
  nullReason: KpiNullReason | null;
  parts: Record<string, number | null>;
}

export interface AdminHomeMeta {
  period: AdminHomeMetaPeriod;
  scope: AdminHomeScope;
  granularity: AdminHomeGranularity;
  from: string;
  to: string;
  currentMonth: string;
  generatedAt: string;
  /** Same as `granularity` (18/11). Optional: a server before the range change does not send it. */
  bucket?: AdminHomeGranularity;
  /** The window of the same length right before `from..to`. */
  previousFrom?: string;
  previousTo?: string;
  /** `YYYY-MM` of `to`: the month the "do mês" cards use. */
  referenceMonth?: string;
  /** `to` is today. False: the window ended before today and no bucket is live. */
  live?: boolean;
}

export interface AdminHomeChips {
  pastDueSubscriptions: number;
  trialsEndingIn7Days: number;
  feedbackPending: number;
  reconciliationPending: number;
}

export interface AdminHomeKpis {
  mrrReal: HomeKpi;
  profitMonth: HomeKpi;
  mrrEstimated: HomeKpi;
  arr: HomeKpi;
  costsMonth: HomeKpi;
  activeSubscriptions: HomeKpi;
  companies: HomeKpi;
  users: HomeKpi;
  vehicles: HomeKpi;
  managedExpected: HomeKpi;
  managedReceived: HomeKpi;
}

export interface MrrPoint {
  start: string;
  end: string;
  live: boolean;
  realCents: number | null;
  estimatedCents: number | null;
  activeSubscriptions: number | null;
}

export interface PlanCount {
  planName: string;
  planCodes: string[];
  subscriptions: number;
  mrrEstimatedCents: number;
  mrrRealCents: number;
}

export interface ManagedPoint {
  start: string;
  end: string;
  expectedCents: number | null;
  receivedCents: number | null;
}

export interface GrowthPoint {
  start: string;
  end: string;
  newUsers: number;
  newCompanies: number;
  newVehicles: number;
}

export interface HomeCostVendor {
  vendorId: string;
  name: string;
  category: string;
  categoryLabel: string | null;
  billingDay: number | null;
  active: boolean;
}

export interface HomeCostMonth {
  month: string;
  totalCents: number | null;
  byVendor: { vendorId: string; amountCents: number }[];
}

export interface ProfitMonth {
  month: string;
  live: boolean;
  mrrRealCents: number | null;
  costsCents: number | null;
  profitCents: number | null;
}

export interface AdminHomeHealth {
  churnMonthly: HomeKpi;
  ltv: HomeKpi;
  cac: HomeKpi;
  retention90d: HomeKpi;
  arpa: HomeKpi;
  margin: HomeKpi;
}

export interface AdminHomeFunnel {
  cohortFrom: string;
  cohortTo: string;
  signups: number;
  companiesCreated: number;
  inTrial: number;
  paying: number;
  trialToPaidRate: number | null;
  conversionsInPeriod: number;
  conversionsSince: string | null;
}

export interface AdminHome {
  meta: AdminHomeMeta;
  chips: AdminHomeChips;
  kpis: AdminHomeKpis;
  mrrSeries: { realSince: string | null; estimatedSince: string | null; points: MrrPoint[] };
  byPlan: PlanCount[];
  managedSeries: { since: string | null; points: ManagedPoint[] };
  growthSeries: { points: GrowthPoint[] };
  costs: { vendors: HomeCostVendor[]; months: HomeCostMonth[] };
  profitByMonth: ProfitMonth[];
  health: AdminHomeHealth;
  funnel: AdminHomeFunnel;
}

// ------------------------------------------------------------------ usage (§2)

export type UsageRole = 'OWNER' | 'MANAGER' | 'DRIVER';

export interface UsageRoleRow {
  role: UsageRole;
  people: number;
  seen7d: number;
  seen7dRatio: number | null;
}

export interface UsageTopByActions {
  userId: string;
  name: string;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  actions: number;
}

export interface UsageTopByAccess {
  userId: string;
  name: string;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  accessHours: number;
  activeMinutes: number;
}

export interface HeatCell {
  /** 0 = domingo .. 6 = sábado. */
  dow: number;
  /** 0..23, São Paulo. */
  hour: number;
  count: number;
}

export interface AdminUsage {
  meta: {
    period: string;
    scope: string;
    from: string;
    to: string;
    generatedAt: string;
    actionsSince: string | null;
    accessSince: string | null;
    bucket?: AdminHomeGranularity;
    previousFrom?: string;
    previousTo?: string;
  };
  roles: UsageRoleRow[];
  owners: { vehiclesPerOwner: number | null; activeRentals: number };
  managers: { managersPerCompany: number | null; finesRegistered: number };
  drivers: { driverRecords: number; withAppAccess: number; activeRentals: number };
  topByActions: UsageTopByActions[];
  topByAccess: UsageTopByAccess[];
  actionsHeatmap: HeatCell[];
  accessHeatmap: HeatCell[];
  byUf: { uf: string; companies: number }[];
  withoutUf: number;
}

// ------------------------------------------------------------------ upcoming (§4)

export interface UpcomingReceivable {
  companyId: string;
  companyName: string;
  internal: boolean;
  dueDate: string;
  planName: string;
  amountCents: number;
  amountSource: 'CHARGED' | 'LIST_PRICE';
}

export interface UpcomingPayable {
  vendorId: string;
  vendorName: string;
  category: string;
  dueDate: string;
  amountCents: number | null;
  amountMonth: string | null;
  /** Lançamento do mês; nulo = custo fixo projetado (mês ainda não lançado). Ausente num servidor antigo. */
  costId?: string | null;
  scheduleId?: string | null;
  kind?: 'FIXED' | 'ONE_OFF' | 'LEGACY' | null;
  /** O serviço do custo fixo ou o que foi pago no avulso. */
  description?: string | null;
}

export interface AdminUpcoming {
  from: string;
  until: string;
  receivables: UpcomingReceivable[];
  payables: UpcomingPayable[];
  /** Mantido por compatibilidade; sempre 0 desde que o dia de cobrança mora no custo fixo. */
  vendorsWithoutBillingDay: number;
  receivablesTotalCents: number;
  payablesTotalCents: number | null;
}

// ------------------------------------------------------------------ companies (§3, aditivos)

export type CompanyHealth = 'HEALTHY' | 'ATTENTION' | 'AT_RISK';
export type CompanyHealthReason =
  | 'OK'
  | 'TRIAL'
  | 'ACCESS_7_30D'
  | 'FREE_PLAN'
  | 'PAST_DUE'
  | 'NO_ACCESS_30D'
  | 'NEVER_ACCESSED'
  | 'NOT_PAYING';

export type CompanySort = 'createdAt' | 'mrr' | 'mrrReal' | 'managed' | 'lastAccess' | 'name';

// ------------------------------------------------------------------ movements (§5)

export type MovementGroup = 'SIGNUPS' | 'CHARGES' | 'ADMIN' | 'FAILURES';

export interface PlatformMovement {
  id: string;
  /** Instante UTC (o DTO é `LocalDateTime` em UTC, pode vir sem `Z`). */
  occurredAt: string;
  kind: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  companyId: string | null;
  companyName: string | null;
  companyInternal: boolean;
  origin: 'APP' | 'ADMIN' | 'WEBHOOK' | 'JOB' | 'UNKNOWN' | string;
  result: 'SUCCESS' | 'FAILED' | 'REFUSED' | string;
  detail: string | null;
}

/** `/audit/movements` page (18/11): the paged shape plus the window the server resolved. */
export interface PlatformMovementsPage {
  content: PlatformMovement[];
  page: number;
  size: number;
  total: number;
  meta?: { from: string; to: string };
}

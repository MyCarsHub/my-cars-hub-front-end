import type { AdminHome, AdminUsage, HomeKpi } from '../../../types/admin-home.types';

/**
 * Dados de teste da Visão geral v2, perto do que produção tem em 17/11/2026 (plano §1): sem custo
 * lançado, MRR real abaixo do estimado, captura de acessos ainda sem dado. Só os specs importam.
 */
export const kpi = (value: number | null, p: Partial<HomeKpi> = {}): HomeKpi => ({
  value,
  previous: null,
  previousAsOf: null,
  since: null,
  availableFrom: null,
  unit: 'CENTS',
  definition: 'definição',
  nullReason: null,
  parts: {},
  ...p,
});

/** Próximo do que produção tem em 17/11/2026 (plano §1): sem custo lançado, MRR real < estimado. */
export const HOME: AdminHome = {
  meta: {
    period: '12m',
    scope: 'clients',
    granularity: 'MONTH',
    from: '2025-12-01',
    to: '2026-11-17',
    currentMonth: '2026-11',
    generatedAt: '2026-11-17T20:00:00Z',
  },
  chips: { pastDueSubscriptions: 2, trialsEndingIn7Days: 0, feedbackPending: 3, reconciliationPending: 1 },
  kpis: {
    mrrReal: kpi(56_910, {
      previous: 23_970,
      previousAsOf: '2025-12-01',
      parts: { payingCompanies: 6, withoutChargedAmount: 0, fallbackListPriceCents: 0 },
    }),
    profitMonth: kpi(null, { nullReason: 'NO_COSTS', parts: { mrrRealCents: 56_910, costsCents: null } }),
    mrrEstimated: kpi(76_850),
    arr: kpi(682_920),
    costsMonth: kpi(null, { nullReason: 'NO_COSTS' }),
    activeSubscriptions: kpi(6, { unit: 'COUNT', parts: { conversionsInPeriod: 3 } }),
    companies: kpi(44, { unit: 'COUNT', parts: { internal: 6, newInPeriod: 20 } }),
    users: kpi(69, { unit: 'COUNT', parts: { newInPeriod: 19 } }),
    vehicles: kpi(120, { unit: 'COUNT', parts: { newInPeriod: 37 } }),
    managedExpected: kpi(12_041_687),
    managedReceived: kpi(8_000_000),
  },
  mrrSeries: {
    realSince: '2026-09-28',
    estimatedSince: '2026-11-05',
    points: [
      { start: '2026-09-01', end: '2026-09-30', live: false, realCents: 7_990, estimatedCents: null, activeSubscriptions: null },
      { start: '2026-10-01', end: '2026-10-31', live: false, realCents: 23_970, estimatedCents: null, activeSubscriptions: null },
      { start: '2026-11-01', end: '2026-11-30', live: true, realCents: 56_910, estimatedCents: 76_850, activeSubscriptions: 6 },
    ],
  },
  byPlan: [
    { planName: 'Starter', planCodes: ['STARTER'], subscriptions: 4, mrrEstimatedCents: 31_960, mrrRealCents: 31_960 },
    { planName: 'Pro', planCodes: ['PRO'], subscriptions: 1, mrrEstimatedCents: 14_990, mrrRealCents: 10_000 },
    { planName: 'Scale', planCodes: ['SCALE'], subscriptions: 1, mrrEstimatedCents: 29_900, mrrRealCents: 14_950 },
  ],
  managedSeries: { since: '2025-10-01', points: [{ start: '2026-11-01', end: '2026-11-30', expectedCents: 12_041_687, receivedCents: 8_000_000 }] },
  growthSeries: { points: [{ start: '2026-11-01', end: '2026-11-30', newUsers: 19, newCompanies: 20, newVehicles: 37 }] },
  costs: {
    vendors: [
      { vendorId: 'v-render', name: 'Render', category: 'BACKEND', categoryLabel: null, billingDay: null, active: true },
      { vendorId: 'v-acq', name: 'Aquisição', category: 'ACQUISITION', categoryLabel: null, billingDay: 5, active: true },
    ],
    months: [{ month: '2026-11', totalCents: null, byVendor: [] }],
  },
  profitByMonth: [{ month: '2026-11', live: true, mrrRealCents: 56_910, costsCents: null, profitCents: null }],
  health: {
    churnMonthly: kpi(0, { unit: 'RATIO', parts: { cancellations: 0, payingAtStart: 4 } }),
    ltv: kpi(null, { nullReason: 'ZERO_CHURN' }),
    cac: kpi(null, { nullReason: 'NO_ACQUISITION_COST' }),
    retention90d: kpi(null, { unit: 'RATIO', nullReason: 'NO_DATA_YET', availableFrom: '2026-12-27' }),
    arpa: kpi(9_485),
    margin: kpi(null, { unit: 'RATIO', nullReason: 'NO_COSTS' }),
  },
  funnel: {
    cohortFrom: '2025-12-01',
    cohortTo: '2026-11-17',
    signups: 60,
    companiesCreated: 40,
    inTrial: 30,
    paying: 6,
    trialToPaidRate: 0.2,
    conversionsInPeriod: 3,
    conversionsSince: '2026-10-29',
  },
};

export const USAGE: AdminUsage = {
  meta: {
    period: '12m',
    scope: 'clients',
    from: '2025-12-01',
    to: '2026-11-17',
    generatedAt: '2026-11-17T20:00:00Z',
    actionsSince: '2026-11-16',
    accessSince: null,
  },
  roles: [
    { role: 'OWNER', people: 44, seen7d: 33, seen7dRatio: 0.75 },
    { role: 'MANAGER', people: 4, seen7d: 2, seen7dRatio: 0.5 },
    { role: 'DRIVER', people: 21, seen7d: 7, seen7dRatio: 0.3333 },
  ],
  owners: { vehiclesPerOwner: 2.7, activeRentals: 40 },
  managers: { managersPerCompany: 0.1, finesRegistered: 3 },
  drivers: { driverRecords: 80, withAppAccess: 21, activeRentals: 40 },
  topByActions: [{ userId: 'u1', name: 'Rafael Silva', role: 'OWNER', companyId: 'c1', companyName: 'Locadora Silva', actions: 12 }],
  topByAccess: [],
  actionsHeatmap: [{ dow: 1, hour: 9, count: 4 }],
  accessHeatmap: [],
  byUf: [{ uf: 'SP', companies: 2 }, { uf: 'PR', companies: 1 }],
  withoutUf: 41,
};

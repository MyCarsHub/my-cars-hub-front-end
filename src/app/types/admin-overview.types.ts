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
  arrCents: number;
}

export interface FeedbackMetrics {
  total: number;
  pending: number;
  byStatus: Record<string, number>;
}

/**
 * Consolidado de aluguéis de TODAS as empresas.
 *
 * `closedTotal` = aluguel FECHADO, isto é, com status diferente de CANCELED
 * (RESERVED + ACTIVE + COMPLETED) — negócio efetivado, não necessariamente
 * concluído. `completedTotal` é o recorte conservador: só os COMPLETED.
 *
 * `byStatus` OMITE status sem nenhum registro (não vem com zero), por isso é
 * lido como mapa esparso e a ausência vale zero.
 */
export interface RentalsMetrics {
  closedTotal: number;
  closedAmountCents: number;
  completedTotal: number;
  completedAmountCents: number;
  byStatus: Record<string, number>;
}

/**
 * `total` = documentos de contrato de locação. `signedTotal` é SUBCONJUNTO de
 * `total` (contrato assinado em papel fica de fora) e nunca representa o total.
 */
export interface ContractsMetrics {
  total: number;
  signedTotal: number;
}

export interface AdminOverviewResponse {
  users: UsersMetrics;
  companies: CompaniesMetrics;
  vehicles: VehiclesMetrics;
  subscriptions: SubscriptionsMetrics;
  feedback: FeedbackMetrics;
  rentals: RentalsMetrics;
  contracts: ContractsMetrics;
}

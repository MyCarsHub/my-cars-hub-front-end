export interface DailyCount {
  date: string;
  count: number;
}

export interface UsersMetrics {
  total: number;
  activeTotal: number;
  newLast30Days: number;
  newByDay: DailyCount[];
  /** Usuarios com requisicao autenticada dentro de UserPresence.ONLINE_WINDOW (backend). Opcional: backend anterior nao envia. */
  onlineNow?: number;
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

/**
 * `trialing` = testes EM ANDAMENTO (`trial_ends_at > now()`), nunca a contagem
 * crua do status TRIALING. `byStatus` usa o mesmo status efetivo: teste vencido
 * entra em `EXPIRED`. Tudo exclui empresas internas.
 */
export interface SubscriptionsMetrics {
  total: number;
  active: number;
  trialing: number;
  byStatus: Record<string, number>;
  mrrCents: number;
  mrrActiveOnlyCents: number;
  arrCents: number;
  /** Subconjunto de `trialing` que acaba nos próximos 7 dias. Opcional: backend anterior não envia. */
  trialsEndingIn7Days?: number;
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

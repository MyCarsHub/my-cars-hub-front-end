/**
 * Receita DA PLATAFORMA (assinaturas das locadoras ao MyCarsHub) — `GET /v1/admin/billing/revenue`.
 * Contas internas ficam fora de todo número. Dinheiro em centavos.
 *
 * Nulo nunca é zero: mês antes do início do dado vem `null` e a tela diz "começa em <data>".
 */
export type AdminRevenuePeriod = '3m' | '12m' | 'all';
export type AdminRevenueBucket = 'DAY' | 'WEEK' | 'MONTH';

/** One bucket of the window (18/11). Same null rules as `AdminRevenueMonth`. */
export interface AdminRevenuePoint {
  /** `YYYY-MM-DD`, first day of the bucket (cut at `meta.from`). */
  readonly start: string;
  /** `YYYY-MM-DD`, last day of the bucket (cut at `meta.to`). */
  readonly end: string;
  readonly mrrCents: number | null;
  readonly mrrAsOf: string | null;
  readonly receivedCents: number | null;
  readonly cumulativeReceivedCents: number | null;
  readonly couponDiscountCents: number | null;
}

export interface AdminRevenueMeta {
  readonly period: AdminRevenuePeriod | 'custom';
  readonly from: string;
  readonly to: string;
  readonly bucket: AdminRevenueBucket;
  readonly previousFrom: string;
  readonly previousTo: string;
}

export interface AdminRevenueMonth {
  /** `AAAA-MM`, mês civil de São Paulo. */
  readonly month: string;
  /** MRR estimado da última foto diária do mês; `null` sem foto. */
  readonly mrrCents: number | null;
  readonly mrrAsOf: string | null;
  /** Caixa do mês; `null` antes do primeiro pagamento gravado. */
  readonly receivedCents: number | null;
  /** Caixa somado desde o primeiro pagamento gravado. */
  readonly cumulativeReceivedCents: number | null;
  /** Desconto de cupom nas faturas pagas no mês; `null` se a Stripe não respondeu. */
  readonly couponDiscountCents: number | null;
}

export interface AdminRevenue {
  readonly period: AdminRevenuePeriod | 'custom';
  /** The window resolved by the server (18/11). Optional: absent on a server before the change. */
  readonly meta?: AdminRevenueMeta;
  /** One point per bucket of `meta.from..meta.to` (18/11). Absent before the change: use `months`. */
  readonly points?: readonly AdminRevenuePoint[];
  readonly currentMonth: string;
  readonly months: readonly AdminRevenueMonth[];
  readonly mrr: { readonly since: string | null; readonly asOf: string | null; readonly latestCents: number | null };
  readonly received: {
    readonly since: string | null;
    readonly monthCents: number | null;
    readonly totalCents: number | null;
    readonly rowsWithoutAmount: number;
    /** Cash inside `meta.from..meta.to`; null only when the whole window is before `since`. */
    readonly periodCents?: number | null;
    /** Cash in the same-length window right before; null only when it is all before `since`. */
    readonly previousPeriodCents?: number | null;
  };
  readonly expected: {
    readonly month: string;
    readonly until: string;
    readonly receivedCents: number;
    readonly upcomingRenewals: number;
    readonly upcomingRenewalsCents: number;
    readonly expectedCents: number;
  };
  readonly discounts: {
    readonly available: boolean;
    readonly truncated: boolean;
    readonly monthCents: number | null;
    readonly periodCents: number | null;
    readonly discountedInvoices: number;
  };
}

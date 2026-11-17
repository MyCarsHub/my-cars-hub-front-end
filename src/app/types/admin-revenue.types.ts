/**
 * Receita DA PLATAFORMA (assinaturas das locadoras ao MyCarsHub) — `GET /v1/admin/billing/revenue`.
 * Contas internas ficam fora de todo número. Dinheiro em centavos.
 *
 * Nulo nunca é zero: mês antes do início do dado vem `null` e a tela diz "começa em <data>".
 */
export type AdminRevenuePeriod = '3m' | '12m' | 'all';

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
  readonly period: AdminRevenuePeriod;
  readonly currentMonth: string;
  readonly months: readonly AdminRevenueMonth[];
  readonly mrr: { readonly since: string | null; readonly asOf: string | null; readonly latestCents: number | null };
  readonly received: {
    readonly since: string | null;
    readonly monthCents: number | null;
    readonly totalCents: number | null;
    readonly rowsWithoutAmount: number;
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

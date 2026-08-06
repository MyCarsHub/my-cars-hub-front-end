/**
 * Billing administrativo — `GET /v1/admin/billing/**`.
 *
 * Os campos de vocabulário (`status`, `planPeriod`, `billingCycle`, `gateway`,
 * `kind`, `reason`) chegam como o `name()` cru do enum do backend e são `string`,
 * não uniões fechadas: o vocabulário cresce sem aviso e o filtro de status é
 * populado por `GET /v1/admin/billing/statuses`. Fechar o tipo aqui obrigaria a
 * editar o frontend a cada valor novo — e sumiria com a linha na tela.
 */
export interface AdminSubscriptionListItem {
  id: string;
  companyId: string;
  companyName: string;
  companyStatus: string;
  planCode: string;
  planName: string;
  planPeriod: string;
  status: string;
  billingCycle: string | null;
  /**
   * ATENÇÃO: chega MAIÚSCULO aqui (`"STRIPE"`) e minúsculo em
   * `AdminMrrPlanBreakdown.gateway` (`"stripe"`). Divergência de schema declarada
   * pelo backend, sem correção prevista — normalize antes de exibir ou comparar.
   */
  gateway: string | null;
  externalIdMasked: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  monthlyPriceCents: number | null;
  createdAt: string;
}

export interface AdminMrrPlanBreakdown {
  planId: string;
  planCode: string;
  planName: string;
  planPeriod: string;
  /** Minúsculo (`"stripe"`) — ver nota em `AdminSubscriptionListItem.gateway`. */
  gateway: string | null;
  planPriceCents: number | null;
  subscriptionsTotal: number;
  activeTotal: number;
  trialingTotal: number;
  pastDueTotal: number;
  canceledTotal: number;
  mrrCents: number;
  activeOnlyMrrCents: number;
}

export interface AdminMrrBreakdown {
  totalMrrCents: number;
  activeOnlyMrrCents: number;
  totalSubscriptions: number;
  byPlan: AdminMrrPlanBreakdown[];
}

/**
 * Problema de cobrança aberto AGORA cujo início caiu dentro da janela pedida.
 *
 * A janela filtra pelo INÍCIO do problema, não pela última atividade: um
 * `SUBSCRIPTION_PAST_DUE` aberto há 90 dias NÃO aparece com `days=30`. Por isso a
 * UI precisa oferecer 30/90/365 — com só 30 o admin conclui que não há problema
 * quando há.
 */
export interface AdminBillingIssue {
  /** `SUBSCRIPTION_PAST_DUE` | `RECONCILIATION_PENDING` (vocabulário aberto). */
  kind: string;
  reason: string | null;
  subscriptionId: string | null;
  companyId: string | null;
  companyName: string | null;
  planCode: string | null;
  planName: string | null;
  gateway: string | null;
  externalIdMasked: string | null;
  /**
   * `null` quando o provedor não informou o valor. NÃO renderizar R$ 0,00 no
   * lugar — zero é um valor de verdade e ausência é outra coisa.
   */
  amountCents: number | null;
  occurredAt: string;
}

export interface AdminSubscriptionsQuery {
  /** `name()` cru do enum. Valor inválido devolve 400, não lista vazia. */
  status?: string | null;
  page?: number;
  size?: number;
}

/** Janelas oferecidas no seletor de problemas. Backend aceita 1–365. */
export type BillingIssueWindow = 30 | 90 | 365;

export interface AdminBillingIssuesQuery {
  days?: BillingIssueWindow;
  page?: number;
  size?: number;
}

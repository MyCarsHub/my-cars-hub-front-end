/**
 * DTO shapes for the /admin/companies endpoints.
 *
 * Backend serializes Java records verbatim, so keys are exact copies of the
 * record component names on the server side. Don't invent new keys — see
 * `paged-response-shape.md`.
 */

export type AdminCompanyStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export type AdminCompanySubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED';

export interface AdminCompanyListItem {
  id: string;
  name: string;
  documentMasked: string | null;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: AdminCompanySubscriptionStatus | null;
  billingCycle: string | null;
  status: AdminCompanyStatus;
  active: boolean;
  memberCount: number;
  createdAt: string | null;
}

export interface AdminCompanySubscriptionSnapshot {
  id: string;
  planCode: string | null;
  planName: string | null;
  status: AdminCompanySubscriptionStatus | null;
  billingCycle: string | null;
  gateway: string | null;
  externalIdMasked: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean | null;
}

export interface AdminCompanyMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface AdminCompanyChargeIntegrationSnapshot {
  connected: boolean;
  provider: string | null;
  environment: string | null;
  webhookAutoConfigured: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
}

/**
 * Consolidado operacional de UMA empresa (`operations` no detalhe do admin).
 *
 * O backend NUNCA devolve `operations` null: empresa sem operação vem com
 * zeros. Todos os contadores são inteiros; todo campo `*Cents` está em
 * CENTAVOS e deve ser formatado com `formatBRL`.
 */
export interface AdminCompanyOperationsRentals {
  total: number;
  /** Aluguéis com `status = ACTIVE`. */
  activeTotal: number;
  /** Aluguéis com `status <> CANCELED` — o que virou negócio. */
  closedTotal: number;
  /** Valor CONTRATADO: soma de `total_amount` dos não cancelados. */
  closedAmountCents: number;
  completedTotal: number;
  completedAmountCents: number;
  canceledTotal: number;
  /**
   * Valor RECEBIDO: soma das cobranças com `status = PAID`. Diverge de
   * `closedAmountCents` por natureza — contratado ≠ recebido.
   */
  paidAmountCents: number;
}

/** Contratos = `rental_documents.kind = CONTRACT` (não existe tabela própria). */
export interface AdminCompanyOperationsContracts {
  total: number;
  /** Produzidos pelo backend, em oposição aos anexados manualmente. */
  generatedTotal: number;
  /** Subconjunto de `total`: assinatura digital concluída. Papel não entra. */
  signedTotal: number;
}

export interface AdminCompanyOperationsVehicles {
  total: number;
  /** Exclui `status = INACTIVE` (arquivados). */
  activeTotal: number;
}

export interface AdminCompanyOperationsDrivers {
  total: number;
  workingTotal: number;
}

export interface AdminCompanyOperationsFines {
  total: number;
  pendingTotal: number;
  /** Soma das NÃO canceladas — a quantidade conta tudo, o dinheiro não. */
  amountCents: number;
}

export interface AdminCompanyOperationsMaintenances {
  total: number;
  /** Soma das NÃO canceladas — a quantidade conta tudo, o dinheiro não. */
  costCents: number;
}

export interface AdminCompanyOperations {
  rentals: AdminCompanyOperationsRentals;
  contracts: AdminCompanyOperationsContracts;
  vehicles: AdminCompanyOperationsVehicles;
  drivers: AdminCompanyOperationsDrivers;
  fines: AdminCompanyOperationsFines;
  maintenances: AdminCompanyOperationsMaintenances;
}

export interface AdminCompanyDetail {
  id: string;
  name: string;
  documentMasked: string | null;
  status: AdminCompanyStatus;
  active: boolean;
  createdAt: string | null;
  modifiedAt: string | null;
  subscription: AdminCompanySubscriptionSnapshot | null;
  members: AdminCompanyMember[];
  chargeIntegration: AdminCompanyChargeIntegrationSnapshot | null;
  operations: AdminCompanyOperations;
}

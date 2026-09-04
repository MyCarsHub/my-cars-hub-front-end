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

/**
 * Uma venda VIGENTE de veículo da empresa (FEAT-0075 · `SaleItemDto`).
 *
 * LGPD: `buyerName` é dado de terceiro e `authorName` identifica o operador.
 * Ambos vão para a TELA do admin e para lugar nenhum além dela — nunca para
 * `console`, log do browser ou telemetria.
 */
export interface AdminCompanySaleItem {
  vehicleId: string;
  /** Na prática nunca nulo: apagar o veículo apaga a venda (CASCADE na V74). */
  vehiclePlate: string | null;
  buyerName: string | null;
  /** `yyyy-MM-dd` (LocalDate). */
  saleDate: string | null;
  /** Centavos, como todo valor monetário do domínio. */
  saleValueCents: number;
  /** Nulo quando o autor foi excluído (SET NULL na V74). */
  authorName: string | null;
  createdAt: string | null;
}

/** Estado de um evento da trilha de desfazimento (`SaleUndoItemDto.state`). */
export type AdminCompanySaleUndoState = 'ACTIVE' | 'UNDO_REFUSED';

/**
 * Um desfazimento — ou uma RECUSA de desfazimento — da trilha append-only
 * (`SaleUndoItemDto`). `UNDO_REFUSED` é registrado de propósito: é o único
 * rastro de que alguém tentou recuperar a vaga do plano e não conseguiu.
 */
export interface AdminCompanySaleUndoItem {
  vehicleId: string;
  /** Nulo se o veículo foi excluído depois — a trilha não tem FK e sobrevive. */
  vehiclePlate: string | null;
  state: AdminCompanySaleUndoState;
  reason: string | null;
  authorName: string | null;
  createdAt: string | null;
}

/** Vendas da empresa. Sem venda: listas vazias, nunca `null` (contrato). */
export interface AdminCompanyOperationsSales {
  sales: AdminCompanySaleItem[];
  undos: AdminCompanySaleUndoItem[];
}

export interface AdminCompanyOperations {
  rentals: AdminCompanyOperationsRentals;
  contracts: AdminCompanyOperationsContracts;
  vehicles: AdminCompanyOperationsVehicles;
  drivers: AdminCompanyOperationsDrivers;
  fines: AdminCompanyOperationsFines;
  maintenances: AdminCompanyOperationsMaintenances;
  sales: AdminCompanyOperationsSales;
}

/**
 * Dados cadastrais da empresa (FIX-0244 · `CompanyRegistrationDto`) — as onze
 * colunas que a V52 acrescentou a `companies`.
 *
 * O BLOCO vem sempre presente (o backend normaliza nulo para vazio no
 * construtor do record), mas CADA CAMPO é nulável: a V52 é aditiva e nenhuma
 * empresa anterior a ela tem linha preenchida. A tela mostra "—" e não pode
 * parecer quebrada com isso.
 *
 * LGPD: `phone`, `email` e `representativeName` são dado pessoal. Exibi-los ao
 * admin de PLATAFORMA é decisão de produto (é o canal do suporte); isso NÃO
 * libera log — nada daqui pode ir para `console` nem para trilha de auditoria.
 */
export interface AdminCompanyRegistration {
  /** DADO PESSOAL (LGPD). Fora de log. */
  phone: string | null;
  /** DADO PESSOAL (LGPD). Fora de log. */
  email: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCep: string | null;
  addressCity: string | null;
  addressUf: string | null;
  /** DADO PESSOAL de terceiro (LGPD). Fora de log. */
  representativeName: string | null;
  representativeRole: string | null;
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
  /** Sempre presente no contrato; campos individuais podem ser nulos. */
  registration: AdminCompanyRegistration;
  operations: AdminCompanyOperations;
}

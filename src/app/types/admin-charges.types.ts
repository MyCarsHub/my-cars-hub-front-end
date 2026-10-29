/** Abas da página Cobranças. Só leitura no P0 ("atrasado é nossa prova"). */
export type AdminChargeTab = 'FAILED' | 'OVERDUE';

export interface AdminChargeListItem {
  chargeId: string;
  rentalId: string;
  rentalStatus: string;
  kind: string;
  status: string;
  /** Centavos. */
  amountCents: number;
  /** yyyy-MM-dd */
  dueDate: string | null;
  /** Dias desde o vencimento (BRT); negativo = ainda vai vencer. */
  daysOverdue: number;
  failureCode: string | null;
  /** Motivo do gateway, saneado no servidor. */
  failureReason: string | null;
  companyId: string;
  companyName: string;
  companyInternal: boolean;
  driverId: string | null;
  driverName: string | null;
  /** Só mascarado; o WhatsApp pede o número ao endpoint auditado (DRIVER). */
  driverPhoneMasked: string | null;
}

export interface AdminChargesPage {
  tab: AdminChargeTab;
  includeInternal: boolean;
  content: AdminChargeListItem[];
  page: number;
  size: number;
  total: number;
  failedCount: number;
  overdueCount: number;
}

/** Uma empresa em "Converter testes" (D5). */
export interface TrialConversionItem {
  companyId: string;
  companyName: string;
  companyStatus: string;
  internal: boolean;
  signupAt: string | null;
  trialEndsAt: string | null;
  /** Negativo = o teste ainda acaba em N dias. */
  daysSinceTrialEnd: number;
  subscriptionStatus: string | null;
  planName: string | null;
  vehicles: number;
  drivers: number;
  rentals: number;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  /** 3 aluguel · 2 motorista · 1 veículo · 0 nada. */
  activationStage: number;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerPhoneMasked: string | null;
}

// ---------------------------------------------------------------- admin v2 P1

/** Motivo FECHADO das ações de admin (o código vai para a trilha; a nota não). */
export type AdminActionReason =
  | 'PAID_OUTSIDE_GATEWAY'
  | 'CUSTOMER_REQUEST'
  | 'DATA_CORRECTION'
  | 'GATEWAY_FAILURE'
  | 'OTHER';

export interface AdminActionRequest {
  reason: AdminActionReason;
  note?: string | null;
}

/** "Recebida por fora" (só admin): motivo + dia do recebimento (yyyy-MM-dd, nunca futuro). */
export interface AdminReceivedOutsideRequest extends AdminActionRequest {
  receivedOn: string;
}

export type AsaasComparisonResult =
  | 'MATCH'
  | 'DIVERGENT'
  | 'NOT_FOUND_AT_ASAAS'
  | 'NO_GATEWAY_LINK'
  | 'ASAAS_UNAVAILABLE';

export interface AsaasComparisonField {
  /** value · originalValue · discount · dueDate · originalDueDate · status */
  key: string;
  /** CENTS · DATE · TEXT */
  kind: 'CENTS' | 'DATE' | 'TEXT';
  local: string | null;
  asaas: string | null;
  divergent: boolean;
}

export interface AsaasComparison {
  chargeId: string;
  rentalId: string;
  companyId: string;
  externalId: string | null;
  result: AsaasComparisonResult;
  message: string;
  /** yyyy-MM-dd */
  comparedOn: string;
  fields: AsaasComparisonField[];
}

export interface AdminChargeActionResult {
  chargeId: string;
  action: 'RECEIVED_OUTSIDE' | 'RETRY';
  outcome: string;
  status: string | null;
  done: boolean;
  hint: string | null;
}

export interface DriverNameCorrectionResult {
  driverId: string;
  companyId: string;
  name: string;
  userUpdated: boolean;
  asaasCustomerLinked: boolean;
}

export interface AsaasCustomerSyncResult {
  driverId: string;
  companyId: string;
  customerId: string;
  result: 'UPDATED' | 'REJECTED' | 'UNAVAILABLE';
  message: string;
  sentFields: string[];
  asaasName: string | null;
}

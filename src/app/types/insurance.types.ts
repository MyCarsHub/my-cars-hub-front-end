/**
 * Vehicle insurance ("Seguros") — apólices vinculadas a um veículo.
 *
 * Contrato do backend:
 * - `GET/POST    /v1/vehicles/{vehicleId}/insurances`
 * - `PATCH       /v1/vehicles/{vehicleId}/insurances/{id}`
 * - `PATCH       /v1/vehicles/{vehicleId}/insurances/{id}/cancel`
 * - `DELETE      /v1/vehicles/{vehicleId}/insurances/{id}`
 * - `GET         /v1/insurances` (paginado) e `GET /v1/insurances/{id}`
 *
 * Valores monetários trafegam em CENTAVOS inteiros; datas em ISO (`yyyy-MM-dd`).
 */

export type InsuranceStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';

export type InsuranceCoverage = 'COMPREHENSIVE' | 'THEFT' | 'THIRD_PARTY';

/** Apólice como devolvida pelos endpoints escopados no veículo. */
export interface Insurance {
  id: string;
  vehicleId: string;
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  /** Prêmio em centavos. */
  premiumAmount: number;
  /** Franquia em centavos. Nullable. */
  deductibleAmount: number | null;
  startDate: string;
  endDate: string;
  paymentMethod: string | null;
  status: InsuranceStatus;
  cancelledDate: string | null;
  notes: string | null;
  createdDate: string;
  modifyDate: string | null;
}

/**
 * Item da listagem consolidada (`GET /v1/insurances`). O backend denormaliza
 * placa/marca/modelo e já entrega `daysToExpiry` para o badge de vencimento.
 */
export interface InsuranceListItem {
  id: string;
  createdDate: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  premiumAmount: number;
  deductibleAmount: number | null;
  startDate: string;
  endDate: string;
  paymentMethod: string | null;
  status: InsuranceStatus;
  cancelledDate: string | null;
  /** Dias até `endDate`. Negativo = já vencida. `null` quando não aplicável. */
  daysToExpiry: number | null;
}

/** Detalhe (`GET /v1/insurances/{id}`) — inclui o veículo para render em 1 request. */
export interface InsuranceDetail {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYearModel: number | null;
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  premiumAmount: number;
  deductibleAmount: number | null;
  startDate: string;
  endDate: string;
  paymentMethod: string | null;
  status: InsuranceStatus;
  cancelledDate: string | null;
  notes: string | null;
  daysToExpiry: number | null;
}

export interface CreateInsuranceRequest {
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  premiumAmount: number;
  deductibleAmount?: number | null;
  startDate: string;
  endDate: string;
  paymentMethod?: string | null;
  notes?: string | null;
}

/** PATCH parcial — só os campos alterados precisam ir. */
export interface UpdateInsuranceRequest {
  insurer?: string;
  policyNumber?: string;
  coverageType?: InsuranceCoverage;
  premiumAmount?: number;
  deductibleAmount?: number | null;
  startDate?: string;
  endDate?: string;
  paymentMethod?: string | null;
  notes?: string | null;
}

export interface CancelInsuranceRequest {
  /** Deve estar em [startDate, hoje]. */
  cancelledDate: string;
  reason?: string | null;
}

/**
 * `status` e `expiringInDays` são MUTUAMENTE EXCLUSIVOS no backend —
 * `expiringInDays` já implica ACTIVE. O service nunca envia os dois juntos.
 */
export interface InsuranceFilters {
  vehicleId?: string;
  status?: InsuranceStatus | '';
  expiringInDays?: number | null;
  sort?: string;
  page?: number;
  size?: number;
}

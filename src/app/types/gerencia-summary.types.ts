import { Financing, VehicleStatus, VehicleType } from './vehicle.types';

/**
 * Payload returned by `GET /v1/vehicles/{id}/gerencia/summary`.
 * Backend contract: `GerenciaSummaryDto`.
 */
export interface GerenciaSummary {
  vehicle: GerenciaVehicleChunk;
  fines: GerenciaFinesChunk;
  maintenances: GerenciaMaintenancesChunk;
  /** Backend serializes a `FinancingResponseDto` here; shape matches `Financing`. */
  activeFinancing: Financing | null;
  licensing: GerenciaLicensingChunk;
  finance: GerenciaFinanceChunk;
  dates: GerenciaDatesChunk;
}

export interface GerenciaFinanceChunk {
  purchaseCostCents: number | null;
  totalMaintenanceExpenseCents: number;
  /**
   * Total paid on the active/most-recent financing. Null when a financing
   * exists but essential fields (installmentAmount, installments,
   * contractDate) are missing — see `financingDataIncomplete`.
   */
  totalFinancingPaidCents: number | null;
  /**
   * True when a financing is attached to the vehicle but its essential
   * fields are missing, so the backend could not compute
   * `totalFinancingPaidCents`. Surface a warning + edit CTA on the UI
   * instead of silently displaying an inflated Resultado.
   */
  financingDataIncomplete?: boolean;
  /**
   * Contracted rental revenue — SUM(total_amount) over all rentals with
   * status IN (RESERVED, ACTIVE, COMPLETED). Aligned with Dashboard's
   * "signed-contract" revenue semantics.
   */
  totalRentalRevenueCents: number;
  /**
   * Money actually received — SUM(rental_charges.amount) WHERE status=PAID
   * AND kind=RENTAL_TOTAL. Independent of revenue.
   */
  totalRentalReceivedCents: number;
  totalInvestedCents: number;
  resultCents: number;
}

export interface GerenciaDatesChunk {
  acquisitionDate: string | null;
  lastMaintenanceDate: string | null;
  nextMaintenanceDate: string | null;
  financingLastInstallmentDate: string | null;
}

export interface GerenciaVehicleChunk {
  id: string;
  plate: string;
  brand: string;
  model: string;
  hodometer: number | null;
  licensingExpiration: string | null;
  type: VehicleType;
  status: VehicleStatus;
}

export interface GerenciaFinesChunk {
  openCount: number;
  openAmountCents: number;
}

export interface GerenciaMaintenancesChunk {
  openCount: number;
  nextServiceDate: string | null;
}

export interface GerenciaLicensingChunk {
  expiration: string | null;
  expiringSoon: boolean;
  expired: boolean;
}

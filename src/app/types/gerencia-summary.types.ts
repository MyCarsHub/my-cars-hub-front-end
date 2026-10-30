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
   * True when a financing is attached to the vehicle but Investido cannot be
   * known: its installments cannot be computed or it has no `downPayment`.
   * The page shows its own empty state instead of a wrong number.
   */
  financingDataIncomplete: boolean;
  /** Paid off early with no amount recorded: Investido and both results are null. */
  financingPayoffUnknown: boolean;
  /** The car has a financing, active or paid off. */
  financed: boolean;
  /** "Entrada". Null when not financed or when the financing has none. */
  downPaymentCents: number | null;
  /** Cash car with no purchase price. Drives "Falta o valor de compra". */
  purchasePriceMissing: boolean;
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
  /** What left the pocket. Null when Investido cannot be known. */
  totalInvestedCents: number | null;
  /**
   * Valor BRUTO da venda do veículo, em centavos (FEAT-0074). `null` quando o
   * veículo não foi vendido.
   *
   * Entra nos resultados como categoria PONTUAL. Não é receita de aluguel e
   * não pode ser somada com ela na tela.
   */
  saleValueCents: number | null;
  /** `yyyy-MM-dd` da venda; `null` sem venda. */
  saleDate: string | null;
  /** Contratado result (revenue + sale - invested). Null when Investido cannot be known. */
  resultCents: number | null;
  /** Recebido result (received + sale - invested). Null when Investido cannot be known. */
  resultReceivedCents: number | null;
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

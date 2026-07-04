import { Financing, VehicleType } from './vehicle.types';

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
}

export interface GerenciaVehicleChunk {
  id: string;
  plate: string;
  brand: string;
  model: string;
  hodometer: number | null;
  licensingExpiration: string | null;
  type: VehicleType;
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

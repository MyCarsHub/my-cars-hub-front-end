export type VehicleType = 'CAR' | 'MOTORCYCLE';
export type FinancingStatus = 'ACTIVE' | 'PAID_OFF';

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'CAR', label: 'Carro' },
  { value: 'MOTORCYCLE', label: 'Moto' },
] as const;

export const VEHICLE_SORT_OPTIONS = [
  { value: 'plate_asc', label: 'Placa (A→Z)' },
  { value: 'plate_desc', label: 'Placa (Z→A)' },
  { value: 'licensing_expiration_asc', label: 'Licenciamento (mais próximo)' },
  { value: 'licensing_expiration_desc', label: 'Licenciamento (mais distante)' },
  { value: 'created_desc', label: 'Cadastro (mais recente)' },
  { value: 'created_asc', label: 'Cadastro (mais antigo)' },
] as const;

export interface VehicleListItem {
  id: string;
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearModel: number;
  licensingExpiration: string | null;
  createdDate: string;
}

export interface Financing {
  id: string;
  vehicleId: string;
  contractDate: string;
  purchasePrice: number;
  downPayment: number | null;
  totalFinanced: number | null;
  installments: number | null;
  installmentAmount: number | null;
  status: FinancingStatus;
  paidOffDate: string | null;
  createdDate: string;
  modifyDate: string | null;
}

export interface Vehicle {
  id: string;
  companyId: string;
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearManufacture: number;
  yearModel: number;
  chassis: string | null;
  hodometer: number;
  licensingExpiration: string | null;
  renavam: string | null;
  color: string | null;
  purchaseDate: string | null;
  activeFinancing: Financing | null;
  createdDate: string;
  modifyDate: string | null;
}

export interface CreateVehicleRequest {
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearManufacture: number;
  yearModel: number;
  chassis?: string | null;
  hodometer: number;
  licensingExpiration?: string | null;
  renavam?: string | null;
  color?: string | null;
  purchaseDate?: string | null;
}

export interface UpdateVehicleRequest {
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearManufacture: number;
  yearModel: number;
  hodometer: number;
  licensingExpiration?: string | null;
  color?: string | null;
  purchaseDate?: string | null;
}

export interface CreateFinancingRequest {
  contractDate: string;
  purchasePrice: number;
  downPayment?: number | null;
  totalFinanced?: number | null;
  installments?: number | null;
  installmentAmount?: number | null;
}

export interface MarkPaidOffRequest {
  paidOffDate?: string;
}

export interface VehicleFilters {
  q?: string;
  type?: VehicleType | '';
  sort?: string;
  page?: number;
  size?: number;
}

/**
 * Item from the fleet-wide financings listing endpoint (`GET /v1/financings`).
 * Backend denormalizes plate/brand/model for direct rendering.
 */
export interface FinancingListItem {
  id: string;
  createdDate: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  contractDate: string;
  purchasePrice: number;
  totalFinanced: number | null;
  installments: number | null;
  installmentAmount: number | null;
  status: FinancingStatus;
  paidOffDate: string | null;
}

export interface FinancingFilters {
  vehicleId?: string;
  status?: FinancingStatus | '';
  sort?: string;
  page?: number;
  size?: number;
}


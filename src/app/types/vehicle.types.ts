export type VehicleType = 'CAR' | 'MOTORCYCLE';
export type FinancingStatus = 'ACTIVE' | 'PAID_OFF';
export type IpvaStatus = 'PAID' | 'PENDING' | 'OVERDUE';
export type VehicleStatus = 'AVAILABLE' | 'RENTED' | 'MAINTENANCE' | 'INACTIVE';
/** V31: combustível do veículo. Nullable — legado pode não ter valor. */
export type VehicleFuel =
  | 'GASOLINA'
  | 'ETANOL'
  | 'DIESEL'
  | 'FLEX'
  | 'GNV'
  | 'ELETRICO'
  | 'HIBRIDO';

export const VEHICLE_FUEL_OPTIONS: ReadonlyArray<{ value: VehicleFuel; label: string }> = [
  { value: 'GASOLINA', label: 'Gasolina' },
  { value: 'ETANOL', label: 'Etanol' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'FLEX', label: 'Flex' },
  { value: 'GNV', label: 'GNV' },
  { value: 'ELETRICO', label: 'Elétrico' },
  { value: 'HIBRIDO', label: 'Híbrido' },
];

import { IPVA_STATUS_OPTIONS as _IPVA_STATUS_OPTIONS } from '../utils/status-maps';

/**
 * @deprecated Import `IPVA_STATUS_OPTIONS` from `utils/status-maps.ts` instead.
 */
export const IPVA_STATUS_OPTIONS = _IPVA_STATUS_OPTIONS;

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
  status: VehicleStatus;
  createdDate: string;
  ipvaStatus?: IpvaStatus | null;
  ipvaExpired?: boolean;
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
  ipvaAmount: number | null;
  ipvaDueDate: string | null;
  ipvaStatus: IpvaStatus | null;
  ipvaExpired: boolean;
  status: VehicleStatus;
  fuel: VehicleFuel | null;
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
  ipvaAmount?: number | null;
  ipvaDueDate?: string | null;
  ipvaStatus?: IpvaStatus | null;
  fuel?: VehicleFuel | null;
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
  ipvaAmount?: number | null;
  ipvaDueDate?: string | null;
  ipvaStatus?: IpvaStatus | null;
  fuel?: VehicleFuel | null;
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
  status?: VehicleStatus | '';
  sort?: string;
  page?: number;
  size?: number;
  /**
   * Filtro do picker de "novo aluguel": quando `true`, o backend exclui
   * veículos já vinculados a rentals RESERVED/ACTIVE do tenant.
   */
  availableForRental?: boolean;
  /**
   * Modo edição do rental: inclui o veículo do rental sendo editado mesmo
   * que ele esteja em uso (escape hatch para não sumir da lista).
   */
  includeCurrentRentalId?: string;
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
  /**
   * Nº de parcelas em aberto vencidas — derivado no backend a partir de
   * `financing_installments`. `null` quando o financing ainda não tem
   * cronograma cadastrado (antigo, sem backfill).
   */
  overdueInstallments: number | null;
}

/**
 * Detailed financing view returned by `GET /v1/financings/{id}`.
 * Includes denormalized vehicle basics so the detail page renders in a single request.
 */
export interface FinancingDetail {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYearModel: number | null;
  contractDate: string;
  purchasePrice: number;
  downPayment: number | null;
  totalFinanced: number | null;
  installments: number | null;
  installmentAmount: number | null;
  status: FinancingStatus;
  paidOffDate: string | null;
  /**
   * Cronograma real vindo de `financing_installments` (V24). Vazio quando o
   * financing é antigo e não foi backfilleado — o UI deve tratar como "sem
   * cronograma disponível".
   */
  schedule: FinancingInstallment[];
}

export type FinancingInstallmentStatus = 'PAID' | 'OVERDUE' | 'PENDING';

/** Uma parcela real vinda de `financing_installments`. */
export interface FinancingInstallment {
  id: string;
  number: number;
  dueDate: string;
  amountCents: number;
  paidDate: string | null;
  paidAmountCents: number | null;
  status: FinancingInstallmentStatus;
}

export interface FinancingFilters {
  vehicleId?: string;
  status?: FinancingStatus | '';
  sort?: string;
  page?: number;
  size?: number;
}


export type MaintenanceType =
  | 'PREVENTIVE'
  | 'CORRECTIVE'
  | 'INSPECTION'
  | 'TIRE'
  | 'OIL'
  | 'OTHER';

export type MaintenanceStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'CANCELED';

import {
  MAINTENANCE_STATUS_FILTER_OPTIONS,
  MAINTENANCE_TYPE_FILTER_OPTIONS,
} from '../utils/status-maps';

/**
 * @deprecated Import `MAINTENANCE_TYPE_FILTER_OPTIONS` from
 * `utils/status-maps.ts` instead.
 */
export const MAINTENANCE_TYPE_OPTIONS = MAINTENANCE_TYPE_FILTER_OPTIONS;

/**
 * @deprecated Import `MAINTENANCE_STATUS_FILTER_OPTIONS` from
 * `utils/status-maps.ts` instead.
 */
export const MAINTENANCE_STATUS_OPTIONS = MAINTENANCE_STATUS_FILTER_OPTIONS;

export const MAINTENANCE_SORT_OPTIONS = [
  { value: 'service_date_desc', label: 'Serviço (recente)' },
  { value: 'service_date_asc', label: 'Serviço (antigo)' },
  { value: 'next_service_asc', label: 'Próximo serviço (próximo)' },
  { value: 'cost_desc', label: 'Custo (maior)' },
  { value: 'cost_asc', label: 'Custo (menor)' },
  { value: 'created_desc', label: 'Cadastro (recente)' },
  { value: 'created_asc', label: 'Cadastro (antigo)' },
] as const;

export interface MaintenanceListItem {
  id: string;
  vehicleId: string;
  type: MaintenanceType;
  description: string;
  /** ISO date */
  serviceDate: string;
  hodometerReading: number;
  costCents: number;
  /** ISO date */
  nextServiceDate: string | null;
  status: MaintenanceStatus;
  /** ISO date-time */
  createdDate: string;
}

export interface Maintenance {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  companyId: string;
  vehicleId: string;
  type: MaintenanceType;
  description: string;
  serviceDate: string;
  hodometerReading: number;
  costCents: number;
  provider: string | null;
  invoiceNumber: string | null;
  nextServiceDate: string | null;
  nextServiceHodometer: number | null;
  status: MaintenanceStatus;
  notes: string | null;
}

export interface CreateMaintenanceRequest {
  vehicleId: string;
  type: MaintenanceType;
  description: string;
  serviceDate: string;
  hodometerReading: number;
  costCents: number;
  provider?: string | null;
  invoiceNumber?: string | null;
  nextServiceDate?: string | null;
  nextServiceHodometer?: number | null;
  status?: MaintenanceStatus | null;
  notes?: string | null;
}

export interface UpdateMaintenanceRequest {
  type: MaintenanceType;
  description: string;
  serviceDate: string;
  hodometerReading: number;
  costCents: number;
  provider?: string | null;
  invoiceNumber?: string | null;
  nextServiceDate?: string | null;
  nextServiceHodometer?: number | null;
  status: MaintenanceStatus;
  notes?: string | null;
}

export interface MaintenanceFilters {
  vehicleId?: string;
  type?: MaintenanceType | '';
  status?: MaintenanceStatus | '';
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  size?: number;
}

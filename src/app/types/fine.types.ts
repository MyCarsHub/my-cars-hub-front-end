export type FineStatus = 'PENDING' | 'PAID' | 'CONTESTED' | 'CANCELED';
export type FineSeverity = 'LEVE' | 'MEDIA' | 'GRAVE' | 'GRAVISSIMA';

import {
  FINE_SEVERITY_FILTER_OPTIONS,
  FINE_STATUS_FILTER_OPTIONS,
} from '../utils/status-maps';

/**
 * @deprecated Import `FINE_STATUS_FILTER_OPTIONS` from
 * `utils/status-maps.ts` instead. Kept as a re-export to avoid breaking
 * existing consumers.
 */
export const FINE_STATUS_OPTIONS = FINE_STATUS_FILTER_OPTIONS;

/**
 * @deprecated Import `FINE_SEVERITY_FILTER_OPTIONS` from
 * `utils/status-maps.ts` instead.
 */
export const FINE_SEVERITY_OPTIONS = FINE_SEVERITY_FILTER_OPTIONS;

export const FINE_SORT_OPTIONS = [
  { value: 'infraction_date_desc', label: 'Data infração (recente)' },
  { value: 'infraction_date_asc', label: 'Data infração (antiga)' },
  { value: 'due_date_asc', label: 'Vencimento (próximo)' },
  { value: 'due_date_desc', label: 'Vencimento (distante)' },
  { value: 'amount_desc', label: 'Valor (maior)' },
  { value: 'amount_asc', label: 'Valor (menor)' },
  { value: 'created_desc', label: 'Cadastro (recente)' },
  { value: 'created_asc', label: 'Cadastro (antigo)' },
] as const;

/** Item as returned by the fleet-wide listing endpoint. */
export interface FineListItem {
  id: string;
  vehicleId: string;
  driverId: string | null;
  description: string;
  /** ISO date-time */
  infractionDate: string;
  amountCents: number;
  severity: FineSeverity;
  status: FineStatus;
  /** ISO date */
  dueDate: string | null;
  /** ISO date-time */
  createdDate: string;
}

export interface Fine {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  companyId: string;
  vehicleId: string;
  driverId: string | null;
  infractionCode: string | null;
  description: string;
  infractionDate: string;
  location: string | null;
  amountCents: number;
  points: number | null;
  severity: FineSeverity;
  dueDate: string | null;
  status: FineStatus;
  paidDate: string | null;
  notes: string | null;
}

export interface CreateFineRequest {
  vehicleId: string;
  driverId?: string | null;
  infractionCode?: string | null;
  description: string;
  /** ISO date-time (yyyy-MM-ddTHH:mm:ss) */
  infractionDate: string;
  location?: string | null;
  amountCents: number;
  points?: number | null;
  severity: FineSeverity;
  dueDate?: string | null;
  status?: FineStatus | null;
  paidDate?: string | null;
  notes?: string | null;
}

export interface UpdateFineRequest {
  driverId?: string | null;
  infractionCode?: string | null;
  description: string;
  infractionDate: string;
  location?: string | null;
  amountCents: number;
  points?: number | null;
  severity: FineSeverity;
  dueDate?: string | null;
  status: FineStatus;
  paidDate?: string | null;
  notes?: string | null;
}

export interface PayFineRequest {
  /** ISO date */
  paidDate?: string;
}

export interface FineFilters {
  vehicleId?: string;
  driverId?: string;
  status?: FineStatus | '';
  severity?: FineSeverity | '';
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  size?: number;
}

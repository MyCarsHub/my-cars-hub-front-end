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

export const MAINTENANCE_TYPE_OPTIONS: Array<{
  value: MaintenanceType | '';
  label: string;
  chip: string;
}> = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'PREVENTIVE', label: 'Preventiva', chip: 'bg-emerald-100 text-emerald-800' },
  { value: 'CORRECTIVE', label: 'Corretiva', chip: 'bg-rose-100 text-rose-700' },
  { value: 'INSPECTION', label: 'Inspeção', chip: 'bg-blue-100 text-blue-700' },
  { value: 'TIRE', label: 'Pneus', chip: 'bg-amber-100 text-amber-800' },
  { value: 'OIL', label: 'Óleo/filtros', chip: 'bg-orange-100 text-orange-800' },
  { value: 'OTHER', label: 'Outros', chip: 'bg-neutral-200 text-neutral-700' },
];

export const MAINTENANCE_STATUS_OPTIONS: Array<{
  value: MaintenanceStatus | '';
  label: string;
  chip: string;
}> = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'SCHEDULED', label: 'Agendada', chip: 'bg-blue-100 text-blue-700' },
  { value: 'IN_PROGRESS', label: 'Em andamento', chip: 'bg-amber-100 text-amber-800' },
  { value: 'DONE', label: 'Concluída', chip: 'bg-emerald-100 text-emerald-800' },
  { value: 'CANCELED', label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700' },
];

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

export type FineStatus = 'PENDING' | 'PAID' | 'CONTESTED' | 'CANCELED';
export type FineSeverity = 'LEVE' | 'MEDIA' | 'GRAVE' | 'GRAVISSIMA';

export const FINE_STATUS_OPTIONS: Array<{
  value: FineStatus | '';
  label: string;
  chip: string;
}> = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'PENDING', label: 'Pendente', chip: 'bg-amber-100 text-amber-800' },
  { value: 'PAID', label: 'Paga', chip: 'bg-emerald-100 text-emerald-800' },
  { value: 'CONTESTED', label: 'Contestada', chip: 'bg-blue-100 text-blue-700' },
  { value: 'CANCELED', label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700' },
];

export const FINE_SEVERITY_OPTIONS: Array<{
  value: FineSeverity | '';
  label: string;
  chip: string;
  defaultPoints: number;
}> = [
  { value: '', label: 'Todas', chip: 'bg-neutral-100 text-neutral-700', defaultPoints: 0 },
  { value: 'LEVE', label: 'Leve', chip: 'bg-emerald-100 text-emerald-800', defaultPoints: 3 },
  { value: 'MEDIA', label: 'Média', chip: 'bg-amber-100 text-amber-800', defaultPoints: 4 },
  { value: 'GRAVE', label: 'Grave', chip: 'bg-orange-100 text-orange-800', defaultPoints: 5 },
  {
    value: 'GRAVISSIMA',
    label: 'Gravíssima',
    chip: 'bg-rose-100 text-rose-700',
    defaultPoints: 7,
  },
];

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

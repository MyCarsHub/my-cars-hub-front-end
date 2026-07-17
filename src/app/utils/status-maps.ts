/**
 * Central source-of-truth for status labels / chip colors for the three
 * operational status enums exposed by the backend:
 * - Driver  → AVAILABLE | WORKING | SUSPENDED
 * - Rental  → RESERVED  | ACTIVE  | COMPLETED | CANCELED
 * - Vehicle → AVAILABLE | RENTED  | MAINTENANCE | INACTIVE
 *
 * Every page that renders a status badge / chip / dropdown MUST read from
 * these maps so labels and colors stay consistent across the app.
 *
 * The enum values themselves match the backend (see
 * `br.com.my_cars_hub.my_cars_hub.domain.enumerated.*StatusEnum`) — do NOT
 * translate the raw values, only their `label`.
 */

import { DriverStatus } from '../types/driver.types';
import { RentalStatus } from '../types/rental.types';
import type {
  FineSeverity,
  FineStatus,
} from '../types/fine.types';
import type {
  MaintenanceStatus,
  MaintenanceType,
} from '../types/maintenance.types';
import type { FinancingStatus, IpvaStatus } from '../types/vehicle.types';

export type VehicleStatus = 'AVAILABLE' | 'RENTED' | 'MAINTENANCE' | 'INACTIVE';

export interface StatusMeta {
  /** Human-friendly PT-BR label rendered inside the badge. */
  label: string;
  /** Tailwind classes (bg + text) — apply via `[class]` binding. */
  chip: string;
  /** Solid hex color for inline SVG charts (dashboard sparklines etc.). */
  color: string;
}

// ---------------------------------------------------------------- driver

export const DRIVER_STATUS_META: Record<DriverStatus, StatusMeta> = {
  AVAILABLE: {
    label: 'Disponível',
    chip: 'bg-emerald-100 text-emerald-800',
    color: '#10b981',
  },
  WORKING: {
    label: 'Em serviço',
    chip: 'bg-blue-100 text-blue-700',
    color: '#3b82f6',
  },
  SUSPENDED: {
    label: 'Suspenso',
    chip: 'bg-red-100 text-red-700',
    color: '#ef4444',
  },
};

export function driverStatusMeta(status: DriverStatus): StatusMeta {
  return DRIVER_STATUS_META[status];
}

// ---------------------------------------------------------------- rental

export const RENTAL_STATUS_META: Record<RentalStatus, StatusMeta> = {
  RESERVED: {
    label: 'Reservado',
    chip: 'bg-amber-100 text-amber-800',
    color: '#f59e0b',
  },
  ACTIVE: {
    label: 'Ativo',
    chip: 'bg-blue-100 text-blue-800',
    color: '#3b82f6',
  },
  COMPLETED: {
    label: 'Concluído',
    chip: 'bg-emerald-100 text-emerald-800',
    color: '#10b981',
  },
  CANCELED: {
    label: 'Cancelado',
    chip: 'bg-neutral-200 text-neutral-700',
    color: '#6b7280',
  },
};

export function rentalStatusMeta(status: RentalStatus): StatusMeta {
  return RENTAL_STATUS_META[status];
}

// --------------------------------------------------------------- vehicle

export const VEHICLE_STATUS_META: Record<VehicleStatus, StatusMeta> = {
  AVAILABLE: {
    label: 'Disponível',
    chip: 'bg-emerald-100 text-emerald-800',
    color: '#10b981',
  },
  RENTED: {
    label: 'Alugado',
    chip: 'bg-blue-100 text-blue-700',
    color: '#3b82f6',
  },
  MAINTENANCE: {
    label: 'Manutenção',
    chip: 'bg-amber-100 text-amber-800',
    color: '#f59e0b',
  },
  INACTIVE: {
    label: 'Inativo',
    chip: 'bg-neutral-200 text-neutral-700',
    color: '#6b7280',
  },
};

export function vehicleStatusMeta(status: VehicleStatus | string | null | undefined): StatusMeta {
  if (status && status in VEHICLE_STATUS_META) {
    return VEHICLE_STATUS_META[status as VehicleStatus];
  }
  return { label: '—', chip: 'bg-neutral-100 text-neutral-700', color: '#6b7280' };
}

// --------------------------------------------------- filter option lists

interface FilterOption<T extends string> {
  value: T | '';
  label: string;
  chip: string;
}

export const DRIVER_STATUS_FILTER_OPTIONS: FilterOption<DriverStatus>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'AVAILABLE', label: 'Disponível', chip: DRIVER_STATUS_META.AVAILABLE.chip },
  { value: 'WORKING', label: 'Em serviço', chip: DRIVER_STATUS_META.WORKING.chip },
  { value: 'SUSPENDED', label: 'Suspenso', chip: DRIVER_STATUS_META.SUSPENDED.chip },
];

export const RENTAL_STATUS_FILTER_OPTIONS: FilterOption<RentalStatus>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'RESERVED', label: 'Reservados', chip: RENTAL_STATUS_META.RESERVED.chip },
  { value: 'ACTIVE', label: 'Ativos', chip: RENTAL_STATUS_META.ACTIVE.chip },
  { value: 'COMPLETED', label: 'Concluídos', chip: RENTAL_STATUS_META.COMPLETED.chip },
  { value: 'CANCELED', label: 'Cancelados', chip: RENTAL_STATUS_META.CANCELED.chip },
];

export const VEHICLE_STATUS_FILTER_OPTIONS: FilterOption<VehicleStatus>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'AVAILABLE', label: 'Disponível', chip: VEHICLE_STATUS_META.AVAILABLE.chip },
  { value: 'RENTED', label: 'Alugado', chip: VEHICLE_STATUS_META.RENTED.chip },
  { value: 'MAINTENANCE', label: 'Manutenção', chip: VEHICLE_STATUS_META.MAINTENANCE.chip },
  { value: 'INACTIVE', label: 'Inativo', chip: VEHICLE_STATUS_META.INACTIVE.chip },
];

// ------------------------------------------------------------------ fine
// FineStatus and FineSeverity used to live in `types/fine.types.ts`; the
// exports there are now `@deprecated` re-exports of these constants.

export const FINE_STATUS_META: Record<FineStatus, StatusMeta> = {
  PENDING: { label: 'Pendente', chip: 'bg-amber-100 text-amber-800', color: '#f59e0b' },
  PAID: { label: 'Paga', chip: 'bg-emerald-100 text-emerald-800', color: '#10b981' },
  CONTESTED: { label: 'Contestada', chip: 'bg-blue-100 text-blue-700', color: '#3b82f6' },
  CANCELED: { label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700', color: '#6b7280' },
};

export const FINE_STATUS_FILTER_OPTIONS: FilterOption<FineStatus>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'PENDING', label: FINE_STATUS_META.PENDING.label, chip: FINE_STATUS_META.PENDING.chip },
  { value: 'PAID', label: FINE_STATUS_META.PAID.label, chip: FINE_STATUS_META.PAID.chip },
  { value: 'CONTESTED', label: FINE_STATUS_META.CONTESTED.label, chip: FINE_STATUS_META.CONTESTED.chip },
  { value: 'CANCELED', label: FINE_STATUS_META.CANCELED.label, chip: FINE_STATUS_META.CANCELED.chip },
];

export interface FineSeverityMeta extends StatusMeta {
  defaultPoints: number;
}

export const FINE_SEVERITY_META: Record<FineSeverity, FineSeverityMeta> = {
  LEVE: { label: 'Leve', chip: 'bg-emerald-100 text-emerald-800', color: '#10b981', defaultPoints: 3 },
  MEDIA: { label: 'Média', chip: 'bg-amber-100 text-amber-800', color: '#f59e0b', defaultPoints: 4 },
  GRAVE: { label: 'Grave', chip: 'bg-orange-100 text-orange-800', color: '#f97316', defaultPoints: 5 },
  GRAVISSIMA: { label: 'Gravíssima', chip: 'bg-rose-100 text-rose-700', color: '#ef4444', defaultPoints: 7 },
};

export const FINE_SEVERITY_FILTER_OPTIONS: Array<
  FilterOption<FineSeverity> & { defaultPoints: number }
> = [
  { value: '', label: 'Todas', chip: 'bg-neutral-100 text-neutral-700', defaultPoints: 0 },
  { value: 'LEVE', label: FINE_SEVERITY_META.LEVE.label, chip: FINE_SEVERITY_META.LEVE.chip, defaultPoints: 3 },
  { value: 'MEDIA', label: FINE_SEVERITY_META.MEDIA.label, chip: FINE_SEVERITY_META.MEDIA.chip, defaultPoints: 4 },
  { value: 'GRAVE', label: FINE_SEVERITY_META.GRAVE.label, chip: FINE_SEVERITY_META.GRAVE.chip, defaultPoints: 5 },
  { value: 'GRAVISSIMA', label: FINE_SEVERITY_META.GRAVISSIMA.label, chip: FINE_SEVERITY_META.GRAVISSIMA.chip, defaultPoints: 7 },
];

// ----------------------------------------------------------- maintenance

export const MAINTENANCE_STATUS_META: Record<MaintenanceStatus, StatusMeta> = {
  SCHEDULED: { label: 'Agendada', chip: 'bg-blue-100 text-blue-700', color: '#3b82f6' },
  IN_PROGRESS: { label: 'Em andamento', chip: 'bg-amber-100 text-amber-800', color: '#f59e0b' },
  DONE: { label: 'Concluída', chip: 'bg-emerald-100 text-emerald-800', color: '#10b981' },
  CANCELED: { label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700', color: '#6b7280' },
};

export const MAINTENANCE_STATUS_FILTER_OPTIONS: FilterOption<MaintenanceStatus>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'SCHEDULED', label: MAINTENANCE_STATUS_META.SCHEDULED.label, chip: MAINTENANCE_STATUS_META.SCHEDULED.chip },
  { value: 'IN_PROGRESS', label: MAINTENANCE_STATUS_META.IN_PROGRESS.label, chip: MAINTENANCE_STATUS_META.IN_PROGRESS.chip },
  { value: 'DONE', label: MAINTENANCE_STATUS_META.DONE.label, chip: MAINTENANCE_STATUS_META.DONE.chip },
  { value: 'CANCELED', label: MAINTENANCE_STATUS_META.CANCELED.label, chip: MAINTENANCE_STATUS_META.CANCELED.chip },
];

export const MAINTENANCE_TYPE_META: Record<MaintenanceType, StatusMeta> = {
  PREVENTIVE: { label: 'Preventiva', chip: 'bg-emerald-100 text-emerald-800', color: '#10b981' },
  CORRECTIVE: { label: 'Corretiva', chip: 'bg-rose-100 text-rose-700', color: '#ef4444' },
  INSPECTION: { label: 'Inspeção', chip: 'bg-blue-100 text-blue-700', color: '#3b82f6' },
  TIRE: { label: 'Pneus', chip: 'bg-amber-100 text-amber-800', color: '#f59e0b' },
  OIL: { label: 'Óleo/filtros', chip: 'bg-orange-100 text-orange-800', color: '#f97316' },
  OTHER: { label: 'Outros', chip: 'bg-neutral-200 text-neutral-700', color: '#6b7280' },
};

export const MAINTENANCE_TYPE_FILTER_OPTIONS: FilterOption<MaintenanceType>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'PREVENTIVE', label: MAINTENANCE_TYPE_META.PREVENTIVE.label, chip: MAINTENANCE_TYPE_META.PREVENTIVE.chip },
  { value: 'CORRECTIVE', label: MAINTENANCE_TYPE_META.CORRECTIVE.label, chip: MAINTENANCE_TYPE_META.CORRECTIVE.chip },
  { value: 'INSPECTION', label: MAINTENANCE_TYPE_META.INSPECTION.label, chip: MAINTENANCE_TYPE_META.INSPECTION.chip },
  { value: 'TIRE', label: MAINTENANCE_TYPE_META.TIRE.label, chip: MAINTENANCE_TYPE_META.TIRE.chip },
  { value: 'OIL', label: MAINTENANCE_TYPE_META.OIL.label, chip: MAINTENANCE_TYPE_META.OIL.chip },
  { value: 'OTHER', label: MAINTENANCE_TYPE_META.OTHER.label, chip: MAINTENANCE_TYPE_META.OTHER.chip },
];

// ------------------------------------------------------------------ ipva

export const IPVA_STATUS_META: Record<IpvaStatus, StatusMeta> = {
  PAID: { label: 'Pago', chip: 'bg-emerald-100 text-emerald-800', color: '#10b981' },
  PENDING: { label: 'Pendente', chip: 'bg-amber-100 text-amber-800', color: '#f59e0b' },
  OVERDUE: { label: 'Vencido', chip: 'bg-rose-100 text-rose-700', color: '#ef4444' },
};

/**
 * IPVA status options exposed as a plain `{value,label}` array — the vehicle
 * form uses this directly as `<select>` options.
 */
export const IPVA_STATUS_OPTIONS: Array<{ value: IpvaStatus; label: string }> = [
  { value: 'PAID', label: IPVA_STATUS_META.PAID.label },
  { value: 'PENDING', label: IPVA_STATUS_META.PENDING.label },
  { value: 'OVERDUE', label: IPVA_STATUS_META.OVERDUE.label },
];

// ------------------------------------------------------------- financing

export const FINANCING_STATUS_META: Record<FinancingStatus, StatusMeta> = {
  ACTIVE: { label: 'Ativo', chip: 'bg-blue-100 text-blue-700', color: '#3b82f6' },
  PAID_OFF: { label: 'Quitado', chip: 'bg-emerald-100 text-emerald-800', color: '#10b981' },
};

export const FINANCING_STATUS_FILTER_OPTIONS: FilterOption<FinancingStatus>[] = [
  { value: '', label: 'Todos', chip: 'bg-neutral-100 text-neutral-700' },
  { value: 'ACTIVE', label: FINANCING_STATUS_META.ACTIVE.label, chip: FINANCING_STATUS_META.ACTIVE.chip },
  { value: 'PAID_OFF', label: FINANCING_STATUS_META.PAID_OFF.label, chip: FINANCING_STATUS_META.PAID_OFF.chip },
];

// ------------------------------------------- licensing expiration badge

export interface LicensingBadge {
  label: string;
  chip: string;
}

/**
 * Consolidated licensing / due-date badge. Given an ISO date (`yyyy-MM-dd` or
 * full ISO), returns a consistent label + Tailwind chip class:
 *   - null/empty → neutral "Sem data"
 *   - past date  → rose "Vencido"
 *   - ≤ 30 days  → amber "Vence em Nd"
 *   - otherwise  → emerald "Em dia até dd/MM/yyyy"
 *
 * Rule extracted from the three inline implementations that existed in
 * `vehicles-list`, `vehicle-gerencia-hub`, and `maintenance-detail`.
 */
export function licensingBadge(iso: string | null | undefined): LicensingBadge {
  if (!iso) {
    return { label: 'Sem data', chip: 'bg-neutral-200 text-neutral-700' };
  }
  const raw = iso.length === 10 ? iso + 'T00:00:00' : iso;
  const expiry = new Date(raw).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((expiry - today) / 86400000);
  if (days < 0) {
    return { label: 'Vencido', chip: 'bg-rose-100 text-rose-700' };
  }
  if (days <= 30) {
    return { label: `Vence em ${days} dias`, chip: 'bg-amber-100 text-amber-800' };
  }
  const formatted = new Date(raw).toLocaleDateString('pt-BR');
  return { label: `Em dia até ${formatted}`, chip: 'bg-emerald-100 text-emerald-700' };
}

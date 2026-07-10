import { PagedResponse } from './paged.types';

export type RentalStatus = 'RESERVED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
export type ChargeKind = 'RENTAL_TOTAL' | 'CAUCAO';
export type ChargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'RELEASED';
export type RentalBillingFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const BILLING_FREQUENCY_OPTIONS: Array<{
  value: RentalBillingFrequency;
  label: string;
  shortLabel: string;
  perUnitLabel: string;
}> = [
  { value: 'DAILY', label: 'Diária', shortLabel: 'Diária', perUnitLabel: 'diária' },
  { value: 'WEEKLY', label: 'Semanal', shortLabel: 'Semanal', perUnitLabel: 'semanal' },
  { value: 'MONTHLY', label: 'Mensal', shortLabel: 'Mensal', perUnitLabel: 'mensal' },
];

export function billingFrequencyLabel(f: RentalBillingFrequency): string {
  return BILLING_FREQUENCY_OPTIONS.find((o) => o.value === f)?.label ?? f;
}

/**
 * Label for the rental's `dailyRate` field, adapted to the billing frequency.
 *
 * IMPORTANT: `rentals.daily_rate` is a misnomer — the value stored is
 * semantically "amount per billing period" (per day if DAILY, per week if
 * WEEKLY, per month if MONTHLY). The DB column will be renamed in a future
 * migration (tracked in FIXES.md).
 */
export function rentalRateLabel(f: RentalBillingFrequency): string {
  switch (f) {
    case 'WEEKLY':
      return 'Valor semanal';
    case 'MONTHLY':
      return 'Valor mensal';
    case 'DAILY':
    default:
      return 'Valor diário';
  }
}

export interface RentalChargeDto {
  id: string;
  kind: ChargeKind;
  amount: number; // cents
  status: ChargeStatus;
  provider: 'ASAAS';
  externalId: string | null;
  checkoutUrl: string | null;
  paidAt: string | null; // ISO
}

export interface RentalResponseDto {
  id: string;
  vehicleId: string;
  driverId: string;
  startDate: string; // yyyy-MM-dd
  endDate: string;
  /**
   * Amount per billing period (in cents). Despite the name, this is NOT
   * always per-day: it's per-day if `billingFrequency === 'DAILY'`, per-week
   * if 'WEEKLY', per-month if 'MONTHLY'. The DB column keeps the legacy name
   * `daily_rate`; rename tracked in FIXES.md.
   */
  dailyRate: number; // cents
  totalAmount: number; // cents
  caucaoAmount: number; // cents; 0 = sem caução
  status: RentalStatus;
  billingFrequency: RentalBillingFrequency;
  /**
   * When true, backend generates Asaas charges automatically and moves the
   * rental to ACTIVE via webhook. When false, the owner activates manually via
   * POST /rentals/{id}/activate — no Asaas interaction.
   */
  automaticCharge?: boolean;
  notes: string | null;
  charges: RentalChargeDto[];
  createdAt: string;
  modifiedAt: string;
}

export interface RentalListItemDto {
  id: string;
  vehicleId: string;
  driverId: string;
  startDate: string;
  endDate: string;
  totalAmount: number;
  caucaoAmount: number;
  status: RentalStatus;
  billingFrequency: RentalBillingFrequency;
  /**
   * When true, activation happens automatically via Asaas webhook after
   * payment confirmation. Manual activate endpoint returns 409 in that case.
   */
  automaticCharge?: boolean;
}

export interface RentalUpdateRequest {
  vehicleId: string;
  driverId: string;
  startDate: string;
  endDate: string;
  dailyRate: number;
  billingFrequency: RentalBillingFrequency;
  caucaoAmount?: number;
  notes?: string;
}

export interface CreateRentalRequest {
  vehicleId: string;
  driverId: string;
  startDate: string;
  endDate: string;
  dailyRate: number; // cents
  billingFrequency: RentalBillingFrequency;
  caucaoAmount?: number; // cents, default 0
  /**
   * When true, backend integrates with Asaas and generates charges.
   * When false (default), rental is just registered and owner activates manually.
   */
  automaticCharge?: boolean;
  notes?: string;
}

export interface RentalFilters {
  status?: RentalStatus | '';
  vehicleId?: string;
  driverId?: string;
  /** Period lower bound (yyyy-MM-dd). Backend uses overlap semantics. */
  from?: string;
  /** Period upper bound (yyyy-MM-dd). */
  to?: string;
  page?: number;
  size?: number;
}

/**
 * @deprecated Use `PagedResponse<T>` from `types/paged.types.ts` instead.
 * Kept as a type alias so existing rentals imports don't break.
 */
export type RentalPagedResponse<T> = PagedResponse<T>;

/**
 * Rental status filter options + label/chip resolver — re-exported from the
 * central `utils/status-maps.ts` to keep this module as a stable public
 * surface for the rentals feature.
 */
import {
  RENTAL_STATUS_FILTER_OPTIONS,
  rentalStatusMeta,
} from '../utils/status-maps';

export const RENTAL_STATUS_OPTIONS = RENTAL_STATUS_FILTER_OPTIONS;

export function rentalStatusInfo(status: RentalStatus): { label: string; chip: string } {
  const meta = rentalStatusMeta(status);
  return { label: meta.label, chip: meta.chip };
}

export function chargeStatusInfo(status: ChargeStatus): { label: string; chip: string } {
  const map: Record<ChargeStatus, { label: string; chip: string }> = {
    PENDING: { label: 'Pendente', chip: 'bg-amber-100 text-amber-800' },
    PAID: { label: 'Pago', chip: 'bg-emerald-100 text-emerald-800' },
    FAILED: { label: 'Falhou', chip: 'bg-rose-100 text-rose-700' },
    REFUNDED: { label: 'Reembolsado', chip: 'bg-blue-100 text-blue-800' },
    RELEASED: { label: 'Liberado', chip: 'bg-neutral-200 text-neutral-700' },
  };
  return map[status];
}

export function chargeKindLabel(kind: ChargeKind): string {
  return kind === 'RENTAL_TOTAL' ? 'Aluguel' : 'Caução';
}

/**
 * Timeline entry retornada por `GET /v1/rentals/{id}/history`.
 * `fromStatus` é null no evento inicial (create → RESERVED). `changedByName`
 * pode vir null quando o usuário original foi removido ou quando a transição
 * foi disparada por um webhook sem contexto de usuário.
 */
export interface RentalStatusHistoryDto {
  id: string;
  fromStatus: RentalStatus | null;
  toStatus: RentalStatus;
  changedBy: string | null;
  changedByName: string | null;
  reason: string | null;
  createdAt: string;
}

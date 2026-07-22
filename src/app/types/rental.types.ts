import { PagedResponse } from './paged.types';

export type RentalStatus = 'RESERVED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
export type ChargeKind = 'RENTAL_TOTAL' | 'CAUCAO';
export type ChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'PAST_DUE'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'RELEASED';
export type RentalBillingFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
/** V29: fonte do PDF de contrato — AUTO (gera do template) ou MANUAL (upload). */
export type RentalContractSource = 'AUTO' | 'MANUAL';
/** V29: unidade da multa de atraso — PERCENT (basis-points 0-10000) ou FIXED (centavos). */
export type RentalLateFineType = 'PERCENT' | 'FIXED';

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
 * Label for the rental's `periodRate` field, adapted to the billing frequency.
 *
 * The stored value is "amount per billing period" — per day if DAILY,
 * per week if WEEKLY, per month if MONTHLY.
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
   * Amount per billing period (in cents). Per-day if
   * `billingFrequency === 'DAILY'`, per-week if 'WEEKLY',
   * per-month if 'MONTHLY'.
   */
  periodRate: number; // cents
  totalAmount: number; // cents
  caucaoAmount: number; // cents; 0 = sem caução
  /**
   * True quando o proprietário marcou a caução como recebida "por fora"
   * (dinheiro / PIX manual) — impede geração de nova cobrança de caução.
   */
  caucaoPaid: boolean;
  status: RentalStatus;
  billingFrequency: RentalBillingFrequency;
  /**
   * When true, backend generates Asaas charges automatically and moves the
   * rental to ACTIVE via webhook. When false, the owner activates manually via
   * POST /rentals/{id}/activate — no Asaas interaction.
   */
  automaticCharge?: boolean;
  notes: string | null;
  // V29: campos financeiros + fonte do contrato
  initialKm: number | null;
  pickupDate: string | null; // ISO
  firstPaymentDate: string | null; // yyyy-MM-dd
  dailyInterestAmount: number | null; // cents/day
  lateFineType: RentalLateFineType | null;
  lateFineValue: number | null; // PERCENT: basis-points; FIXED: cents
  contractSource: RentalContractSource | null;
  // V32
  franchiseKm: number | null;
  returnFuelPolicy: string | null;
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
  periodRate: number;
  billingFrequency: RentalBillingFrequency;
  caucaoAmount?: number;
  /** Marca a caução como recebida fora do sistema (dinheiro / PIX manual). */
  caucaoPaid?: boolean;
  notes?: string;
  // V29: campos financeiros editáveis (contractSource é imutável após create)
  initialKm?: number | null;
  pickupDate?: string | null;
  firstPaymentDate?: string | null;
  dailyInterestAmount?: number | null;
  lateFineType?: RentalLateFineType | null;
  lateFineValue?: number | null;
  // V32
  franchiseKm?: number | null;
  returnFuelPolicy?: string | null;
}

export interface CreateRentalRequest {
  vehicleId: string;
  driverId: string;
  startDate: string;
  endDate: string;
  periodRate: number; // cents
  billingFrequency: RentalBillingFrequency;
  caucaoAmount?: number; // cents, default 0
  /** Marca a caução como recebida fora do sistema (dinheiro / PIX manual). */
  caucaoPaid?: boolean;
  /**
   * When true, backend integrates with Asaas and generates charges.
   * When false (default), rental is just registered and owner activates manually.
   */
  automaticCharge?: boolean;
  notes?: string;
  // V29: campos financeiros + fonte do contrato
  initialKm?: number | null;
  pickupDate?: string | null;
  firstPaymentDate?: string | null;
  dailyInterestAmount?: number | null;
  lateFineType?: RentalLateFineType | null;
  lateFineValue?: number | null;
  /**
   * AUTO: gera contrato do template configurado. Null → backend infere (AUTO
   * se company tem template, senão MANUAL). AUTO sem template retorna 409.
   */
  contractSource?: RentalContractSource | null;
  // V32
  franchiseKm?: number | null;
  returnFuelPolicy?: string | null;
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
    PAST_DUE: { label: 'Atrasada', chip: 'bg-amber-100 text-amber-700' },
    FAILED: { label: 'Falhou', chip: 'bg-rose-100 text-rose-700' },
    CANCELED: { label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700' },
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

export type RentalDocumentKind = 'CONTRACT' | 'CHECKIN' | 'CHECKOUT';

/**
 * Metadata do PDF armazenado no Supabase Storage. Nunca inclui a URL —
 * o frontend obtém acesso via GET .../documents/{id}/signed-url que devolve
 * uma URL temporária.
 */
export interface RentalDocumentDto {
  id: string;
  rentalId: string;
  kind: RentalDocumentKind;
  mimeType: string;
  sizeBytes: number | null;
  generated: boolean;
  uploadedBy: string | null;
  createdDate: string;
}

export interface SignedUrlDto {
  url: string;
  expiresInSeconds: number;
}

export type SignatureStatus = 'NOT_REQUIRED' | 'PENDING' | 'SIGNED' | 'REFUSED' | 'EXPIRED';
export type SignatureProvider = 'AUTENTIQUE' | 'DOCUSIGN';

export interface SignatureStatusDto {
  documentId: string;
  status: SignatureStatus;
  provider: SignatureProvider | null;
  externalDocumentId: string | null;
  signedAt: string | null;
}

export interface SignerRequest {
  name: string;
  email: string;
}

export type RentalPhotoKind = 'CHECKIN' | 'CHECKOUT';
export type RentalPhotoAngle =
  | 'FRONT'
  | 'BACK'
  | 'LEFT'
  | 'RIGHT'
  | 'FRONT_LEFT_PANEL'
  | 'FRONT_RIGHT_PANEL'
  | 'REAR_LEFT_PANEL'
  | 'REAR_RIGHT_PANEL'
  | 'ENGINE'
  | 'TRUNK'
  | 'DASHBOARD'
  | 'ODOMETER'
  | 'FRONT_SEAT'
  | 'REAR_SEAT';

/**
 * Ordem canônica de renderização dos 14 slots — casa com o enum e o grid do PDF
 * gerado pelo backend (RentalPhotoAngleEnum). Não reordenar sem sincronizar.
 */
export const RENTAL_PHOTO_ANGLES: Array<{ value: RentalPhotoAngle; label: string }> = [
  { value: 'FRONT', label: 'Frente' },
  { value: 'BACK', label: 'Traseira' },
  { value: 'LEFT', label: 'Lateral esquerda' },
  { value: 'RIGHT', label: 'Lateral direita' },
  { value: 'FRONT_LEFT_PANEL', label: 'Painel dianteiro esquerdo' },
  { value: 'FRONT_RIGHT_PANEL', label: 'Painel dianteiro direito' },
  { value: 'REAR_LEFT_PANEL', label: 'Painel traseiro esquerdo' },
  { value: 'REAR_RIGHT_PANEL', label: 'Painel traseiro direito' },
  { value: 'ENGINE', label: 'Motor' },
  { value: 'TRUNK', label: 'Porta-malas' },
  { value: 'DASHBOARD', label: 'Painel' },
  { value: 'ODOMETER', label: 'Hodômetro' },
  { value: 'FRONT_SEAT', label: 'Banco dianteiro' },
  { value: 'REAR_SEAT', label: 'Banco traseiro' },
];

/**
 * Foto de vistoria com signedUrl inline. O backend embute o signedUrl
 * na listagem para evitar N+1 round-trips ao renderizar previews.
 */
export interface RentalPhotoDto {
  id: string;
  rentalId: string;
  kind: RentalPhotoKind;
  angle: RentalPhotoAngle;
  mimeType: string;
  sizeBytes: number | null;
  signedUrl: string | null;
  createdDate: string;
}

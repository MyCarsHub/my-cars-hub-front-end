import {
  ChargePlanDto,
  CreateRentalRequest,
  RentalBillingFrequency,
  RentalLateFineType,
  RentalPreflightRequest,
} from '../../../types/rental.types';
import { ptBrMoneyCents } from '../../../utils/validators/ptbr-money.validator';

/**
 * Os valores crus do Novo aluguel, com os MESMOS nomes e tipos dos controles do formulário de
 * hoje (`rental-form.ts`). O passo a passo monta este objeto e o corpo sai daqui; o spec de
 * paridade prova que, para as mesmas entradas, o corpo é idêntico ao do formulário de hoje.
 */
export interface RentalCreateRaw {
  vehicleId: string;
  driverId: string;
  startDate: string;
  endDate: string;
  billingFrequency: RentalBillingFrequency;
  periodRateReais: string;
  caucaoReais: string;
  caucaoPaid: boolean;
  automaticCharge: boolean;
  notes: string;
  initialKm: number | null;
  /** `yyyy-MM-ddTHH:mm`. */
  pickupDate: string;
  firstPaymentDate: string;
  lateInterestPercent: string;
  lateFineType: RentalLateFineType;
  /** PERCENT: número (2 = 2%). FIXED: texto pt-BR em reais. */
  lateFineValueInput: number | string;
  franchiseKm: number | null;
  extraKmPriceReais: string;
  returnFuelPolicy: string;
  useContractTemplate: boolean;
}

/** Corpo do create — a mesma regra, campo a campo, de `RentalForm.buildCreatePayload`. */
export function buildCreateBody(raw: RentalCreateRaw, chargePlan: ChargePlanDto | null): CreateRentalRequest {
  const caucao = ptBrMoneyCents(raw.caucaoReais) ?? 0;
  return {
    vehicleId: raw.vehicleId,
    driverId: raw.driverId,
    startDate: raw.startDate,
    endDate: raw.endDate,
    periodRate: ptBrMoneyCents(raw.periodRateReais) ?? 0,
    billingFrequency: raw.billingFrequency,
    caucaoAmount: caucao,
    caucaoPaid: caucao > 0 ? raw.caucaoPaid === true : false,
    automaticCharge: raw.automaticCharge === true,
    notes: raw.notes?.trim() || undefined,
    initialKm: raw.initialKm ?? null,
    pickupDate: raw.pickupDate || null,
    firstPaymentDate: raw.firstPaymentDate?.trim() || null,
    ...interestFields(raw),
    ...lateFineFields(raw),
    franchiseKm: raw.franchiseKm ?? null,
    returnFuelPolicy: raw.returnFuelPolicy?.trim() || null,
    extraKmPrice: extraKmPriceCents(raw),
    contractSource: raw.useContractTemplate ? 'AUTO' : 'MANUAL',
    ...(chargePlan ? { chargePlan } : {}),
  };
}

/** O preflight recebe o corpo do create sem o plano (contrato B1/B2), como hoje. */
export function buildPreflightBody(raw: RentalCreateRaw): RentalPreflightRequest {
  return buildCreateBody(raw, null);
}

function interestFields(raw: RentalCreateRaw): { lateInterestPercentPerMonth?: number } {
  const hundredths = ptBrMoneyCents(raw.lateInterestPercent);
  return hundredths !== null ? { lateInterestPercentPerMonth: hundredths / 100 } : {};
}

function lateFineFields(raw: RentalCreateRaw): { lateFineType: RentalLateFineType; lateFineValue: number } {
  const lateFineType = raw.lateFineType;
  const v = raw.lateFineValueInput;
  const lateFineValue =
    lateFineType === 'FIXED'
      ? (ptBrMoneyCents(typeof v === 'string' ? v : '') ?? 0)
      : percentToBasisPoints(Number(v ?? 0));
  return { lateFineType, lateFineValue };
}

function percentToBasisPoints(input: number): number {
  if (!Number.isFinite(input) || input <= 0) return 0;
  return Math.round(input * 100);
}

function extraKmPriceCents(raw: RentalCreateRaw): number | null {
  if (!((Number(raw.franchiseKm) || 0) > 0)) return null;
  const cents = ptBrMoneyCents(raw.extraKmPriceReais);
  return cents && cents > 0 ? cents : null;
}

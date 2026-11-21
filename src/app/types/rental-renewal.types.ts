/**
 * V151 — renovação de aluguel ATIVO (`POST /v1/rentals/{id}/renew-preview` e `/renew`).
 * Espelho de `RenewRentalRequestDto` e `RenewalPreviewResponseDto` do backend. Dinheiro em
 * centavos, datas `yyyy-MM-dd`. Mês = 30 dias, semana = 7.
 */

export type RenewalUnit = 'DAYS' | 'WEEKS' | 'MONTHS';

export interface RenewRentalRequest {
  /** 1..1000, na unidade `unit`. */
  additionalAmount: number;
  unit: RenewalUnit;
  /** Valor de cada período NOVO; ausente = o atual. As cobranças existentes nunca mudam. */
  periodRate?: number;
  /** O fim que a tela mostrou. Obrigatório no `renew` (diferente do atual → 409 `RENEWAL_STALE`). */
  expectedEndDate?: string;
}

export interface RenewalPeriodDto {
  /** Índice do período (continua depois do último existente; 0-based). */
  index: number;
  startDate: string;
  /** Último dia do período (inclusivo). */
  endDate: string;
  dueDate: string;
  amountCents: number;
  destination: 'ASAAS' | 'LOCAL';
}

export interface RenewalBlockerDto {
  /** Os mesmos códigos do 409/400 do `renew`. */
  code: string;
  message: string;
  /** Só em `VEHICLE_PERIOD_TAKEN`: até quando dá para renovar (início da próxima reserva). */
  maxEndDate: string | null;
}

/** Sempre 200; nada é gravado e nenhum gateway é chamado. */
export interface RenewalPreviewDto {
  previousEndDate: string;
  newEndDate: string;
  additionalDays: number;
  periodRate: number;
  periods: RenewalPeriodDto[];
  addedTotalCents: number;
  newTotalAmount: number;
  gatewayCount: number;
  localCount: number;
  /** Cobranças vencidas que o aluguel já tem; continuam como estão (informativo). */
  overdueCount: number;
  blocker: RenewalBlockerDto | null;
}

/** Códigos estáveis do backend (`RentalRenewalService.CODE_*`). */
export const RENEWAL_CODES = {
  NOT_ACTIVE: 'RENEWAL_NOT_ACTIVE',
  STALE: 'RENEWAL_STALE',
  VEHICLE_PERIOD_TAKEN: 'VEHICLE_PERIOD_TAKEN',
  VEHICLE_SOLD: 'VEHICLE_SOLD',
  INTEGRATION_NOT_CONNECTED: 'RENEWAL_INTEGRATION_NOT_CONNECTED',
  END_IN_PAST: 'RENEWAL_END_IN_PAST',
  HORIZON_EXCEEDED: 'RENEWAL_HORIZON_EXCEEDED',
  AMOUNT_TOO_HIGH: 'RENEWAL_AMOUNT_TOO_HIGH',
  BELOW_MIN_CHARGE: 'RENEWAL_BELOW_MIN_CHARGE',
} as const;

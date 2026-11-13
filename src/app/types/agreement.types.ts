import { ChargeKind, ChargePreviewDestination, ChargeStatus, RentalChargeDto, RentalChargeSyncDto } from './rental.types';

/**
 * FEAT-0573 — Cobranças flexíveis: acordo (renegociação) e recebida por fora.
 * Espelha o contrato B3–B6 do design (`I_design.md`). Dinheiro em centavos, datas yyyy-MM-dd.
 */

/** Motivos do acordo (decisão do coordenador G1, lista do canvas aprovado). */
export type AgreementReason =
  | 'DRIVER_ASKED_FOR_TIME'
  | 'DEBT_AGREEMENT'
  | 'WRONG_VALUE'
  | 'CAR_STOPPED'
  | 'OTHER';

export const AGREEMENT_REASON_OPTIONS: ReadonlyArray<{ value: AgreementReason; label: string }> = [
  { value: 'DRIVER_ASKED_FOR_TIME', label: 'Pediu prazo' },
  { value: 'DEBT_AGREEMENT', label: 'Acordo de dívida' },
  { value: 'WRONG_VALUE', label: 'Valor errado' },
  { value: 'CAR_STOPPED', label: 'Carro parado' },
  { value: 'OTHER', label: 'Outro' },
];

export function agreementReasonLabel(reason: string | null | undefined): string {
  return AGREEMENT_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? 'Outro';
}

/** Motivos da recebida por fora (G1). */
export type ReceivedOutsideReason = 'CASH' | 'PIX_DIRECT' | 'BANK_TRANSFER' | 'OTHER';

export const RECEIVED_OUTSIDE_REASON_OPTIONS: ReadonlyArray<{
  value: ReceivedOutsideReason;
  label: string;
}> = [
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'PIX_DIRECT', label: 'Pix direto' },
  { value: 'BANK_TRANSFER', label: 'Transferência' },
  { value: 'OTHER', label: 'Outra forma' },
];

export interface AgreementInstalmentRequest {
  dueDate: string;
  amountCents: number;
}

/** B3/B4 — corpo de `agreements/preview` e de `agreements`. */
export interface AgreementRequestDto {
  sourceChargeIds: string[];
  reason: AgreementReason;
  description: string;
  agreedTotalCents: number;
  instalments: AgreementInstalmentRequest[];
}

export interface AgreementPreviewSourceDto {
  chargeId: string;
  kind: ChargeKind;
  periodIndex: number | null;
  instalmentIndex: number;
  instalmentCount: number;
  agreementSeq: number | null;
  amountCents: number;
  dueDate: string | null;
  effectiveStatus: ChargeStatus;
}

export interface AgreementPreviewInstalmentDto {
  instalmentIndex: number;
  instalmentCount: number;
  dueDate: string;
  amountCents: number;
  fineFixedCents: number | null;
  destination: ChargePreviewDestination;
}

/** B3 — resposta 200; validação volta em `blocker` (nada gravado). */
export interface AgreementPreviewDto {
  sources: AgreementPreviewSourceDto[];
  originalTotalCents: number;
  agreedTotalCents: number;
  /** agreed − original; negativo = desconto. */
  differenceCents: number;
  instalments: AgreementPreviewInstalmentDto[];
  lastDueDate: string | null;
  blocker: { code: string; message: string } | null;
}

export type AgreementStatus = 'CANCELLING' | 'ISSUING' | 'ACTIVE' | 'ABORTED' | 'NEEDS_ATTENTION';

export interface AgreementSourceDto {
  chargeId: string;
  kind: ChargeKind;
  periodIndex: number | null;
  instalmentIndex: number;
  instalmentCount: number;
  originalStatus: ChargeStatus;
  originalAmountCents: number;
  originalDueDate: string | null;
  fromAgreementId: string | null;
  fromAgreementSeq: number | null;
}

/** B5 — `AgreementDto`. */
export interface AgreementDto {
  id: string;
  seq: number;
  rentalId: string;
  status: AgreementStatus;
  createdAt: string;
  createdBy: { userId: string; name: string; role: 'OWNER' | 'MANAGER' } | null;
  reason: AgreementReason;
  description: string;
  originalTotalCents: number;
  agreedTotalCents: number;
  differenceCents: number;
  sources: AgreementSourceDto[];
  instalments: RentalChargeDto[];
  parentAgreementIds: string[];
  childAgreementIds: string[];
  chargeSync: RentalChargeSyncDto | null;
}

/** B6 — corpo de `received-outside`. */
export interface ReceivedOutsideRequestDto {
  receivedOn: string;
  reason: ReceivedOutsideReason;
  note: string | null;
}

/** Limites do contrato usados pela interface (o backend revalida tudo). */
export const AGREEMENT_LIMITS = {
  maxSources: 50,
  maxInstalments: 24,
  descriptionMin: 5,
  descriptionMax: 500,
  /** Mínimo por cobrança que vai ao Asaas (R$ 5,00). */
  minGatewayCents: 500,
} as const;

/** Mensagens pt-BR por código de recusa do acordo (B4) — fallback quando o corpo não traz texto. */
export const AGREEMENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AGREEMENT_SOURCES_EMPTY: 'Escolha ao menos uma cobrança.',
  AGREEMENT_REASON_INVALID: 'Escolha um motivo da lista.',
  AGREEMENT_DESCRIPTION_REQUIRED: 'Descreva o que foi combinado (mínimo 5 caracteres).',
  RENTAL_NOT_RENEGOTIABLE: 'Aluguel cancelado não pode ser renegociado.',
  AGREEMENT_SOURCE_NOT_OPEN: 'Uma das cobranças não está mais pendente, atrasada nem falhada.',
  AGREEMENT_SOURCE_KIND: 'Só caução, períodos e parcelas de acordo podem ser renegociados.',
  AGREEMENT_SOURCE_BUSY: 'Uma das cobranças está sendo processada agora. Tente de novo em instantes.',
  AGREEMENT_SOURCE_ALREADY_PAID:
    'Uma das cobranças já foi paga. Atualizamos a lista; revise o acordo.',
  AGREEMENT_GATEWAY_CANCEL_FAILED:
    'Não conseguimos cancelar uma das cobranças. Nada foi alterado; tente de novo.',
  AGREEMENT_NEEDS_ATTENTION:
    'Uma etapa do acordo não foi confirmada. O suporte foi avisado; não refaça o acordo.',
  IDEMPOTENCY_KEY_REUSED: 'Este acordo já foi enviado com outro conteúdo. Feche e comece de novo.',
  CHARGES_FLEX_DISABLED: 'Este recurso ainda não está liberado para a sua conta.',
  CHARGES_FLEX_SUPPORT_SESSION:
    'A sessão de suporte não pode renegociar nem registrar recebimento por fora.',
};

/** Mensagens pt-BR por código de recusa da recebida por fora (B6). */
export const RECEIVED_OUTSIDE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  RECEIVED_OUTSIDE_MANUAL_RENTAL: 'Em aluguel manual use “Marcar como paga”.',
  RECEIVED_OUTSIDE_NOT_OPEN:
    'Só cobrança pendente, atrasada ou falhada pode ser registrada como recebida por fora.',
  RECEIVED_OUTSIDE_KIND: 'Este tipo de cobrança não pode ser registrado como recebido por fora.',
  RECEIVED_OUTSIDE_DATE: 'A data não pode ser futura nem anterior ao início do aluguel.',
  RECEIVED_OUTSIDE_ALREADY_PAID: 'Esta cobrança já tinha sido paga pelo Pix; atualizamos a lista.',
  RECEIVED_OUTSIDE_INCONCLUSIVE:
    'Não conseguimos confirmar o cancelamento do Pix. Nada foi alterado; tente de novo.',
  CHARGE_BUSY: 'A cobrança está sendo processada agora.',
  CHARGES_FLEX_DISABLED: 'Este recurso ainda não está liberado para a sua conta.',
  CHARGES_FLEX_SUPPORT_SESSION:
    'A sessão de suporte não pode renegociar nem registrar recebimento por fora.',
};

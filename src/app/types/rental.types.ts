import { OverdueFeeSummary } from './overdue.types';
import { PagedResponse } from './paged.types';

export type RentalStatus = 'RESERVED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
export type ChargeKind = 'RENTAL_TOTAL' | 'RENTAL_PERIOD' | 'CAUCAO' | 'OVERDUE_FEE';
export type ChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'PAST_DUE'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'RELEASED'
  | 'DISPUTED';
export type RentalBillingFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
/** Método de devolução da caução no fechamento (complete/cancel). */
export type CaucaoRefundMethod = 'AUTOMATIC' | 'MANUAL' | 'NONE';

/** Payload opcional de devolução da caução enviado em complete/cancel. */
export interface CaucaoRefundPayload {
  amount: number; // cents (long)
  method: CaucaoRefundMethod;
}

/**
 * Payload opcional do POST /rentals/{id}/complete. Todos os campos são
 * opcionais — endpoint aceita body vazio.
 */
export interface CompleteRentalPayload {
  completedAt?: string; // yyyy-MM-dd
  /**
   * V53 — data E HORA da devolução, em horário local, **sem offset**
   * (`2026-07-22T23:00:00`). Só existe para decidir a multa por atraso: a
   * tolerância é contada em horas e sem hora não haveria como aplicá-la.
   * Quando vem junto de `completedAt`, as duas datas precisam coincidir.
   */
  actualReturnAt?: string;
  endReason?: string; // <= 500
  caucaoRefund?: CaucaoRefundPayload;
  /**
   * Opt-in destrutivo: apaga também no Asaas as cobranças vencidas e não pagas.
   * Default `false` no backend — as vencidas ficam e seguem cobráveis.
   */
  removeOverdueCharges?: boolean;
}

/**
 * Payload opcional do POST /rentals/{id}/cancel. Mesma shape do complete,
 * porém com `canceledAt` em vez de `completedAt`.
 */
export interface CancelRentalPayload {
  canceledAt?: string; // yyyy-MM-dd
  endReason?: string; // <= 500
  caucaoRefund?: CaucaoRefundPayload;
  /** Ver {@link CompleteRentalPayload.removeOverdueCharges}. */
  removeOverdueCharges?: boolean;
}

/**
 * FEAT-0345/0347 — desfecho REAL de cada cobrança quando o admin, em sessão de EDIÇÃO,
 * cancela ou exclui um aluguel. Só vem nessa sessão.
 */
export type ChargeRemovalOutcome =
  | 'REMOVED_AT_GATEWAY'
  | 'NO_GATEWAY_LINK'
  | 'REMOVAL_REFUSED'
  | 'ALREADY_CLOSED'
  | 'NOT_CANCELED'
  | 'KEPT_PAID'
  | 'KEPT_OVERDUE'
  | 'KEPT_DISPUTED'
  | 'KEPT_CLOSED';

export interface RentalChargeRemovalDto {
  chargeId: string;
  kind: ChargeKind;
  /** Centavos. */
  amount: number;
  outcome: ChargeRemovalOutcome;
  /** Texto pt-BR para o operador (sem dado pessoal). */
  message: string;
}

/** POST /rentals/{id}/cancel em sessão de suporte: o aluguel (campos no topo) + desfechos. */
export type RentalSupportCancelResponse = RentalResponseDto & {
  chargeRemovals: RentalChargeRemovalDto[];
};

/** DELETE /rentals/{id} em sessão de suporte (200, não 204). */
export interface RentalSupportDeleteResponse {
  rentalId: string;
  chargeRemovals: RentalChargeRemovalDto[];
}

export function caucaoRefundMethodLabel(m: CaucaoRefundMethod): string {
  switch (m) {
    case 'AUTOMATIC':
      return 'Automática';
    case 'MANUAL':
      return 'Manual';
    case 'NONE':
      return 'Não devolvida';
  }
}
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
  /** V29+/#46 — per-period bookkeeping. Null for legacy RENTAL_TOTAL/CAUCAO. */
  dueDate: string | null; // yyyy-MM-dd
  periodIndex: number | null;
  /**
   * FIX-0753/0755 — por que a emissão no gateway falhou. Só vem em `FAILED`:
   * código estável + mensagem pt-BR já legível ao locador. Ausente/nulo nas demais.
   */
  failureCode?: string | null;
  failureReason?: string | null;
}

/** Desfecho de `POST /v1/rentals/{rentalId}/charges/{chargeId}/cancel`. */
export type ChargeCancelOutcome =
  | 'REMOVED_AT_GATEWAY'
  | 'NO_GATEWAY_LINK'
  | 'REMOVAL_PENDING_SWEEP'
  | 'ALREADY_CLOSED'
  | 'ALREADY_PAID';

export interface ChargeCancelResponse {
  outcome: ChargeCancelOutcome;
  status: string;
  hint: string | null;
}

/**
 * Resultado da emissão no gateway, devolvido APENAS pelo `POST /v1/rentals`
 * (aditivo: respostas antigas e o GET não o trazem).
 *
 * `failed > 0` quer dizer que o aluguel EXISTE mas parte das cobranças não foi
 * criada no Asaas agora — o backend tenta de novo sozinho e cada linha FAILED
 * tem "Regerar". `local` são as que nunca iriam ao gateway (vencimento passado).
 */
export interface RentalChargeSyncDto {
  requested: number;
  created: number;
  failed: number;
  local: number;
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
  dailyInterestAmount: number | null; // cents/day — LEGADO: aluguel novo usa o % ao mês
  /** Juros de mora em % ao mês (2 casas). Nulo em aluguel legado (só R$/dia). */
  lateInterestPercentPerMonth?: number | null;
  lateFineType: RentalLateFineType | null;
  lateFineValue: number | null; // PERCENT: basis-points; FIXED: cents
  contractSource: RentalContractSource | null;
  // V32
  franchiseKm: number | null;
  returnFuelPolicy: string | null;
  charges: RentalChargeDto[];
  /** Só na resposta do create. Ver {@link RentalChargeSyncDto}. */
  chargeSync?: RentalChargeSyncDto | null;
  createdAt: string;
  modifiedAt: string;
  // Encerramento (COMPLETED / CANCELED).
  /** True quando o encerramento ocorreu antes do endDate programado. */
  endedEarly?: boolean;
  /** Motivo livre (<=500) informado ao concluir/cancelar. */
  endReason?: string | null;
  /** Valor da caução efetivamente devolvido (cents). */
  caucaoRefundedAmount?: number | null;
  /** Timestamp ISO da devolução da caução. */
  caucaoRefundedAt?: string | null;
  /** Método de devolução escolhido no encerramento. */
  caucaoRefundMethod?: CaucaoRefundMethod | null;
  /** Data de conclusão (yyyy-MM-dd). Presente quando status=COMPLETED. */
  completedAt?: string | null;
  /** Data de cancelamento (yyyy-MM-dd). Presente quando status=CANCELED. */
  canceledAt?: string | null;
  /**
   * V53 — a conta da multa por devolução em atraso, quando houve uma. `null`
   * (ou ausente) significa que nada foi cobrado: devolução no prazo, aluguel
   * ainda não concluído, ou multa de zero centavo, que o backend nunca lança.
   */
  overdueFee?: OverdueFeeSummary | null;
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
   * payment confirmation. Manual activation stays available regardless — the
   * activate endpoint no longer requires a confirmed payment.
   */
  automaticCharge?: boolean;
  /*
   * DENORMALIZADOS na linha, para a lista nao precisar de `/v1/vehicles` nem de
   * `/v1/drivers`. O MOTORISTA nao alcanca esses dois (403), entao antes ele via
   * "—" em placa e motorista; agora a propria linha diz.
   *
   * Opcionais de proposito: uma resposta anterior nao os manda, e a lista cai no
   * cadastro carregado (OWNER/MANAGER) em vez de mostrar "undefined".
   */
  vehiclePlate?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  driverName?: string | null;
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
  /** Juros de mora em % ao mês (até 2 casas). Omitido na edição = mantém o do aluguel. */
  lateInterestPercentPerMonth?: number | null;
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
  /** Aluguel novo não usa juros em R$/dia: > 0 é recusado (DAILY_INTEREST_DEPRECATED). */
  dailyInterestAmount?: number | null;
  /** Juros de mora em % ao mês (até 2 casas). Omitido = sem juros. */
  lateInterestPercentPerMonth?: number | null;
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

/**
 * Chave do `state` de navegação com que o formulário entrega o `chargeSync` ao
 * detalhe logo após criar. É estado de UMA navegação (não persiste em recarga),
 * porque o aviso só é verdade no instante da criação.
 */
export const RENTAL_CHARGE_SYNC_STATE_KEY = 'chargeSync';

/** Para onde a cobrança da prévia vai: gateway (Asaas) ou só registro local. */
export type ChargePreviewDestination = 'ASAAS' | 'LOCAL';

export interface RentalChargePreviewItemDto {
  kind: 'RENTAL_PERIOD' | 'CAUCAO';
  index: number;
  dueDate: string; // yyyy-MM-dd
  amountCents: number;
  destination: ChargePreviewDestination;
}

/** Motivo pelo qual o aluguel NÃO pode ser criado com estes dados. */
export interface RentalChargePreviewBlockerDto {
  code: string;
  message: string;
}

/**
 * `POST /v1/rentals/charge-preview` — mesmo corpo do create, nada é gravado e
 * nenhum gateway é chamado. É o que o diálogo de confirmação mostra.
 */
export interface RentalChargePreviewDto {
  automaticCharge: boolean;
  willCreateInGateway: boolean;
  charges: RentalChargePreviewItemDto[];
  totalCents: number;
  gatewayCount: number;
  localCount: number;
  firstDueDate: string | null;
  blocker: RentalChargePreviewBlockerDto | null;
}

/**
 * `POST /v1/rentals/{id}/charges/{chargeId}/reconcile` — o gateway é consultado
 * e o veredito COPIADO; nunca é baixa manual. `NO_CHANGE` inclui "inconclusivo".
 */
export interface RentalChargeReconcileDto {
  outcome: 'SYNCED' | 'NO_CHANGE';
  /** Veredito cru do gateway — para dizer ao dono o que o provedor respondeu. */
  remoteStatus: string | null;
  /** Status local depois da reconciliação. */
  status: ChargeStatus;
}

/**
 * Resultado de `POST /v1/rentals/{id}/charges/{chargeId}/retry`.
 *
 * `CANCELED` e `SKIPPED` são os dois desfechos em que NADA foi reemitido: o
 * aluguel já não estava em andamento (ou a caução foi recebida por fora), ou a
 * cobrança mudou de estado no meio da chamada (ex.: webhook de pagamento).
 */
export interface RentalChargeRetryDto {
  outcome: 'RETRIED' | 'ALREADY_PAID' | 'ALREADY_REFUNDED' | 'CANCELED' | 'SKIPPED';
  externalId: string | null;
  checkoutUrl: string | null;
  retryCount: number;
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

const CHARGE_STATUS_META: Record<ChargeStatus, { label: string; chip: string }> = {
  PENDING: { label: 'Pendente', chip: 'bg-amber-100 text-amber-800' },
  PAID: { label: 'Pago', chip: 'bg-emerald-100 text-emerald-800' },
  PAST_DUE: { label: 'Atrasada', chip: 'bg-rose-100 text-rose-700' },
  FAILED: { label: 'Falhou', chip: 'bg-rose-100 text-rose-700' },
  CANCELED: { label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700' },
  REFUNDED: { label: 'Reembolsado', chip: 'bg-blue-100 text-blue-800' },
  RELEASED: { label: 'Liberado', chip: 'bg-neutral-200 text-neutral-700' },
  DISPUTED: { label: 'Contestada', chip: 'bg-purple-100 text-purple-700' },
};

/** O par (status, vencimento) — o mínimo pra decidir se uma cobrança atrasou. */
export type ChargeStatusSource = Pick<RentalChargeDto, 'status' | 'dueDate'>;

/**
 * Atraso derivado em tempo de LEITURA — nunca persistido.
 *
 * `rental_charges.status` só vira `PAST_DUE` pelo webhook `PAYMENT_OVERDUE` do
 * Asaas, então aluguel manual (e qualquer linha que não passe pelo provedor)
 * ficaria `PENDING` pra sempre mesmo vencida, e a tela de detalhes chamava isso
 * de "Pendente".
 *
 * Mesmo precedente do `VehicleService.loadSchedule`, que deriva `OVERDUE` das
 * parcelas de financiamento na leitura em vez de gravar a transição.
 *
 * Regra (espelha `AsaasChargeService.isHistorical` no backend):
 *  - só `PENDING` pode virar atrasada — `PAID`/`CANCELED`/`REFUNDED`/
 *    `RELEASED`/`FAILED`/`DISPUTED` mandam no próprio chip;
 *  - `dueDate` nulo NÃO é atraso (linhas legadas `RENTAL_TOTAL`/`CAUCAO`);
 *  - estritamente ANTES de hoje — vencer hoje ainda não é atraso.
 *
 * DIVERGÊNCIA CONHECIDA, ainda aberta. O dashboard NÃO usa esta regra: lá o
 * critério é `status='PENDING' AND COALESCE(due_date, created_date + INTERVAL
 * '30 days') < CURRENT_DATE`. Ou seja, uma `PENDING` com `dueDate` nulo criada
 * há mais de 30 dias conta como atrasada no dashboard e continua "Pendente"
 * aqui. O frontend NÃO consegue fechar essa lacuna: `RentalChargeDto` não
 * carrega data de criação. Unificar as duas regras é outro nó — não tente
 * resolver aqui.
 *
 * `today` é OBRIGATÓRIO de propósito. Um default `= todayInBusinessTz()`
 * deixaria qualquer chamador futuro reabrir um segundo relógio sem querer, que
 * é exatamente o que faria o chip e o contador "N atrasada(s)" divergirem numa
 * virada de meia-noite — e nenhum teste pegaria. Quem chama decide o "hoje", e
 * decide UMA vez. Formato `yyyy-MM-dd` no fuso de negócio, o mesmo de
 * `dueDate`, então comparar as strings já é comparar as datas.
 */
export function isChargeOverdue(charge: ChargeStatusSource, today: string): boolean {
  if (charge.status !== 'PENDING') return false;
  if (!charge.dueDate) return false;
  return charge.dueDate < today;
}

/** Status que a UI deve exibir: o do backend, ou `PAST_DUE` quando derivado. */
export function effectiveChargeStatus(charge: ChargeStatusSource, today: string): ChargeStatus {
  return isChargeOverdue(charge, today) ? 'PAST_DUE' : charge.status;
}

export function chargeStatusInfo(
  charge: ChargeStatusSource,
  today: string,
): { label: string; chip: string } {
  return CHARGE_STATUS_META[effectiveChargeStatus(charge, today)];
}

export function chargeKindLabel(kind: ChargeKind): string {
  const map: Record<ChargeKind, string> = {
    RENTAL_TOTAL: 'Aluguel',
    RENTAL_PERIOD: 'Aluguel — período',
    CAUCAO: 'Caução',
    OVERDUE_FEE: 'Multa por atraso',
  };
  return map[kind];
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
/** `MANUAL` = contrato em papel marcado como assinado pelo operador (sem provider). */
export type SignatureProvider = 'AUTENTIQUE' | 'DOCUSIGN' | 'MANUAL';

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
  | 'FRONT_LEFT_TIRE'
  | 'FRONT_RIGHT_TIRE'
  | 'REAR_LEFT_TIRE'
  | 'REAR_RIGHT_TIRE'
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
  { value: 'FRONT_LEFT_TIRE', label: 'Pneu dianteiro esquerdo' },
  { value: 'FRONT_RIGHT_TIRE', label: 'Pneu dianteiro direito' },
  { value: 'REAR_LEFT_TIRE', label: 'Pneu traseiro esquerdo' },
  { value: 'REAR_RIGHT_TIRE', label: 'Pneu traseiro direito' },
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

// ---------------------------------------------------------------------------
// FIX-0752/0754 — preflight de aluguel. A regra vive SÓ no backend; estes tipos
// só descrevem o que ele devolve (200 do preflight e 400 do create/edit).
// ---------------------------------------------------------------------------

export type RentalPreflightSeverity = 'BLOCKING' | 'WARNING';

export interface RentalPreflightItem {
  /** Nome do campo do corpo do create (ou `driver.<campo>`); nulo = sem campo. */
  field: string | null;
  /** Código estável (UPPER_SNAKE): a tela decide pelo código, não pelo texto. */
  code: string;
  message: string;
  /** O que o campo aceita, em texto pronto para exibir. */
  acceptedValue: string | null;
  severity: RentalPreflightSeverity;
}

export interface RentalPreflightRange {
  min: number | null;
  /** Nulo = teto não configurado. */
  max: number | null;
}

export interface RentalPreflightLimits {
  /** Em percentual (1 = 1% ao mês). */
  interestPercentPerMonth: RentalPreflightRange | null;
  /** Em percentual (2 = 2%); a multa % é gravada em basis points. */
  finePercent: RentalPreflightRange | null;
  /** Menor cobrança emitida menos 1 centavo; nulo = nenhuma cobrança leva encargos. */
  fixedFineMaxCents: number | null;
  minChargeCents: number | null;
}

export interface RentalPreflightResponse {
  ok: boolean;
  issues: RentalPreflightItem[];
  warnings: RentalPreflightItem[];
  limits: RentalPreflightLimits | null;
}

/** Corpo do preflight: o do create, mais `rentalId` quando for edição. */
export type RentalPreflightRequest = CreateRentalRequest & { rentalId?: string };

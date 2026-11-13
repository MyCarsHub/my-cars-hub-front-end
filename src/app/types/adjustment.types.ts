/**
 * Ajustes (V141): cobrança avulsa a um motorista, paga por Pix, em `/v1/adjustments`.
 *
 * O contrato é o do back-end (`AdjustmentDto`, `AdjustmentListResponseDto`,
 * `AdjustmentCreateRequestDto`): nada aqui foi inventado. Só OWNER e MANAGER chegam a estas
 * rotas; o DRIVER leva 403 no filtro do back-end e nem vê o item do menu.
 *
 * Não existem, de propósito: gerar de novo (o back-end responde 409), cancelar e marcar como
 * paga. A tela não oferece nenhum dos três.
 */

/**
 * `ISSUING` (emissão não confirmada, termina sozinha), `ISSUE_FAILED` (nada foi cobrado) ou o
 * status da cobrança. Um status que este build não conhece chega como string e cai no chip
 * neutro, sem ação.
 */
export type AdjustmentStatus =
  | 'ISSUING'
  | 'ISSUE_FAILED'
  | 'PENDING'
  | 'PAST_DUE'
  | 'PAID'
  | 'CANCELED'
  | 'FAILED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'RENEGOTIATED';

/** Filtro das pílulas (`status=` da lista). `ALL` não vai na URL. */
export type AdjustmentStatusFilter = 'ALL' | 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELED';

export type AdjustmentHistoryType =
  | 'CREATED'
  | 'PIX_ISSUED'
  | 'OVERDUE'
  | 'PAID'
  | 'CANCELED'
  | 'ISSUE_FAILED';

/** Cartão "Motorista" do detalhe; o telefone já vem mascarado. */
export interface AdjustmentDriverCard {
  id: string;
  name: string;
  licenseCategory: string | null;
  phoneMasked: string | null;
  otherAdjustments: number;
}

export interface AdjustmentHistoryEntry {
  type: AdjustmentHistoryType | string;
  /** `LocalDateTime` sem fuso. */
  at: string;
  /** Só em CREATED e CANCELED. */
  actorName: string | null;
}

/** Uma linha de PgAjustes; o detalhe acrescenta `driver` e `history` (nulos na lista). */
export interface Adjustment {
  id: string;
  driverId: string;
  driverName: string;
  description: string;
  amountCents: number;
  /** `yyyy-MM-dd`. */
  dueDate: string;
  status: AdjustmentStatus | string;
  /** Sempre `PIX`. */
  paymentMethod: string;
  paidAt: string | null;
  paidAmountCents: number | null;
  createdAt: string | null;
  createdByName: string | null;
  issuedAt: string | null;
  canceledAt: string | null;
  failureReason: string | null;
  /** O copia-e-cola pode ser pedido em `GET /v1/rentals/{rentalId}/charges/{chargeId}/pix`. */
  pixAvailable: boolean;
  rentalId: string | null;
  chargeId: string | null;
  driver: AdjustmentDriverCard | null;
  history: AdjustmentHistoryEntry[] | null;
}

/** "A receber" (abertas e não vencidas), "Recebido no mês" (caixa), "Atrasados". */
export interface AdjustmentSummary {
  toReceiveCents: number;
  toReceiveCount: number;
  toReceiveDrivers: number;
  receivedCents: number;
  receivedCount: number;
  overdueCents: number;
  overdueCount: number;
}

/** Contagens das pílulas: respeitam mês, motorista e busca, ignoram o filtro de status. */
export interface AdjustmentStatusCounts {
  all: number;
  pending: number;
  overdue: number;
  paid: number;
  canceled: number;
}

export interface AdjustmentListResponse {
  /** `yyyy-MM`. */
  month: string;
  summary: AdjustmentSummary;
  statusCounts: AdjustmentStatusCounts;
  page: {
    content: Adjustment[];
    page: number;
    size: number;
    total: number;
  };
}

export interface AdjustmentListQuery {
  month: string;
  status: AdjustmentStatusFilter;
  driverId: string;
  q: string;
  page: number;
  size: number;
}

/** Corpo do "Novo ajuste". Sem aluguel e sem forma de pagamento: o servidor escolhe. */
export interface AdjustmentCreateRequest {
  driverId: string;
  amountCents: number;
  dueDate: string;
  description: string;
}

/**
 * Tetos repetidos do back-end (`AdjustmentService`): acima deles a API responde 400, então a
 * tela recusa antes de enviar.
 */
export const ADJUSTMENT_MAX_AMOUNT_CENTS = 10_000_000;
export const ADJUSTMENT_MAX_DUE_DAYS_AHEAD = 365;
export const ADJUSTMENT_DESCRIPTION_MAX = 300;
export const ADJUSTMENT_QUERY_MAX = 100;

/**
 * Vehicle insurance ("Seguros") — apólices vinculadas a um veículo.
 *
 * Contrato do backend:
 * - `GET/POST    /v1/vehicles/{vehicleId}/insurances`
 * - `PATCH       /v1/vehicles/{vehicleId}/insurances/{id}`
 * - `PATCH       /v1/vehicles/{vehicleId}/insurances/{id}/cancel`
 * - `DELETE      /v1/vehicles/{vehicleId}/insurances/{id}`
 * - `GET         /v1/insurances` (paginado) e `GET /v1/insurances/{id}`
 *
 * Apólice em PDF (OWNER/MANAGER pra mutar, leitura pra qualquer membro):
 * - `POST/DELETE /v1/insurances/{id}/policy-document`
 * - `GET         /v1/insurances/{id}/policy-document/signed-url`
 *
 * Parcelamento do prêmio:
 * - `GET/POST/DELETE /v1/insurances/{id}/installments`
 * - `PATCH           /v1/insurances/{id}/installments/{installmentId}/pay|unpay`
 *
 * Valores monetários trafegam em CENTAVOS inteiros; datas em ISO (`yyyy-MM-dd`).
 */

export type InsuranceStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';

export type InsuranceCoverage = 'COMPREHENSIVE' | 'THEFT' | 'THIRD_PARTY';

/**
 * Forma de pagamento do prêmio. Enum VALIDADO no backend — texto livre passou a
 * responder 400 com `fieldErrors`. `null` continua sendo um valor aceito.
 */
export type InsurancePaymentMethod =
  | 'PIX'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'BANK_TRANSFER'
  | 'CASH'
  | 'DIRECT_DEBIT'
  | 'OTHER';

/**
 * Metadados do PDF da apólice — espelha `InsurancePolicyDocumentDto` do backend.
 *
 * NÃO existe `id`: o documento é 1:1 com a apólice e todos os endpoints são
 * `/v1/insurances/{insuranceId}/policy-document`, sem id de documento na URL.
 * Também não existe `storagePath` — o bucket é privado e o download passa
 * obrigatoriamente por signed URL.
 *
 * Os campos são anuláveis por serem tipos boxed no record Java; a UI degrada
 * para "—" em vez de renderizar `undefined`.
 */
export interface InsurancePolicyDocument {
  insuranceId: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  /** `LocalDateTime` — chega SEM offset (ex.: `2026-02-10T12:00:00`). */
  uploadedAt: string | null;
}

/**
 * Resposta de `GET .../policy-document/signed-url` — espelha
 * `PolicyDocumentUrlDto`. TTL definido pelo backend.
 */
export interface InsuranceSignedUrl {
  url: string;
  expiresInSeconds: number;
}

/**
 * Uma parcela do prêmio.
 *
 * O backend distribui o resto da divisão centavo a centavo nas PRIMEIRAS
 * parcelas: R$ 1.000,00 em 3x vira 333,34 / 333,33 / 333,33. A soma fecha o
 * prêmio exatamente e duas parcelas nunca diferem por mais de 1 centavo — isso
 * é o comportamento correto, a tela não "corrige" nada.
 */
export interface InsuranceInstallment {
  id: string;
  insuranceId: string;
  /** 1-based. */
  number: number;
  dueDate: string;
  amountCents: number;
  paidDate: string | null;
  paidAmountCents: number | null;
  paid: boolean;
}

/** Body de `POST .../installments`. Devolve o cronograma COMPLETO. */
export interface GenerateInsuranceInstallmentsRequest {
  /** 1..120 (validado no backend). */
  installments: number;
  /** Vencimento da 1ª parcela. Ausente = backend decide. */
  firstDueDate?: string | null;
}

/** Body OPCIONAL de `PATCH .../installments/{id}/pay`. */
export interface PayInsuranceInstallmentRequest {
  paidDate?: string | null;
  paidAmountCents?: number | null;
}

/** Apólice como devolvida pelos endpoints escopados no veículo. */
export interface Insurance {
  id: string;
  vehicleId: string;
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  /** Prêmio em centavos. */
  premiumAmount: number;
  /** Franquia em centavos. Nullable. */
  deductibleAmount: number | null;
  startDate: string;
  endDate: string;
  paymentMethod: InsurancePaymentMethod | null;
  status: InsuranceStatus;
  cancelledDate: string | null;
  notes: string | null;
  createdDate: string;
  modifyDate: string | null;
}

/**
 * Item da listagem consolidada (`GET /v1/insurances`). O backend denormaliza
 * placa/marca/modelo e já entrega `daysToExpiry` para o badge de vencimento.
 */
export interface InsuranceListItem {
  id: string;
  createdDate: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  premiumAmount: number;
  deductibleAmount: number | null;
  startDate: string;
  endDate: string;
  paymentMethod: InsurancePaymentMethod | null;
  status: InsuranceStatus;
  cancelledDate: string | null;
  /** Dias até `endDate`. Negativo = já vencida. `null` quando não aplicável. */
  daysToExpiry: number | null;
}

/**
 * Detalhe (`GET /v1/insurances/{id}`) — UMA chamada resolve a tela inteira:
 * traz o veículo, o rótulo já traduzido da forma de pagamento, o documento da
 * apólice e o cronograma de parcelas. Não faça GETs extras depois deste.
 */
export interface InsuranceDetail {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYearModel: number | null;
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  premiumAmount: number;
  deductibleAmount: number | null;
  startDate: string;
  endDate: string;
  paymentMethod: InsurancePaymentMethod | null;
  /** Rótulo pronto vindo do backend. A UI prefere o mapa local e cai aqui. */
  paymentMethodLabel: string | null;
  status: InsuranceStatus;
  cancelledDate: string | null;
  notes: string | null;
  daysToExpiry: number | null;
  /** `null` enquanto nenhuma apólice em PDF foi anexada. */
  policyDocument: InsurancePolicyDocument | null;
  /** Vazio quando o cronograma ainda não foi gerado. */
  installments: InsuranceInstallment[];
}

export interface CreateInsuranceRequest {
  insurer: string;
  policyNumber: string;
  coverageType: InsuranceCoverage;
  premiumAmount: number;
  deductibleAmount?: number | null;
  startDate: string;
  endDate: string;
  paymentMethod?: InsurancePaymentMethod | null;
  notes?: string | null;
}

/** PATCH parcial — só os campos alterados precisam ir. */
export interface UpdateInsuranceRequest {
  insurer?: string;
  policyNumber?: string;
  coverageType?: InsuranceCoverage;
  premiumAmount?: number;
  deductibleAmount?: number | null;
  startDate?: string;
  endDate?: string;
  paymentMethod?: InsurancePaymentMethod | null;
  notes?: string | null;
}

export interface CancelInsuranceRequest {
  /** Deve estar em [startDate, hoje]. */
  cancelledDate: string;
  reason?: string | null;
}

/**
 * `status` e `expiringInDays` são MUTUAMENTE EXCLUSIVOS no backend —
 * `expiringInDays` já implica ACTIVE. O service nunca envia os dois juntos.
 */
export interface InsuranceFilters {
  vehicleId?: string;
  status?: InsuranceStatus | '';
  expiringInDays?: number | null;
  sort?: string;
  page?: number;
  size?: number;
}

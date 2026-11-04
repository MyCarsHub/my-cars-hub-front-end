/** O servidor escolhe: assinatura ativa recebe direto; o resto recebe um código. */
export type AdminCouponMode = 'APPLIED_TO_SUBSCRIPTION' | 'PROMOTION_CODE' | 'OPEN_CODE';

export type AdminCouponStatus = 'ACTIVE' | 'DEACTIVATED';

/** `POST /admin/billing/coupons/preview` e a criação. Exatamente um dos dois descontos. */
export interface AdminCouponRequest {
  /** Omitido no código aberto: ele não é de ninguém. */
  companyId?: string;
  planCode: string;
  amountOffCents: number | null;
  percentOff: number | null;
  durationMonths: number;
  reason: string;
  /** Os campos abaixo só valem com `openCode: true`. */
  openCode?: boolean;
  /** Vazio = o servidor gera `MCH-XXXXXXXX`; a ausência do campo diz isso. */
  code?: string;
  maxRedemptions?: number;
  expiresInDays?: number;
  firstPurchaseOnly?: boolean;
}

export interface AdminCouponPreview {
  mode: AdminCouponMode;
  listAmountCents: number;
  discountedAmountCents: number;
  /** "Paga R$ 100,00 por 2 meses, depois R$ 149,90". */
  summary: string;
  /** Nulos em `PROMOTION_CODE` e `OPEN_CODE`: a janela só começa quando o código é usado. */
  discountedInvoices: string[] | null;
  firstFullInvoice: string | null;
}

/** Item da lista. Vem da Stripe; o nome da empresa não faz parte dele. */
export interface AdminCoupon {
  couponId: string;
  mode: AdminCouponMode;
  status: AdminCouponStatus;
  companyId: string | null;
  planCode: string | null;
  amountOffCents: number | null;
  percentOff: number | null;
  durationMonths: number | null;
  timesRedeemed: number | null;
  promotionCode: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  maxRedemptions?: number | null;
}

/** O que a folha precisa saber da empresa, venha da busca ou do detalhe. */
export interface CouponCompany {
  id: string;
  name: string;
  documentMasked: string | null;
  planCode: string | null;
  planName: string | null;
}

/** `INVOICE` = fatura paga com o cupom; `APPLIED_NO_INVOICE_YET` = aplicado, ainda sem fatura paga. */
export type CouponRedemptionSource = 'INVOICE' | 'APPLIED_NO_INVOICE_YET';

/** Um uso do cupom, lido da Stripe. Mais novo primeiro. */
export interface CouponRedemption {
  source: CouponRedemptionSource;
  companyId: string | null;
  companyName: string | null;
  planCode: string | null;
  /** ISO. */
  redeemedAt: string;
  amountPaidCents: number;
  amountWithoutDiscountCents: number;
  discountCents: number;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
}

/** `GET /admin/billing/coupons/{couponId}/redemptions`. */
export interface CouponRedemptions {
  coupon: AdminCoupon;
  redemptions: CouponRedemption[];
  uses: number;
  /** Desconto realmente concedido nas faturas pagas, não estimativa. */
  totalDiscountCents: number;
  /** A Stripe devolveu só os usos mais recentes. */
  truncated: boolean;
}

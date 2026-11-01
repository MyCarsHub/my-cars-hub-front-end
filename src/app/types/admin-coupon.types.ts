/** O servidor escolhe: assinatura ativa recebe direto; o resto recebe um código. */
export type AdminCouponMode = 'APPLIED_TO_SUBSCRIPTION' | 'PROMOTION_CODE';

export type AdminCouponStatus = 'ACTIVE' | 'DEACTIVATED';

/** `POST /admin/billing/coupons/preview` e a criação. Exatamente um dos dois descontos. */
export interface AdminCouponRequest {
  companyId: string;
  planCode: string;
  amountOffCents: number | null;
  percentOff: number | null;
  durationMonths: number;
  reason: string;
}

export interface AdminCouponPreview {
  mode: AdminCouponMode;
  listAmountCents: number;
  discountedAmountCents: number;
  /** "Paga R$ 100,00 por 2 meses, depois R$ 149,90". */
  summary: string;
  /** Nulos em `PROMOTION_CODE`: a janela só começa quando o código é usado. */
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
}

/** O que a folha precisa saber da empresa, venha da busca ou do detalhe. */
export interface CouponCompany {
  id: string;
  name: string;
  documentMasked: string | null;
  planCode: string | null;
  planName: string | null;
}
